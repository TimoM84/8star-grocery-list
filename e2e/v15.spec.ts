import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import { addItems, audit, freshApp, row, seedPurchases, waitForSync } from './helpers';

/** A second phone of the same household. */
async function device(browser: Browser, baseURL: string, path: string): Promise<Page> {
	const ctx = await browser.newContext({
		baseURL,
		viewport: { width: 412, height: 915 },
		isMobile: true,
		hasTouch: true,
		locale: 'nl-NL',
		reducedMotion: 'reduce',
		serviceWorkers: 'block'
	});
	const page = await ctx.newPage();
	await page.goto(path);
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
	return page;
}

async function snapshot(page: Page) {
	return (await page.request.get('/api/snapshot')).json();
}

async function importRecommendation(page: Page) {
	const snap = await snapshot(page);
	const melk = snap.products.find((p: { name: string }) => p.name === 'Halfvolle melk').id;
	const res = await page.request.post('/api/import?kind=ai', {
		headers: { 'content-type': 'application/json' },
		data: JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			recommendations: [{ productId: melk, confidence: 0.8, reasoning: 'Elke week.' }]
		})
	});
	expect(res.ok()).toBeTruthy();
}

async function replaceWith(page: Page, file: unknown) {
	const res = await page.request.post('/api/import?kind=json&mode=replace', {
		headers: { 'content-type': 'application/octet-stream', 'x-confirm-replace': 'VERVANGEN' },
		data: JSON.stringify(file)
	});
	const report = await res.json();
	expect(report.ok, JSON.stringify(report.errors)).toBe(true);
}

/** Simulates pasting text from the clipboard into a field. */
async function paste(field: Locator, text: string) {
	await field.focus();
	await field.evaluate((el, t) => {
		const data = new DataTransfer();
		data.setData('text/plain', t);
		el.dispatchEvent(
			new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
		);
	}, text);
}

// ---------------------------------------------------------------------------- suggestions

test('"Suggesties tonen" hides every suggestion on both devices, live, after reload and import', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page, '/beheer');
	await seedPurchases(page.request, 'Halfvolle melk', 3, 7, 7);
	await importRecommendation(page);
	const other = await device(browser, baseURL!, '/');
	await expect(other.getByTestId('maybe-strip')).toBeVisible();
	await expect(other.getByTestId('nav-badge')).toBeVisible();
	await expect(other.getByTestId('nav-suggesties')).toContainText('Suggesties');

	const toggle = page.getByTestId('setting-suggestions');
	await expect(toggle).toContainText('Suggesties tonen');
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByTestId('setting-ai')).toHaveCount(0);
	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByTestId('open-gegevens')).not.toContainText('AI');
	await waitForSync(page);

	// Live on the other device: strip, badge and tab label follow without a reload.
	await expect(other.getByTestId('maybe-strip')).toHaveCount(0);
	await expect(other.getByTestId('nav-badge')).toHaveCount(0);
	await expect(other.getByTestId('nav-suggesties')).toContainText('Snelkeuze');
	// Autocomplete while typing is not a suggestion and keeps working.
	await other.getByTestId('add-input').fill('halfv');
	await expect(other.getByTestId('autocomplete-option')).toContainText('Halfvolle melk');
	await other.getByTestId('add-input').fill('');

	await other.getByTestId('nav-suggesties').click();
	await expect(other.getByTestId('suggestions-section')).toHaveCount(0);
	await expect(other.getByTestId('ai-section')).toHaveCount(0);
	await expect(other.getByTestId('bundles-section')).toBeVisible();
	await expect(other.getByRole('heading', { level: 1 })).toHaveText('Snelkeuze');
	await page.goto('/beheer/gegevens');
	await expect(page.getByTestId('export-ai-prompt')).toHaveCount(0);

	// Product details hide the prediction but keep the history.
	await other.getByTestId('nav-historie').click();
	await other.getByTestId('product-open').filter({ hasText: 'Halfvolle melk' }).first().click();
	await expect(other.getByTestId('product-stats')).toContainText('3');
	await expect(other.getByTestId('product-stats')).not.toContainText('Volgende keer');
	await other.keyboard.press('Escape');

	// Kept on the server, after a reload and in the export; no data was removed.
	const snap = await snapshot(page);
	expect(snap.settings).toEqual({
		suggestionsEnabled: false,
		bulkAddEnabled: true,
		language: 'nl'
	});
	expect(snap.aiRecommendations).toHaveLength(1);
	await other.goto('/');
	await other.reload();
	await expect(other.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
	await expect(other.getByTestId('nav-suggesties')).toContainText('Snelkeuze');
	await expect(other.getByTestId('maybe-strip')).toHaveCount(0);
	const exported = await (await page.request.get('/api/export?format=json')).json();
	expect(exported.data.settings.suggestionsEnabled).toBe(false);

	// Restoring an export of before the switch brings everything back, also on the other device.
	exported.data.settings.suggestionsEnabled = true;
	await replaceWith(page, exported);
	await expect(other.getByTestId('maybe-strip')).toBeVisible();
	await expect(other.getByTestId('nav-badge')).toBeVisible();

	// A v1.4 export with "AI-functies tonen" off switches the suggestions off.
	delete exported.data.settings.suggestionsEnabled;
	exported.data.settings.aiEnabled = false;
	await replaceWith(page, exported);
	await expect(other.getByTestId('maybe-strip')).toHaveCount(0);
	expect((await snapshot(page)).settings.suggestionsEnabled).toBe(false);
	await other.context().close();
});

