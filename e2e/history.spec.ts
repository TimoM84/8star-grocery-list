import { test, expect } from '@playwright/test';
import { freshApp, row, seedPurchases } from './helpers';

test('suggestions, frequent products, statistics and searchable history', async ({ page }) => {
	await freshApp(page);
	// Weekly milk, last bought 7 days ago -> due now.
	await seedPurchases(page.request, 'Melk', 6, 7, 7);
	// Bread every 3 days, bought yesterday -> not due yet.
	await seedPurchases(page.request, 'Brood', 8, 3, 1);
	// Only 2 purchases -> below the minimum history threshold.
	await seedPurchases(page.request, 'Kaas', 2, 7, 10);
	await page.reload();

	// Main screen strip shows only the due product, never auto-added.
	await expect(page.getByTestId('maybe-chip')).toHaveText(['Melk']);
	await expect(page.locator('[data-testid=item-row][data-status=active]')).toHaveCount(0);

	await page.getByTestId('nav-suggesties').click();
	const sugg = page.getByTestId('suggestions-section').getByTestId('product-row');
	await expect(sugg).toHaveCount(1);
	await expect(sugg).toContainText('elke 7 dagen');
	await expect(
		page.getByTestId('frequent-section').getByTestId('product-row').first()
	).toContainText('Brood');

	// One-tap reactivation.
	await sugg.getByTestId('product-quick-add').click();
	await expect(page.getByTestId('suggestions-section').getByTestId('no-suggestions')).toBeVisible();
	await page.getByTestId('nav-lijst').click();
	await expect(row(page, 'Melk')).toHaveAttribute('data-status', 'active');

	// Product statistics.
	await page.getByTestId('nav-historie').click();
	await page.getByTestId('history-search').fill('bro');
	await expect(page.getByTestId('product-row')).toHaveCount(1);
	await page.getByTestId('product-open').click();
	const stats = page.getByTestId('product-stats');
	await expect(stats).toContainText('8');
	await expect(stats).toContainText('elke 3 dagen');
	await expect(stats).toContainText('10× per maand');
	await expect(stats).toContainText('over 2 dagen');
	await expect(page.getByTestId('product-cycles').locator('li')).toHaveCount(8);
	await page.goBack();

	// Purchase history tab with search.
	await page.getByTestId('history-tab-purchases').click();
	await page.getByTestId('history-search').fill('kaas');
	await expect(page.getByTestId('purchase-row')).toHaveCount(2);
	await page.getByTestId('history-search').fill('');
	await expect(page.getByTestId('purchase-row')).toHaveCount(16);
});

test('exports CSV and JSON', async ({ page }) => {
	await freshApp(page);
	await seedPurchases(page.request, 'Koffie', 3, 10, 2);
	await page.getByTestId('nav-beheer').click();

	const [csv] = await Promise.all([
		page.waitForEvent('download'),
		page.getByTestId('export-csv').click()
	]);
	expect(csv.suggestedFilename()).toMatch(/^8star-aankopen-.*\.csv$/);
	const text = await (await csv.createReadStream()).toArray();
	const content = Buffer.concat(text as Buffer[]).toString('utf8');
	expect(content.split('\r\n')[0]).toContain('product;categorie;lijst;status');
	expect(content.match(/Koffie;/g)).toHaveLength(3);

	const res = await page.request.get('/api/export?format=json');
	const json = await res.json();
	expect(json.cycles).toHaveLength(3);
	expect(json.statistics[0]).toMatchObject({ name: 'Koffie', purchaseCount: 3 });

	const products = await page.request.get('/api/export?format=csv&type=products');
	expect(await products.text()).toContain('aantal_keer_gekocht');
});
