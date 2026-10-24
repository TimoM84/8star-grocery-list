import { test, expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deriveTheme } from '../src/lib/shared/color';

/**
 * APP_PRIMARY_COLOR is read at runtime: each test starts the same production build with a
 * different value (as recreating the container would) and checks every place the color shows.
 */

interface Server {
	url: string;
	stop: () => Promise<void>;
	dataDir: string;
}

let nextPort = 4300;

async function startServer(
	color: string | undefined,
	dataDir?: string,
	fixedPort?: number
): Promise<Server> {
	const port = fixedPort ?? nextPort++;
	const dir = dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), '8star-theme-'));
	const env: NodeJS.ProcessEnv = {
		...process.env,
		PORT: String(port),
		DATA_DIR: dir,
		BACKUP_INTERVAL_HOURS: '0'
	};
	if (color === undefined) delete env.APP_PRIMARY_COLOR;
	else env.APP_PRIMARY_COLOR = color;
	const proc: ChildProcess = spawn('node', ['build/index.js'], { env, stdio: 'pipe' });
	let log = '';
	proc.stdout?.on('data', (d) => (log += d));
	proc.stderr?.on('data', (d) => (log += d));
	const url = `http://localhost:${port}`;
	for (let i = 0; i < 100; i++) {
		try {
			if ((await fetch(url + '/api/health')).ok) break;
		} catch {
			/* not up yet */
		}
		await new Promise((r) => setTimeout(r, 100));
	}
	return {
		url,
		dataDir: dir,
		stop: () =>
			new Promise((resolve) => {
				proc.once('exit', () => resolve());
				proc.kill('SIGTERM');
				setTimeout(() => {
					void log;
					proc.kill('SIGKILL');
				}, 3000);
			})
	};
}

async function cssVar(page: Page, name: string) {
	return page.evaluate(
		(n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
		name
	);
}

async function rgbOf(page: Page, testid: string, prop: 'backgroundColor' | 'color') {
	return page.getByTestId(testid).evaluate((el, p) => getComputedStyle(el)[p], prop);
}

function hexToRgb(hex: string) {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return `rgb(${r}, ${g}, ${b})`;
}

test.describe.configure({ mode: 'serial' });

for (const [name, color] of [
	['blue', '#2563EB'],
	['orange', '#F97316'],
	['green (default)', undefined]
] as const) {
	test(`theme ${name}: buttons, sort control, navigation, manifest and icons follow APP_PRIMARY_COLOR`, async ({
		browser
	}) => {
		const server = await startServer(color);
		const expected = deriveTheme((color ?? '#1D7F46').toUpperCase());
		try {
			for (const scheme of ['light', 'dark'] as const) {
				const ctx = await browser.newContext({
					viewport: { width: 390, height: 844 },
					colorScheme: scheme,
					serviceWorkers: 'block',
					reducedMotion: 'reduce'
				});
				const page = await ctx.newPage();
				await page.goto(server.url + '/');
				await expect(page.getByTestId('add-button')).toBeVisible();
				const palette = expected[scheme];
				expect(await cssVar(page, '--accent')).toBe(palette.accent);
				expect(await rgbOf(page, 'add-button', 'backgroundColor')).toBe(hexToRgb(palette.accent));
				expect(await rgbOf(page, 'add-button', 'color')).toBe(hexToRgb(palette.contrast));
				expect(await rgbOf(page, 'nav-lijst', 'color')).toBe(hexToRgb(palette.accent));
				// Semantic colors are not affected by the accent.
				expect(await cssVar(page, '--danger')).toBe(scheme === 'light' ? '#c0262d' : '#ff7b7b');
				await page.screenshot({ path: `screenshots/theme-${name.split(' ')[0]}-${scheme}.png` });
				await ctx.close();
			}

			const manifest = await (await fetch(server.url + '/manifest.webmanifest')).json();
			expect(manifest.theme_color).toBe(expected.light.accent);
			const icon = await fetch(server.url + '/icons/icon-192.png');
			expect(icon.headers.get('content-type')).toBe('image/png');
			const png = Buffer.from(await icon.arrayBuffer());
			expect(png.readUInt32BE(16)).toBe(192);
			expect(png.readUInt32BE(20)).toBe(192);
			const svg = await (await fetch(server.url + '/icons/favicon.svg')).text();
			expect(svg).toContain(`stroke="${expected.light.accent}"`);
		} finally {
			await server.stop();
		}
	});
}

test('invalid APP_PRIMARY_COLOR falls back to the default green', async ({ browser }) => {
	const server = await startServer('blauw');
	try {
		const page = await browser.newPage({ serviceWorkers: 'block' });
		await page.goto(server.url + '/');
		await expect(page.getByTestId('add-button')).toBeVisible();
		expect(await cssVar(page, '--accent')).toBe('#1d7f46');
		await page.close();
	} finally {
		await server.stop();
	}
});

test('recreating with a new color applies it without a rebuild, also for an installed (cached) app', async ({
	browser
}) => {
	const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-theme-'));
	const port = nextPort++;
	const blue = deriveTheme('#2563EB').light.accent;
	const orange = deriveTheme('#F97316').light.accent;
	const ctx = await browser.newContext({
		viewport: { width: 390, height: 844 },
		serviceWorkers: 'allow'
	});
	const page = await ctx.newPage();

	// 1. Container runs with blue; the PWA gets installed (service worker caches the shell).
	let server = await startServer('#2563EB', dataDir, port);
	await page.goto(server.url + '/');
	await expect
		.poll(() =>
			page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)
		)
		.toBe(true);
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
	expect(await cssVar(page, '--accent')).toBe(blue);
	await server.stop();

	// 2. Container recreated with orange on the same address: same image, new environment.
	server = await startServer('#F97316', dataDir, port);
	try {
		await page.reload();
		await expect(page.getByTestId('add-button')).toBeVisible();
		expect(await cssVar(page, '--accent')).toBe(orange);
		const manifest = await (await fetch(server.url + '/manifest.webmanifest')).json();
		expect(manifest.theme_color).toBe(orange);

		// 3. Offline start uses the last known theme (orange), not the stale cached blue.
		await ctx.setOffline(true);
		await page.reload();
		await expect(page.getByTestId('add-button')).toBeVisible();
		expect(await cssVar(page, '--accent')).toBe(orange);
		await ctx.setOffline(false);
	} finally {
		await ctx.close();
		await server.stop();
	}
});
