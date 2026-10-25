import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import { addItems, freshApp, row, seedPurchases, waitForSync } from './helpers';

async function snapshot(page: Page) {
	return (await page.request.get('/api/snapshot')).json();
}

async function secondDevice(browser: Browser, baseURL: string): Promise<Page> {
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

test('full JSON export → replace restore round trip through the UI, synced to other devices', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page);
	await seedPurchases(page.request, 'Halfvolle melk', 4, 7, 2);
	await page.reload();
	await addItems(page, '2 kg aardappelen', 'Kaas');
	await row(page, 'Kaas').getByTestId('item-toggle').click();
	await waitForSync(page);
	const before = await snapshot(page);

	await page.goto('/beheer/gegevens');
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-json').click()
	]);
	expect(download.suggestedFilename()).toMatch(/^8star-export-\d{4}-\d{2}-\d{2}\.json$/);
	const file = await download.path();
	const exported = JSON.parse(fs.readFileSync(file, 'utf8'));
	expect(exported.format).toBe('8star-grocery-export');

	// Change things after the export, on a second device too.
	const other = await secondDevice(browser, baseURL!);
	await addItems(other, 'Na de export');
	await waitForSync(other);

	await page.getByTestId('import-file').setInputFiles(file);
	await expect(page.getByTestId('import-preview')).toHaveAttribute('data-ok', 'true');
	await page.getByTestId('import-replace').click();
	await expect(page.getByTestId('confirm-dialog')).toContainText('verwijderd');
	await page.getByTestId('confirm-ok').click();
	await expect(page.getByTestId('import-result')).toHaveAttribute('data-ok', 'true');
	await expect(page.getByTestId('import-result')).toContainText('Back-up vooraf');

	const after = await snapshot(page);
	expect(after.products.map((p: { id: string }) => p.id).sort()).toEqual(
		before.products.map((p: { id: string }) => p.id).sort()
	);
	expect(after.items).toEqual(
		before.items.map((i: object) => ({
			...i,
			version: 1,
			updatedAt: (i as { updatedAt: number }).updatedAt
		}))
	);
	expect(after.epoch).not.toBe(before.epoch);

	// The other device is told and shows the restored data.
	await expect(other.getByTestId('toast')).toContainText('vervangen');
	await expect(row(other, 'Na de export')).toHaveCount(0);
	await expect(row(other, 'Aardappelen')).toBeVisible();
	await other.context().close();
});

test('merge import of products and purchases CSV with preview and duplicate detection', async ({
	page
}) => {
	await freshApp(page);
	await addItems(page, 'Melk');
	await waitForSync(page);
	await page.goto('/beheer/gegevens');

	await page.getByTestId('import-kind-products-csv').click();
	await page.getByTestId('import-file').setInputFiles({
		name: 'producten.csv',
		mimeType: 'text/csv',
		buffer: Buffer.from(
			'product;categorie;favoriet\nmelk;;ja\nPindakaas;Ontbijt;nee\nPindakaas;;\n'
		)
	});
	const preview = page.getByTestId('import-preview');
	await expect(preview).toContainText('1 product wordt toegevoegd');
	await expect(preview).toContainText('1 product wordt bijgewerkt');
	await expect(preview).toContainText('1 dubbel');
	expect((await snapshot(page)).products).toHaveLength(1);
	await page.getByTestId('import-merge').click();
	await expect(page.getByTestId('import-result')).toContainText('1 product toegevoegd');
	const snap = await snapshot(page);
	expect(snap.products.find((p: { name: string }) => p.name === 'Melk').favorite).toBe(true);

	await page.getByRole('button', { name: 'Nog een bestand importeren' }).click();
	await page.getByTestId('import-kind-purchases-csv').click();
	const purchases = Buffer.from(
		'product,gekocht,aantal\nPindakaas,2026-09-01 10:00,1\nPindakaas,2026-09-15 10:00,2\n'
	);
	await page
		.getByTestId('import-file')
		.setInputFiles({ name: 'aankopen.csv', mimeType: 'text/csv', buffer: purchases });
	await expect(page.getByTestId('import-preview')).toContainText('2 aankopen worden toegevoegd');
	await page.getByTestId('import-merge').click();
	await expect(page.getByTestId('import-result')).toContainText('2 aankopen toegevoegd');
	await page.getByRole('button', { name: 'Nog een bestand importeren' }).click();
	await page.getByTestId('import-kind-purchases-csv').click();
	await page
		.getByTestId('import-file')
		.setInputFiles({ name: 'aankopen.csv', mimeType: 'text/csv', buffer: purchases });
	await expect(page.getByTestId('import-preview')).toContainText('2 dubbel');

	await page.goto('/historie');
	await expect(page.locator('[data-testid=product-row][data-name="Pindakaas"]')).toContainText(
		'2× gekocht'
	);
});

