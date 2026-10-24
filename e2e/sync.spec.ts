import { test, expect, type Browser, type Page } from '@playwright/test';
import { addItems, freshApp, resetServer, row, waitForSync } from './helpers';

async function device(browser: Browser, baseURL: string): Promise<Page> {
	const ctx = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		locale: 'nl-NL',
		reducedMotion: 'reduce',
		serviceWorkers: 'block'
	});
	const page = await ctx.newPage();
	await page.goto('/');
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
	return page;
}

async function snapshot(page: Page) {
	return (await page.request.get('/api/snapshot')).json();
}

test.describe('multi-device sync', () => {
	let a: Page;
	let b: Page;

	test.beforeEach(async ({ page, browser, baseURL }) => {
		await freshApp(page);
		await resetServer(page.request);
		a = page;
		await a.reload();
		b = await device(browser, baseURL!);
	});

	test.afterEach(async () => {
		await b.context().close();
	});

	test('changes appear live on other devices (SSE)', async () => {
		await addItems(a, 'Melk');
		await expect(row(b, 'Melk')).toHaveAttribute('data-status', 'active');
		await row(b, 'Melk').getByTestId('item-toggle').click();
		await expect(row(a, 'Melk')).toHaveAttribute('data-status', 'completed');
		await expect(a.getByTestId('page-subtitle')).toHaveText('Niets te halen');
	});

	test('offline edits are queued durably and synced on reconnect', async () => {
		await addItems(a, 'Brood');
		await expect(row(b, 'Brood')).toBeVisible();

		await a.context().setOffline(true);
		await expect(a.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
			timeout: 15_000
		});
		await addItems(a, 'Kaas', 'Eieren');
		await row(a, 'Brood').getByTestId('item-toggle').click();
		await expect(a.getByTestId('sync-badge')).toContainText('Offline · 3');

		// The queue survives a reload while offline (IndexedDB).
		const pending = await a.evaluate(
			() =>
				new Promise<number>((resolve) => {
					const r = indexedDB.open('8star-grocery');
					r.onsuccess = () => {
						const tx = r.result.transaction('pending');
						const c = tx.objectStore('pending').count();
						c.onsuccess = () => resolve(c.result);
					};
				})
		);
		expect(pending).toBe(3);

		// Nothing reached the server or the other device yet.
		expect((await snapshot(b)).items).toHaveLength(1);
		await expect(row(b, 'Kaas')).toHaveCount(0);

		await a.context().setOffline(false);
		await waitForSync(a);
		await expect(row(b, 'Kaas')).toBeVisible();
		await expect(row(b, 'Eieren')).toBeVisible();
		await expect(row(b, 'Brood')).toHaveAttribute('data-status', 'completed');
		const snap = await snapshot(b);
		expect(snap.items).toHaveLength(3);
		expect(snap.products.find((p: { name: string }) => p.name === 'Brood').purchaseCount).toBe(1);
	});

	test('concurrent offline adds of the same product are merged (no duplicates)', async () => {
		await a.context().setOffline(true);
		await b.context().setOffline(true);
		await expect(a.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
			timeout: 15_000
		});
		await expect(b.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
			timeout: 15_000
		});
		await addItems(a, 'Bananen');
		await addItems(b, 'bananen ');
		// Device B also ticks its own (local) copy off while still offline.
		await row(b, 'Bananen').getByTestId('item-toggle').click();

		await a.context().setOffline(false);
		await waitForSync(a);
		await b.context().setOffline(false);
		await waitForSync(b);

		const snap = await snapshot(a);
		expect(snap.products).toHaveLength(1);
		expect(snap.items).toHaveLength(1);
		expect(snap.items[0].status).toBe('completed');
		await expect(row(a, 'Bananen')).toHaveAttribute('data-status', 'completed');
		await expect(b.locator('[data-testid=item-row]')).toHaveCount(1);
	});

	test('concurrent edits: last writer wins and the user is told', async () => {
		await addItems(a, 'Bier');
		await expect(row(b, 'Bier')).toBeVisible();
		await a.context().setOffline(true);
		await expect(a.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
			timeout: 15_000
		});

		// Device A (offline) sets 6, device B (online) sets 12.
		await row(a, 'Bier').getByTestId('item-edit').click();
		await a.getByTestId('qty-input').fill('6');
		await a.getByTestId('edit-save').click();

		await row(b, 'Bier').getByTestId('item-edit').click();
		await b.getByTestId('qty-input').fill('12');
		await b.getByTestId('edit-save').click();
		await waitForSync(b);

		await a.context().setOffline(false);
		await expect(a.getByTestId('toast')).toContainText('ander apparaat gewijzigd');
		await waitForSync(a);
		await expect(row(a, 'Bier').getByTestId('item-qty')).toHaveText('6×');
		await expect(row(b, 'Bier').getByTestId('item-qty')).toHaveText('6×');

		// The conflict stays visible in the sync log.
		await a.getByTestId('nav-beheer').click();
		await expect(a.getByTestId('sync-issues')).toContainText('ander apparaat');
	});

	test('an offline edit of an item deleted elsewhere is reported, not lost silently', async () => {
		await addItems(a, 'Wijn');
		await expect(row(b, 'Wijn')).toBeVisible();
		await b.context().setOffline(true);
		await expect(b.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
			timeout: 15_000
		});
		await row(b, 'Wijn').getByTestId('item-toggle').click();

		await row(a, 'Wijn').getByTestId('item-edit').click();
		await a.getByTestId('edit-delete').click();
		await a.getByTestId('confirm-ok').click();
		await waitForSync(a);

		await b.context().setOffline(false);
		await expect(b.getByTestId('toast')).toContainText('verwijderd');
		await waitForSync(b);
		await expect(b.locator('[data-testid=item-row]')).toHaveCount(0);
		await b.getByTestId('nav-beheer').click();
		await expect(b.getByTestId('sync-issues')).toContainText('bestaat niet meer');
	});
});
