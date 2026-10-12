// Dev tool: measures frame pacing of the 3D room at each graphics quality in a real (headed) Chrome.
//   node e2e/perf-quality.mjs [baseUrl] [--dpr=2] [--seconds=4]
import { chromium } from '@playwright/test';

const base = process.argv.find((a) => a.startsWith('http')) ?? 'http://localhost:5173';
const arg = (k, d) => Number(process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1] ?? d);
const dpr = arg('dpr', 1), seconds = arg('seconds', 4);

const browser = await chromium.launch({ channel: 'chrome', headless: false, args: ['--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
const page = await ctx.newPage();
await page.goto(base);
await page.getByRole('button', { name: 'Settings' }).waitFor();
const gpu = await page.evaluate(() => { const g = document.createElement('canvas').getContext('webgl2'); const e = g.getExtension('WEBGL_debug_renderer_info'); return g.getParameter(e.UNMASKED_RENDERER_WEBGL); });
console.log(`GPU: ${gpu} | viewport 1280x800 @${dpr}x | ${seconds}s per tier`);

const measure = (ms) => page.evaluate((ms) => new Promise((res) => {
  const t = []; let last = performance.now(); const end = last + ms;
  (function f(n) { t.push(n - last); last = n; if (n < end) requestAnimationFrame(f); else {
    t.shift(); const s = [...t].sort((a, b) => a - b);
    res({ fps: +(1000 / (t.reduce((a, b) => a + b) / t.length)).toFixed(1), p50: +s[s.length >> 1].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), worst: +s[s.length - 1].toFixed(1) });
  } })(last);
}), ms);

for (const q of ['low', 'balanced', 'high', 'low', 'balanced', 'high']) {
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByLabel('Graphics quality').selectOption(q);
  await page.getByRole('button', { name: 'Close' }).first().click();
  await page.waitForTimeout(2500);
  console.log(q.padEnd(9), JSON.stringify(await measure(seconds * 1000)));
}
await browser.close();