test('invalid files are rejected with readable errors and nothing changes', async ({ page }) => {
	await freshApp(page);
	await addItems(page, 'Brood');
	await waitForSync(page);
	const before = await snapshot(page);
	await page.goto('/beheer/gegevens');
	await page.getByTestId('import-file').setInputFiles({
		name: 'kapot.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify({
				format: '8star-grocery-export',
				formatVersion: 1,
				data: {
					lists: [],
					categories: [],
					products: [{ id: 'x', name: '', createdAt: 'nooit' }],
					listItems: [],
					purchaseEvents: []
				}
			})
		)
	});
	const preview = page.getByTestId('import-preview');
	await expect(preview).toHaveAttribute('data-ok', 'false');
	await expect(preview).toContainText('Import geweigerd');
	await expect(page.getByTestId('import-preview-errors')).toContainText('ongeldige datum');
	await expect(page.getByTestId('import-merge')).toHaveCount(0);
	expect((await snapshot(page)).seq).toBe(before.seq);

	// The API refuses a replace without explicit confirmation.
	const res = await page.request.post('/api/import?kind=json&mode=replace', {
		data: JSON.stringify({ format: '8star-grocery-export', formatVersion: 1, data: {} }),
		headers: { 'content-type': 'application/octet-stream' }
	});
	expect(res.status()).toBe(428);
});

