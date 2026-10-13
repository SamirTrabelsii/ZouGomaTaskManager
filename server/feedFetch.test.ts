import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FeedError, isPublicAddress, normaliseFeedUrl, safeFetchText } from './feedFetch';

describe('which addresses the server may fetch from', () => {
  it.each([
    '127.0.0.1', '127.8.8.8', '10.0.0.5', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0',
    '224.0.0.1', '255.255.255.255', '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::7f00:1', 'not-an-ip',
  ])('refuses %s', (a) => expect(isPublicAddress(a)).toBe(false));

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '142.250.74.110', '2606:4700:4700::1111', '2a00:1450:4007:80f::200e'])('allows %s', (a) => expect(isPublicAddress(a)).toBe(true));
});

describe('normaliseFeedUrl', () => {
  it('turns webcal:// into https://', () => {
    expect(normaliseFeedUrl('webcal://example.com/cal.ics')).toBe('https://example.com/cal.ics');
    expect(normaliseFeedUrl('  WEBCAL://example.com/a b.ics ')).toBe('https://example.com/a%20b.ics');
  });
  it('keeps normal http(s) links', () => {
    expect(normaliseFeedUrl('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics')).toBe('https://calendar.google.com/calendar/ical/x/private-abc/basic.ics');
  });
  it.each(['', '   ', 'hello', 'file:///etc/passwd', 'ftp://example.com/a.ics', 'javascript:alert(1)', 'https://user:pw@example.com/a.ics', 42, null])('rejects %j', (v) => {
    expect(() => normaliseFeedUrl(v)).toThrow(FeedError);
  });
});

describe('safeFetchText refuses internal targets', () => {
  let server: http.Server;
  let port: number;
  let hits = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => { hits++; res.setHeader('content-type', 'text/calendar'); res.end('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n'); });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => { server.close(); });

  it.each(['127.0.0.1', 'localhost', '[::1]', '169.254.169.254', '10.1.2.3', '0.0.0.0'])('never connects to %s', async (host) => {
    await expect(safeFetchText(`http://${host}:${port}/cal.ics`)).rejects.toThrow(/private address|could not be (reached|found)/);
    expect(hits).toBe(0); // the local server was never contacted
  });

  it('does not leak the secret URL in its error messages', async () => {
    const secret = 'secret-token-123';
    const e = await safeFetchText(`http://127.0.0.1:${port}/private-${secret}/basic.ics`).catch((x: Error) => x);
    expect((e as Error).message).not.toContain(secret);
  });
});
