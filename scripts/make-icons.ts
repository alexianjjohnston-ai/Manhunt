/**
 * Renders the SVG app icon to the PNG sizes iOS/Android need, using the
 * pre-installed Chromium via Playwright. Run: npm run icons
 */
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const svg = readFileSync('web/public/icons/icon.svg', 'utf8');
const targets: { file: string; size: number; pad: number }[] = [
  { file: 'icon-192.png', size: 192, pad: 0 },
  { file: 'icon-512.png', size: 512, pad: 0 },
  { file: 'apple-touch-icon.png', size: 180, pad: 0 },
  { file: 'icon-maskable-512.png', size: 512, pad: 0.12 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const t of targets) {
  await page.setViewportSize({ width: t.size, height: t.size });
  const inner = Math.round(t.size * (1 - t.pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:#07090c;display:grid;place-items:center;width:${t.size}px;height:${t.size}px">
      <div style="width:${inner}px;height:${inner}px">${svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `)}</div></body></html>`,
  );
  await page.screenshot({ path: `web/public/icons/${t.file}`, omitBackground: false });
  console.log('wrote', t.file);
}
await browser.close();