test('AI recommendations: import, accept with one tap, dismiss, undo and duplicate prevention', async ({
	page
}) => {
	await freshApp(page);
	await seedPurchases(page.request, 'Halfvolle melk', 3, 7, 1);
	await seedPurchases(page.request, 'Koffiebonen', 2, 14, 3);
	await page.reload();
	const snap = await snapshot(page);
	const id = (name: string) => snap.products.find((p: { name: string }) => p.name === name).id;
	const historyBefore = snap.products.map((p: { purchaseCount: number }) => p.purchaseCount);
	const aiFile = {
		name: 'ai.json',
		mimeType: 'application/json',
		buffer: Buffer.from(
			JSON.stringify({
				format: '8star-ai-recommendations',
				formatVersion: 1,
				source: 'ChatGPT',
				recommendations: [
					{
						productId: id('Halfvolle melk'),
						suggestedQuantity: 2,
						unit: 'l',
						nextPurchaseDate: '2026-11-02',
						confidence: 0.82,
						reasoning: 'Je koopt wekelijks melk; 2 liter dekt de week.'
					},
					{
						productId: id('Koffiebonen'),
						suggestedQuantity: 1,
						unit: 'kg',
						confidence: 0.55,
						reasoning: 'Om de twee weken, de laatste was 3 dagen geleden.'
					},
					{ productId: 'bestaat-niet', confidence: 0.9, reasoning: 'x' }
				]
			})
		)
	};

	await page.goto('/suggesties');
	await expect(page.getByTestId('ai-empty')).toBeVisible();
	await page.getByTestId('ai-import-open').click();
	await page.getByTestId('ai-import-file').setInputFiles(aiFile);
	await expect(page.getByTestId('ai-import-preview')).toContainText(
		'2 AI-suggesties worden toegevoegd'
	);
	await expect(page.getByTestId('ai-import-preview-warnings')).toContainText('bestaat niet');
	await page.getByTestId('ai-import-merge').click();
	await expect(page.getByTestId('ai-import-result')).toContainText('2 AI-suggesties toegevoegd');
	const cards = page.getByTestId('ai-card');
	await expect(cards).toHaveCount(2);
	const melk = page.locator('[data-testid=ai-card][data-name="Halfvolle melk"]');
	await expect(melk.getByTestId('ai-qty')).toHaveText('2 l');
	await expect(melk.getByTestId('ai-meta')).toContainText('inschatting: waarschijnlijk');
	await expect(melk.getByTestId('ai-reasoning')).toContainText('wekelijks');
	// Details (full reasoning, stated confidence as an estimate) are one tap away.
	await expect(melk.getByTestId('ai-details')).toHaveCount(0);
	await melk.getByTestId('ai-more').click();
	await expect(melk.getByTestId('ai-details')).toContainText('82%');
	await expect(melk.getByTestId('ai-details')).toContainText('geen zekerheid');

	// Nothing was added to the list automatically.
	expect(
		(await snapshot(page)).items.filter((i: { status: string }) => i.status === 'active')
	).toHaveLength(0);

	// Re-importing the same file creates no duplicates.
	await page.getByRole('button', { name: 'Nog een bestand importeren' }).click();
	await page.getByTestId('ai-import-file').setInputFiles(aiFile);
	await expect(page.getByTestId('ai-import-preview')).toContainText('2 dubbel');
	await page.getByRole('button', { name: 'Sluiten' }).click();

	await melk.getByTestId('ai-accept').click();
	await expect(cards).toHaveCount(1);
	await page
		.locator('[data-testid=ai-card][data-name="Koffiebonen"]')
		.getByTestId('ai-dismiss')
		.click();
	await expect(cards).toHaveCount(0);
	await page.getByTestId('toast-action').click(); // undo the dismissal
	await expect(cards).toHaveCount(1);
	await waitForSync(page);

	const after = await snapshot(page);
	const melkItem = after.items.find(
		(i: { productId: string }) => i.productId === id('Halfvolle melk')
	);
	expect(melkItem).toMatchObject({ status: 'active', quantity: 2, unit: 'l' });
	expect(after.aiRecommendations.map((r: { productId: string }) => r.productId)).toEqual([
		id('Koffiebonen')
	]);
	// Real purchase history is untouched.
	expect(after.products.map((p: { purchaseCount: number }) => p.purchaseCount)).toEqual(
		historyBefore
	);

	await page.goto('/');
	await expect(row(page, 'Halfvolle melk').getByTestId('item-qty')).toHaveText('2 l');
});

test('an offline device keeps its queued edits across a restore done elsewhere', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page);
	await addItems(page, 'Appels');
	await waitForSync(page);
	const backup = await (await page.request.get('/api/export?format=json')).text();

	const other = await secondDevice(browser, baseURL!);
	await other.context().setOffline(true);
	await expect(other.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
		timeout: 15_000
	});
	await addItems(other, 'Peren');
	await row(other, 'Appels').getByTestId('item-toggle').click();

	const res = await page.request.post('/api/import?kind=json&mode=replace', {
		data: backup,
		headers: { 'content-type': 'application/octet-stream', 'x-confirm-replace': 'VERVANGEN' }
	});
	expect((await res.json()).ok).toBe(true);

	await other.context().setOffline(false);
	await waitForSync(other);
	const snap = await snapshot(page);
	expect(snap.products.map((p: { name: string }) => p.name).sort()).toEqual(['Appels', 'Peren']);
	expect(
		snap.items.find(
			(i: { productId: string }) =>
				i.productId === snap.products.find((p: { name: string }) => p.name === 'Appels').id
		).status
	).toBe('completed');
	await expect(row(page, 'Peren')).toBeVisible();
	await other.context().close();
});
