import * as THREE from 'three';
import type { AppData } from '../domain/types';
import { monthGrid, parseDay } from '../domain/dates';
import { agendaItems } from '../domain/services';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return { c, g: c.getContext('2d')! };
}

function finish(c: HTMLCanvasElement, repeat?: [number, number], srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

export function makeFloorTexture() {
  const { c, g } = canvas(512, 512);
  const cols = ['#b88a5c', '#c19766', '#ad7f52', '#bb8f60'];
  const plank = 64;
  g.fillStyle = cols[0]; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 8; i++) {
    const off = (i % 2) * 128;
    for (let j = -1; j < 3; j++) {
      const x = j * 256 + off;
      g.fillStyle = cols[(i * 3 + (j + 1) * 5) % cols.length];
      g.fillRect(x, i * plank, 256, plank);
      g.strokeStyle = 'rgba(70,40,20,.16)'; g.lineWidth = 1.5;
      g.strokeRect(x, i * plank, 256, plank);
    }
  }
  for (let i = 0; i < 700; i++) { // grain
    g.fillStyle = `rgba(60,30,10,${Math.random() * 0.06})`;
    g.fillRect(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 50, 1);
  }
  return finish(c, [2.2, 2]);
}

/** Night sky seen through the window: deep navy gradient, stars, a soft moon glow. */
export function makeNightSkyTexture() {
  const { c, g } = canvas(256, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#0b1442'); grad.addColorStop(1, '#2a3f94');
  g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 90; i++) {
    g.fillStyle = `rgba(255,${230 + Math.random() * 25 | 0},${180 + Math.random() * 60 | 0},${0.4 + Math.random() * 0.6})`;
    const s = Math.random() < 0.15 ? 2.5 : 1.2;
    g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
  }
  const m = g.createRadialGradient(190, 60, 2, 190, 60, 50);
  m.addColorStop(0, 'rgba(210,225,255,.95)'); m.addColorStop(0.25, 'rgba(150,180,255,.35)'); m.addColorStop(1, 'rgba(100,140,255,0)');
  g.fillStyle = m; g.fillRect(0, 0, 256, 256);
  return finish(c);
}

export function makeWallTexture(base = '#efe6d6') {
  const { c, g } = canvas(256, 256);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 1800; i++) {
    g.fillStyle = `rgba(120,100,70,${Math.random() * 0.035})`;
    g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
  }
  return finish(c, [4, 2]);
}

export function makeRugTexture() {
  const { c, g } = canvas(256, 256);
  g.fillStyle = '#c9b9a0'; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = '#8a9a78'; g.lineWidth = 10; g.strokeRect(14, 14, 228, 228);
  g.strokeStyle = '#a88b6a'; g.lineWidth = 3; g.strokeRect(34, 34, 188, 188);
  g.fillStyle = 'rgba(138,154,120,.5)';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
    g.beginPath(); g.arc(64 + i * 25.5, 64 + j * 25.5, 5, 0, 7); g.fill();
  }
  return finish(c);
}

/** Wall calendar, painted from live data: month grid, today ring, event/deadline/task markers. */
export function drawCalendarTexture(tex: THREE.CanvasTexture | null, data: AppData, today: string): THREE.CanvasTexture {
  const W = 1024, H = 740;
  const cv = tex?.image as HTMLCanvasElement | undefined ?? canvas(W, H).c;
  const g = cv.getContext('2d')!;
  const t = parseDay(today);
  const year = t.getFullYear(), month = t.getMonth();
  g.fillStyle = '#fbf8f2'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#4e7342'; g.fillRect(0, 0, W, 110);
  g.fillStyle = '#fff'; g.font = '600 56px Georgia, serif'; g.textBaseline = 'middle';
  g.fillText(t.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }), 40, 56);
  const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
  const cw = W / 7, top = 150, ch = (H - top - 14) / 6;
  g.fillStyle = '#7a6f61'; g.font = '600 28px sans-serif'; g.textAlign = 'center';
  days.forEach((d, i) => g.fillText(d, cw * i + cw / 2, 130));
  const items = agendaItems(data);
  const byDay = new Map<string, Set<string>>();
  items.forEach((i) => { if (!i.done) byDay.set(i.date, (byDay.get(i.date) ?? new Set()).add(i.kind)); });
  monthGrid(year, month).forEach((d, idx) => {
    const col = idx % 7, row = Math.floor(idx / 7);
    const x = col * cw, y = top + row * ch;
    const inMonth = parseDay(d).getMonth() === month;
    g.strokeStyle = '#e1d7c3'; g.lineWidth = 1.5; g.strokeRect(x, y, cw, ch);
    if (d === today) {
      g.fillStyle = 'rgba(192,108,70,.18)'; g.fillRect(x + 2, y + 2, cw - 4, ch - 4);
      g.strokeStyle = '#c06c46'; g.lineWidth = 4; g.strokeRect(x + 5, y + 5, cw - 10, ch - 10);
    }
    g.fillStyle = inMonth ? '#2a2520' : '#b9ad9a';
    g.font = `${d === today ? '700' : '500'} 30px sans-serif`; g.textAlign = 'left';
    g.fillText(String(parseDay(d).getDate()), x + 12, y + 28);
    const kinds = byDay.get(d);
    if (kinds && inMonth) {
      let mx = x + 16;
      const my = y + ch - 22;
      const draw = (k: string) => {
        if (k === 'event' || k === 'reminder') { g.fillStyle = '#4f7f9c'; g.beginPath(); g.arc(mx + 7, my, 8, 0, 7); g.fill(); }
        else if (k === 'deadline' || k === 'project') { g.fillStyle = '#c06c46'; g.fillRect(mx, my - 8, 16, 16); }
        else if (k === 'milestone') { g.fillStyle = '#a07048'; g.beginPath(); g.moveTo(mx + 8, my - 10); g.lineTo(mx + 17, my); g.lineTo(mx + 8, my + 10); g.lineTo(mx - 1, my); g.fill(); }
        else { g.fillStyle = '#628a52'; g.beginPath(); g.moveTo(mx + 8, my - 9); g.lineTo(mx + 17, my + 8); g.lineTo(mx - 1, my + 8); g.fill(); }
        mx += 26;
      };
      [...kinds].slice(0, 4).forEach(draw);
    }
  });
  if (tex) { tex.needsUpdate = true; return tex; }
  return finish(cv);
}

/** Monitor face showing today's progress. */
export function drawMonitorTexture(tex: THREE.CanvasTexture | null, done: number, total: number, ratio: number): THREE.CanvasTexture {
  const W = 512, H = 300;
  const cv = tex?.image as HTMLCanvasElement | undefined ?? canvas(W, H).c;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#0a2a66'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#7fd0ff'; g.font = '500 28px sans-serif'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText('TODAY', 32, 56);
  g.fillStyle = '#e6f6ff'; g.font = '700 110px Georgia, serif';
  g.fillText(total ? `${done}/${total}` : '—', 32, 175);
  g.fillStyle = 'rgba(120,200,255,.18)'; g.fillRect(32, 215, W - 64, 22);
  g.fillStyle = '#4cc3ff'; g.fillRect(32, 215, (W - 64) * ratio, 22);
  g.fillStyle = '#9fd8ff'; g.font = '24px sans-serif';
  g.fillText(total === 0 ? 'A clear day' : done === total ? 'All done' : `${total - done} to go`, 32, 275);
  if (tex) { tex.needsUpdate = true; return tex; }
  return finish(cv);
}
