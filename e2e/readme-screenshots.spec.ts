import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { addItems, audit, freshApp, postOps, row, seedPurchases, waitForSync } from './helpers';

/**
 * The README screenshots, in English (the default language). Written to screenshots/readme/;
 * copy them to docs/screenshots/ to refresh the README. Every shot also passes the layout audit.
 */

const DIR = 'screenshots/readme';
fs.mkdirSync(DIR, { recursive: true });

test.use({ viewport: { width: 390, height: 844 } });

async function seed(page: Page) {
	await freshApp(page, '/', 'en');
	await seedPurchases(page.request, 'Semi-skimmed milk', 6, 7, 7);
	await seedPurchases(page.request, 'Wholemeal bread', 8, 3, 1);
	await seedPurchases(page.request, 'Bananas', 5, 5, 4);
	await postOps(page.request, [
		{ type: 'list.create', listId: 'drogist', name: 'Pharmacy' },
		{
			type: 'bundle.save',
			bundleId: 'b1',
			name: 'Pancakes',
			servings: 4,
			lines: [
				{ lineId: 'l1', productId: 'p-flour', name: 'Flour', quantity: 500, unit: 'g', note: null },
				{ lineId: 'l2', productId: 'p-egg', name: 'Eggs', quantity: 3, unit: null, note: null },
				{ lineId: 'l3', productId: 'p-milk2', name: 'Milk', quantity: 1, unit: 'l', note: null }
			]
		}
	]);
	await page.reload();
	await addItems(
		page,
		'2 kg potatoes',
		'Eggs x10',
		'Greek yoghurt',
		'Unsalted butter',
		'Chicken breast',
		'500 g mince',
		'3 bottles sparkling water',
		'Tomatoes',
		'Toilet paper'
	);
	await row(page, 'Tomatoes').getByTestId('item-toggle').click();
	await row(page, 'Chicken breast').getByTestId('item-toggle').click();
	await waitForSync(page);
	const snap = await (await page.request.get('/api/snapshot')).json();
	const yoghurt = snap.products.find((p: { name: string }) => p.name === 'Greek yoghurt');
	await postOps(page.request, [
		{ type: 'product.update', productId: yoghurt.id, changes: { favorite: true }, base: {} }
	]);
	const milk = snap.products.find((p: { name: string }) => p.name === 'Semi-skimmed milk');
	const res = await page.request.post('/api/import?kind=ai&mode=merge', {
		headers: { 'content-type': 'application/octet-stream' },
		data: JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			source: 'ChatGPT',
			recommendations: [
				{
					productId: milk.id,
					suggestedQuantity: 2,
					unit: 'l',
					nextPurchaseDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
					confidence: 0.82,
					reasoning:
						'You buy semi-skimmed milk every week and the last purchase was seven days ago; two litres cover the coming week.'
				}
			]
		})
	});
	expect((await res.json()).ok).toBe(true);
	await page.reload();
	await expect(page.locator('[data-testid=item-row]').first()).toBeVisible();
}

async function shot(page: Page, name: string, fullPage = false) {
	await page.waitForTimeout(150);
	expect(await audit(page), name).toEqual([]);
	await page.screenshot({ path: `${DIR}/${name}.png`, fullPage });
}

test('README screenshots in English', async ({ page }) => {
	test.setTimeout(120_000);
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await seed(page);

	await shot(page, 'list-light');
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await shot(page, 'list-dark');
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });

	await page.goto('/suggesties');
	await expect(page.getByTestId('ai-card')).toHaveCount(1);
	await shot(page, 'suggestions');
	await page.getByTestId('bundle-use').click();
	await shot(page, 'bundle');
	await page.goBack();

	await page.goto('/beheer/gegevens');
	await expect(page.getByTestId('page-title')).toBeVisible();
	await shot(page, 'data');

	await page.goto('/beheer');
	await page.getByTestId('setting-language').scrollIntoViewIfNeeded();
	await shot(page, 'settings-language');

	await page.goto('/');
	await row(page, 'Greek yoghurt').getByTestId('item-edit').click();
	await page.getByTestId('edit-note').fill('plain, large tub');
	await page.getByTestId('edit-substitute').click();
	await shot(page, 'edit');
	await page.getByTestId('edit-save').click();

	const input = page.getByTestId('add-input');
	await input.fill('1 kg potatoes');
	await input.press('Enter');
	await expect(page.getByTestId('add-prompt')).toBeVisible();
	await shot(page, 'already-on-list');
	await page.getByTestId('add-prompt-cancel').click();

	await page.getByTestId('bulk-open').click();
	await page
		.getByTestId('bulk-text')
		.fill('- milk\n- cheese, mature\n- 2 kg apples\n- cheese, mature');
	await page.getByTestId('bulk-preview').click();
	await shot(page, 'several');
	await page.goBack();

	await page.getByTestId('shopping-enter').click();
	await expect(page.getByTestId('shopping-bar')).toBeVisible();
	await row(page, 'Greek yoghurt').getByTestId('item-toggle').click();
	await page.getByTestId('toast').waitFor();
	await shot(page, 'shopping-light');
	await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
	await shot(page, 'shopping-dark');
	await row(page, 'Sparkling water').getByTestId('item-edit').click();
	await shot(page, 'actions-dark');
	await page.goBack();
	await page.getByTestId('shopping-exit').click();

	// The same list in German, to show the language switch.
	await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
	await postOps(page.request, [{ type: 'settings.update', language: 'de' }]);
	await expect(page.getByTestId('page-title')).toHaveText('Einkäufe');
	await page.reload();
	await expect(page.getByTestId('page-title')).toHaveText('Einkäufe');
	await shot(page, 'list-german');
});
