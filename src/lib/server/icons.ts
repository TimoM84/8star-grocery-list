/**
 * App icons rendered at runtime in the configured accent color (no image libraries): an
 * eight-pointed star with a check mark. Rasterised with 4×4 supersampling and PNG-encoded with
 * zlib. Results are cached per color and size.
 */

import { crc32, deflateSync } from 'node:zlib';
import { mix } from '$lib/shared/color';

const STAR: [number, number][] = Array.from({ length: 16 }, (_, i) => {
	const r = i % 2 === 0 ? 24 : 17.5;
	const a = ((-90 + i * 22.5) * Math.PI) / 180;
	return [32 + r * Math.cos(a), 32 + r * Math.sin(a)];
});
const CHECK: [number, number][] = [
	[24.5, 32.5],
	[29.5, 37.5],
	[40, 27]
];
const CHECK_WIDTH = 4.2;

function insidePolygon(x: number, y: number, poly: [number, number][]): boolean {
	let inside = false;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
	}
	return inside;
}

function distToSegment(
	px: number,
	py: number,
	[ax, ay]: [number, number],
	[bx, by]: [number, number]
) {
	const dx = bx - ax;
	const dy = by - ay;
	const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
	return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedRect(x: number, y: number, radius: number): boolean {
	if (radius <= 0) return true;
	const cx = Math.min(Math.max(x, radius), 64 - radius);
	const cy = Math.min(Math.max(y, radius), 64 - radius);
	return Math.hypot(x - cx, y - cy) <= radius;
}

function hexRgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

export interface IconOptions {
	/** Full-bleed background with artwork inside the maskable safe zone. */
	maskable?: boolean;
	/** Square corners (Apple touch icon; the OS rounds it). */
	square?: boolean;
}

function render(size: number, accent: string, opts: IconOptions): Buffer {
	const top = hexRgb(mix(accent, '#ffffff', 0.1));
	const bottom = hexRgb(mix(accent, '#000000', 0.12));
	const checkColor = hexRgb(accent);
	const scale = opts.maskable ? 0.72 : 0.92;
	const offset = (64 - 64 * scale) / 2;
	const radius = opts.maskable || opts.square ? 0 : 14;
	const SS = 4;
	const raw = Buffer.alloc((size * 4 + 1) * size);
	for (let py = 0; py < size; py++) {
		const rowStart = py * (size * 4 + 1);
		raw[rowStart] = 0; // PNG filter: none
		for (let px = 0; px < size; px++) {
			let r = 0;
			let g = 0;
			let b = 0;
			let a = 0;
			for (let sy = 0; sy < SS; sy++) {
				for (let sx = 0; sx < SS; sx++) {
					// Sample position in the 64×64 design space.
					const x = ((px + (sx + 0.5) / SS) / size) * 64;
					const y = ((py + (sy + 0.5) / SS) / size) * 64;
					if (!insideRoundedRect(x, y, radius)) continue;
					const ax = (x - offset) / scale;
					const ay = (y - offset) / scale;
					let c: [number, number, number];
					if (
						distToSegment(ax, ay, CHECK[0], CHECK[1]) <= CHECK_WIDTH / 2 ||
						distToSegment(ax, ay, CHECK[1], CHECK[2]) <= CHECK_WIDTH / 2
					)
						c = checkColor;
					else if (insidePolygon(ax, ay, STAR)) c = [255, 255, 255];
					else {
						const t = y / 64;
						c = [0, 1, 2].map((i) => top[i] + (bottom[i] - top[i]) * t) as [number, number, number];
					}
					r += c[0];
					g += c[1];
					b += c[2];
					a += 255;
				}
			}
			const n = SS * SS;
			const covered = a / 255;
			const o = rowStart + 1 + px * 4;
			raw[o] = covered ? Math.round(r / covered) : 0;
			raw[o + 1] = covered ? Math.round(g / covered) : 0;
			raw[o + 2] = covered ? Math.round(b / covered) : 0;
			raw[o + 3] = Math.round(a / n);
		}
	}
	return encodePng(size, size, raw);
}

function chunk(type: string, data: Buffer): Buffer {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function encodePng(width: number, height: number, raw: Buffer): Buffer {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw, { level: 9 })),
		chunk('IEND', Buffer.alloc(0))
	]);
}

const cache = new Map<string, Buffer>();

export function iconPng(size: number, accent: string, opts: IconOptions = {}): Buffer {
	const key = `${size}|${accent}|${opts.maskable ? 'm' : ''}${opts.square ? 's' : ''}`;
	let png = cache.get(key);
	if (!png) {
		png = render(size, accent, opts);
		if (cache.size > 50) cache.clear();
		cache.set(key, png);
	}
	return png;
}

export function iconSvg(accent: string): string {
	const top = mix(accent, '#ffffff', 0.1);
	const bottom = mix(accent, '#000000', 0.12);
	const star =
		STAR.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join('') + 'Z';
	const scale = 0.92;
	const offset = (64 - 64 * scale) / 2;
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><g transform="translate(${offset} ${offset}) scale(${scale})"><path d="${star}" fill="#ffffff"/><path d="M24.5 32.5l5 5L40 27" fill="none" stroke="${accent}" stroke-width="${CHECK_WIDTH}" stroke-linecap="round" stroke-linejoin="round"/></g></svg>`;
}

/** Icon files served under /icons/. */
export const ICONS: Record<string, { size: number; opts?: IconOptions }> = {
	'icon-192.png': { size: 192 },
	'icon-512.png': { size: 512 },
	'maskable-192.png': { size: 192, opts: { maskable: true } },
	'maskable-512.png': { size: 512, opts: { maskable: true } },
	'apple-touch-icon.png': { size: 180, opts: { square: true } },
	'favicon-32.png': { size: 32 }
};