test('the household switches work offline and reach the other device once back online', async ({
	page,
	browser,
	baseURL
}) => {
	// Load both screens first: without the service worker (blocked in tests) an offline
	// navigation cannot fetch a screen it has not loaded yet.
	await freshApp(page, '/');
	await page.getByTestId('nav-beheer').click();
	const other = await device(browser, baseURL!, '/');
	await expect(other.getByTestId('bulk-open')).toBeVisible();

	await page.context().setOffline(true);
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
		timeout: 15_000
	});
	await page.getByTestId('setting-bulk').click();
	await expect(page.getByTestId('setting-bulk')).toHaveAttribute('aria-checked', 'false');
	await page.getByTestId('nav-lijst').click();
	await expect(page.getByTestId('bulk-open')).toHaveCount(0);
	// Not shared yet.
	await expect(other.getByTestId('bulk-open')).toBeVisible();

	await page.context().setOffline(false);
	await waitForSync(page);
	await expect(other.getByTestId('bulk-open')).toHaveCount(0);
	await other.context().close();
});

// ---------------------------------------------------------------------------- bulk add

test('"Meerdere toevoegen tonen" hides every way in, also paste and share; one product still works', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page, '/');
	const other = await device(browser, baseURL!, '/');

	// On (default): a multi-line paste opens the preview, nothing is added yet.
	await paste(page.getByTestId('add-input'), 'Melk\nBrood\n\n2 kg uien');
	await expect(page.getByTestId('bulk-sheet')).toBeVisible();
	await expect(page.getByTestId('bulk-line')).toHaveCount(3);
	await page.keyboard.press('Escape');
	await expect(page.getByTestId('bulk-sheet')).toHaveCount(0);
	expect((await snapshot(page)).items).toHaveLength(0);

	await page.goto('/beheer');
	await expect(page.getByTestId('setting-bulk')).toContainText('“Meerdere toevoegen” tonen');
	await expect(page.getByTestId('setting-bulk')).toHaveAttribute('aria-checked', 'true');
	await page.getByTestId('setting-bulk').click();
	await expect(page.getByTestId('setting-bulk')).toHaveAttribute('aria-checked', 'false');
	await waitForSync(page);
	expect((await snapshot(page)).settings.bulkAddEnabled).toBe(false);

	// Hidden live on the other device, in the list and in winkelstand.
	await expect(other.getByTestId('bulk-open')).toHaveCount(0);
	await other.getByTestId('shopping-enter').click();
	await other.getByTestId('shopping-add').click();
	await expect(other.getByTestId('add-input')).toBeVisible();
	await expect(other.getByTestId('bulk-open')).toHaveCount(0);
	await other.getByTestId('shopping-exit').click();

	// A multi-line paste only takes the first line and adds nothing by itself.
	await page.getByTestId('nav-lijst').click();
	const input = page.getByTestId('add-input');
	await paste(input, 'Melk\nBrood\nKaas');
	await expect(page.getByTestId('bulk-sheet')).toHaveCount(0);
	await expect(input).toHaveValue('Melk');
	await expect(page.getByTestId('toast')).toContainText('Alleen de eerste regel');
	await waitForSync(page);
	expect((await snapshot(page)).items).toHaveLength(0);
	await input.press('Enter');
	await expect(row(page, 'Melk')).toHaveCount(1);
	await addItems(page, 'Brood');
	await expect(page.locator('[data-testid=item-row]')).toHaveCount(2);

	// Shared text does not open the hidden feature and adds nothing.
	await page.goto('/delen?text=' + encodeURIComponent('Kaas\nEieren'));
	await expect(page.getByTestId('toast')).toContainText('niets uit de gedeelde tekst');
	await expect(page.getByTestId('bulk-sheet')).toHaveCount(0);
	await waitForSync(page);
	expect((await snapshot(page)).items).toHaveLength(2);

	// Survives a reload and is part of the export; an export without it stays importable.
	await page.reload();
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
	await expect(page.getByTestId('bulk-open')).toHaveCount(0);
	const exported = await (await page.request.get('/api/export?format=json')).json();
	expect(exported.data.settings.bulkAddEnabled).toBe(false);
	delete exported.data.settings.bulkAddEnabled;
	await replaceWith(page, exported);
	expect((await snapshot(page)).settings.bulkAddEnabled).toBe(false);
	exported.data.settings.bulkAddEnabled = true;
	await replaceWith(page, exported);
	await expect(other.getByTestId('bulk-open')).toBeVisible();
	await other.context().close();
});

