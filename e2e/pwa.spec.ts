import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { addItems, freshApp, resetServer, row, waitForSync } from './helpers';

test.use({ serviceWorkers: 'allow' });

function pngSize(buf: Buffer) {
	return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

test('manifest and icons meet Android install requirements', async ({ page, request }) => {
	// A fresh install is English; the names follow the household language.
	await resetServer(request, 'en');
	const res = await request.get('/manifest.webmanifest');
	expect(res.ok()).toBeTruthy();
	const m = await res.json();
	expect(m).toMatchObject({ display: 'standalone', start_url: '/', scope: '/', lang: 'en' });
	expect(m.name).toBe('8star Groceries');
	for (const language of ['nl', 'de', 'fr', 'es']) {
		await resetServer(request, language);
		const localised = await (await request.get('/manifest.webmanifest')).json();
		expect(localised.lang).toBe(language);
		expect(localised.short_name.length, language).toBeLessThanOrEqual(12);
		expect(localised.name).not.toBe(m.name);
	}
	expect(m.short_name.length).toBeLessThanOrEqual(12);
	const sizes = new Set<string>();
	for (const icon of m.icons) {
		const r = await request.get(icon.src);
		expect(r.ok(), icon.src).toBeTruthy();
		const { width, height } = pngSize(await r.body());
		expect(`${width}x${height}`).toBe(icon.sizes);
		sizes.add(`${icon.sizes}:${icon.purpose}`);
	}
	expect(sizes).toContain('192x192:any');
	expect(sizes).toContain('512x512:any');
	expect(sizes).toContain('512x512:maskable');

	await page.goto('/');
	const head = page.locator('head');
	await expect(head.locator('link[rel=manifest]')).toHaveAttribute('href', /manifest\.webmanifest/);
	await expect(head.locator('meta[name=viewport]')).toHaveAttribute(
		'content',
		/viewport-fit=cover/
	);
	await expect(head.locator('meta[name=theme-color]').first()).toHaveAttribute('content', /#/);
	await expect(head.locator('link[rel=apple-touch-icon]')).toHaveCount(1);
});

test('service worker caches the app shell so the app starts offline with local data', async ({
	page,
	context
}) => {
	await freshApp(page);
	await addItems(page, 'Appelsap', 'Rozijnen');
	await row(page, 'Rozijnen').getByTestId('item-toggle').click();
	await waitForSync(page);

	await expect
		.poll(() =>
			page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)
		)
		.toBe(true);
	// Make sure the page is controlled before going offline.
	await page.reload();
	await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

	await context.setOffline(true);
	await page.reload();
	await expect(row(page, 'Appelsap')).toHaveAttribute('data-status', 'active');
	await expect(row(page, 'Rozijnen')).toHaveAttribute('data-status', 'completed');
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
		timeout: 20_000
	});

	// Other routes work offline too (same cached shell).
	await page.goto('/historie');
	await expect(page.getByTestId('page-title')).toHaveText('Historie');
	await expect(page.getByTestId('history-products')).toContainText('Appelsap');

	// Offline edit, then reconnect.
	await page.goto('/');
	await addItems(page, 'Honing');
	await context.setOffline(false);
	await waitForSync(page);
	const snap = await (await page.request.get('/api/snapshot')).json();
	expect(snap.products.map((p: { name: string }) => p.name)).toContain('Honing');
});

test('API responses are never cached and health endpoint reports status', async ({ request }) => {
	const res = await request.get('/api/health');
	expect(res.headers()['cache-control']).toBe('no-store');
	const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8')) as { version: string };
	expect(await res.json()).toMatchObject({ status: 'ok', version: pkg.version, schemaVersion: 4 });
	const reset = await request.post('/api/test/reset');
	expect(reset.ok()).toBeTruthy();
});
