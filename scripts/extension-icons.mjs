// Renders public/icon.svg into the PNG sizes the browser extension needs (Chrome does not take SVG icons).
// Run: node scripts/extension-icons.mjs
import { readFileSync, mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const out = new URL('../extension/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

// the Edge that ships with Windows, so no browser download is needed
const browser = await chromium.launch({ channel: process.env.ICON_BROWSER ?? 'msedge' });
try {
  for (const size of [16, 32, 48, 128]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`);
    await page.screenshot({ path: new URL(`${size}.png`, out).pathname.replace(/^\/([A-Za-z]:)/, '$1'), omitBackground: true });
    await page.close();
  }
} finally { await browser.close(); }
console.log('extension/icons written');