// ---------------------------------------------------------------------------- ticking

/** Checks the circle's touch area: at least 48×48 and clear of the row's other buttons. */
async function expectComfortableCircle(r: Locator) {
	const toggle = await r.getByTestId('item-toggle').boundingBox();
	expect(toggle).not.toBeNull();
	expect(toggle!.width).toBeGreaterThanOrEqual(48);
	expect(toggle!.height).toBeGreaterThanOrEqual(48);
	const body = await r.getByTestId('item-body').boundingBox();
	const edit = await r.getByTestId('item-edit').boundingBox();
	for (const other of [body!, edit!])
		expect(
			toggle!.x + toggle!.width <= other.x + 0.5 || other.x + other.width <= toggle!.x + 0.5
		).toBe(true);
}

for (const viewport of [
	{ name: 'Pixel 10', width: 412, height: 923 },
	{ name: 'Galaxy A57', width: 384, height: 832 }
]) {
	test(`only the circle ticks off, in the list, winkelstand and a checklist @ ${viewport.name}`, async ({
		page
	}) => {
		await page.setViewportSize({ width: viewport.width, height: viewport.height });
		await freshApp(page, '/');
		await addItems(page, '2 l Melk', 'Brood');
		const melk = row(page, 'Melk');
		await expectComfortableCircle(melk);
		expect(await audit(page)).toEqual([]);

		// Name, quantity and the rest of the row open the editor and never tick off.
		await melk.getByTestId('item-name').click();
		await expect(page.getByTestId('item-sheet')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByTestId('item-sheet')).toHaveCount(0);
		await melk.getByTestId('item-qty').tap();
		await expect(page.getByTestId('item-sheet')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(melk).toHaveAttribute('data-status', 'active');
		await waitForSync(page);
		let snap = await snapshot(page);
		expect(snap.items.every((i: { status: string }) => i.status === 'active')).toBe(true);
		// Editing the quantity from there still works and does not tick off.
		await melk.getByTestId('item-name').click();
		await page.getByTestId('qty-plus').click();
		await page.getByTestId('edit-save').click();
		await expect(page.getByTestId('item-sheet')).toHaveCount(0);
		await expect(melk.getByTestId('item-qty')).toHaveText('2,5 l');
		await expect(melk).toHaveAttribute('data-status', 'active');

		// The circle ticks off; tapping it in the completed list puts the item back.
		await melk.getByTestId('item-toggle').tap();
		await expect(melk).toHaveAttribute('data-status', 'completed');
		const section = page.getByTestId('completed-toggle');
		if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
		await expect(melk).toBeVisible();
		await melk.getByTestId('item-name').click();
		await page.keyboard.press('Escape');
		await expect(melk).toHaveAttribute('data-status', 'completed');
		await melk.getByTestId('item-toggle').click();
		await expect(melk).toHaveAttribute('data-status', 'active');

		// Keyboard: the circle is a focusable button with a visible focus ring.
		const toggle = melk.getByTestId('item-toggle');
		await expect(toggle).toHaveAccessibleName('Melk afvinken');
		await toggle.focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Shift+Tab');
		await expect(toggle).toBeFocused();
		expect(await toggle.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
		await page.keyboard.press('Space');
		await expect(melk).toHaveAttribute('data-status', 'completed');
		await expect(page.getByRole('button', { name: 'Melk terugzetten op de lijst' })).toBeVisible();
		await page.getByRole('button', { name: 'Melk terugzetten op de lijst' }).press('Enter');
		await expect(melk).toHaveAttribute('data-status', 'active');

		// Winkelstand: rows stay in place; the row opens the actions, a double tap ticks once.
		await page.getByTestId('shopping-enter').click();
		const brood = row(page, 'Brood');
		await expectComfortableCircle(brood);
		expect(await audit(page)).toEqual([]);
		await brood.getByTestId('item-name').tap();
		await expect(page.getByTestId('item-sheet')).toBeVisible();
		await expect(page.getByTestId('action-unavailable')).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(brood).toHaveAttribute('data-status', 'active');
		// "Deels gehaald" from the row keeps the item on the list with what was bought.
		await melk.getByTestId('item-qty').tap();
		await page.getByTestId('action-partial').click();
		await page.getByTestId('partial-qty').fill('1');
		await page.getByTestId('partial-save').click();
		await expect(melk.getByTestId('item-bought')).toBeVisible();
		await expect(melk).toHaveAttribute('data-status', 'active');
		await brood.getByTestId('item-toggle').dblclick();
		await expect(brood).toHaveAttribute('data-status', 'completed');
		await page.waitForTimeout(500);
		await expect(brood).toHaveAttribute('data-status', 'completed');
		await waitForSync(page);
		snap = await snapshot(page);
		const broodItem = snap.items.find(
			(i: { productId: string }) =>
				snap.products.find((p: { id: string }) => p.id === i.productId)?.name === 'Brood'
		);
		expect(broodItem.status).toBe('completed');
		await page.getByTestId('shopping-exit').click();

		// Checklist: same behaviour.
		await page.goto('/beheer');
		await page.getByTestId('list-settings').first().getByTestId('list-kind-checklist').click();
		await page.getByTestId('confirm-ok').click();
		await page.getByTestId('nav-lijst').click();
		await expectComfortableCircle(melk);
		await melk.getByTestId('item-name').click();
		await page.keyboard.press('Escape');
		await expect(melk).toHaveAttribute('data-status', 'active');
		await melk.getByTestId('item-toggle').click();
		await expect(melk).toHaveAttribute('data-status', 'completed');
	});
}
