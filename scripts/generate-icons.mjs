// Renders the app icon SVG into the PNG sizes required for Android/PWA installation.
// Usage: npm run icons   (uses the locally installed Playwright Chromium)
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';

const OUT = new URL('../static/icons/', import.meta.url);
mkdirSync(OUT, { recursive: true });

const STAR =
	'M32 8L38.7 15.83L48.97 15.03L48.17 25.3L56 32L48.17 38.7L48.97 48.97L38.7 48.17L32 56L25.3 48.17L15.03 48.97L15.83 38.7L8 32L15.83 25.3L15.03 15.03L25.3 15.83Z';
const CHECK = 'M24.5 32.5l5 5L40 27';

/** @param {{ maskable?: boolean, rounded?: boolean }} o */
function svg({ maskable = false, rounded = true } = {}) {
	// Maskable icons need the artwork inside the central 80% safe zone.
	const scale = maskable ? 0.72 : 0.92;
	const offset = (64 - 64 * scale) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#25995a"/><stop offset="1" stop-color="#17703d"/></linearGradient></defs>
  <rect width="64" height="64" rx="${maskable || !rounded ? 0 : 14}" fill="url(#g)"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})">
    <path d="${STAR}" fill="#ffffff"/>
    <path d="${CHECK}" fill="none" stroke="#1d7f46" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

writeFileSync(new URL('favicon.svg', OUT), svg());

const browser = await chromium.launch();
const page = await browser.newPage();
const targets = [
	['icon-192.png', 192, {}],
	['icon-512.png', 512, {}],
	['maskable-192.png', 192, { maskable: true }],
	['maskable-512.png', 512, { maskable: true }],
	['apple-touch-icon.png', 180, { rounded: false }],
	['favicon-32.png', 32, {}]
];
for (const [name, size, opts] of targets) {
	await page.setViewportSize({ width: size, height: size });
	await page.setContent(
		`<html><body style="margin:0;background:transparent">${svg(opts).replace('<svg ', `<svg width="${size}" height="${size}" `)}</body></html>`
	);
	const buf = await page.locator('svg').screenshot({ omitBackground: true });
	writeFileSync(new URL(name, OUT), buf);
	console.log('wrote', name);
}
await browser.close();
