import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';

/** A problem with a feed that is safe and useful to show the user (it never contains the feed URL). */
export class FeedError extends Error {}

export type FeedFetcher = (url: string) => Promise<string>;

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 4;

/** Everything that is not a normal public internet address: loopback, private, link-local, CGNAT, multicast, tunnelled IPv6… (IPv4-mapped IPv6 is checked against the IPv4 ranges by Node). */
const blocked = new net.BlockList();
for (const [net4, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 3],
] as const) blocked.addSubnet(net4, bits, 'ipv4');
for (const [net6, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net6, bits, 'ipv6');

export function isPublicAddress(addr: string): boolean {
  const kind = net.isIP(addr);
  if (!kind) return false;
  return !blocked.check(addr, kind === 4 ? 'ipv4' : 'ipv6');
}

/** Accepts what people paste: webcal:// links, or http(s). Returns an https/http URL or throws a FeedError. */
export function normaliseFeedUrl(raw: unknown): string {
  if (typeof raw !== 'string') throw new FeedError('Paste the calendar link.');
  let s = raw.trim();
  if (!s || s.length > 2048) throw new FeedError('That link is empty or too long.');
  s = s.replace(/^webcals?:\/\//i, 'https://');
  let u: URL;
  try { u = new URL(s); } catch { throw new FeedError('That does not look like a web link.'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new FeedError('Only http(s) or webcal links are supported.');
  if (u.username || u.password) throw new FeedError('Links with a username or password are not supported.');
  return u.toString();
}

/** DNS lookup that refuses to connect to non-public addresses; the connection uses the same address it checked (no rebinding gap). */
const guardedLookup: net.LookupFunction = (hostname, options, cb) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addrs) => {
    if (err) return cb(err, '', 0);
    const list = (addrs as dns.LookupAddress[]);
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), '', 0);
    }
    if (options.all) return (cb as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    cb(null, list[0].address, list[0].family);
  });
};

function once(url: URL): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && !isPublicAddress(host)) return reject(new FeedError('That link points to a private address.'));
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, {
      method: 'GET', lookup: guardedLookup, timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'LifeOS-calendar-sync/1.0', accept: 'text/calendar, text/plain;q=0.5, */*;q=0.1', 'accept-encoding': 'gzip, deflate, br' },
    }, (res) => {
      const status = res.statusCode ?? 0;
      if (status >= 300 && status < 400 && res.headers.location) { res.resume(); return resolve({ status, location: res.headers.location, body: '' }); }
      let stream: Readable = res;
      const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
      if (enc === 'gzip') stream = res.pipe(zlib.createGunzip());
      else if (enc === 'deflate') stream = res.pipe(zlib.createInflate());
      else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress());
      const chunks: Buffer[] = [];
      let size = 0;
      stream.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new FeedError('The calendar is too large (over 8 MB).')); return; }
        chunks.push(c);
      });
      stream.on('end', () => resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') }));
      stream.on('error', () => reject(new FeedError('The calendar could not be read.')));
    });
    req.on('timeout', () => req.destroy(new FeedError('The calendar server took too long to answer.')));
    req.on('error', (e: Error & { code?: string }) => {
      if (e instanceof FeedError) return reject(e);
      if (e.code === 'EBLOCKED') return reject(new FeedError('That link points to a private address.'));
      if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') return reject(new FeedError('That web address could not be found.'));
      reject(new FeedError('The calendar server could not be reached.'));
    });
    req.end();
  });
}

/** Download an iCalendar feed over http(s), safely. Never echoes the URL (it is usually a secret). */
export const safeFetchText: FeedFetcher = async (raw) => {
  let url = new URL(normaliseFeedUrl(raw));
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const r = await once(url);
    if (r.location) {
      let next: URL;
      try { next = new URL(r.location, url); } catch { throw new FeedError('The calendar link redirects somewhere invalid.'); }
      if (next.protocol !== 'https:' && next.protocol !== 'http:') throw new FeedError('The calendar link redirects somewhere unsupported.');
      url = next;
      continue;
    }
    if (r.status === 404 || r.status === 410) throw new FeedError('The calendar link does not exist (anymore). Copy the secret address again.');
    if (r.status === 401 || r.status === 403) throw new FeedError('The calendar server refused access. Check that the link is the secret/published address.');
    if (r.status !== 200) throw new FeedError(`The calendar server answered with an error (HTTP ${r.status}).`);
    const text = r.body.replace(/^﻿/, '');
    if (!/^\s*BEGIN:VCALENDAR/i.test(text)) throw new FeedError('That link is not an iCal (.ics) calendar.');
    return text;
  }
  throw new FeedError('The calendar link redirects too many times.');
};
