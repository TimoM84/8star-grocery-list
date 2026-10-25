import { test, expect } from '@playwright/test';
import { activeNames, addItems, freshApp, row, waitForSync } from './helpers';

test.beforeEach(async ({ page }) => {
	await freshApp(page);
});

test('manages multiple independent lists and moves items between them', async ({ page }) => {
	await addItems(page, 'Melk', 'Shampoo');

	await page.getByTestId('nav-beheer').click();
	await page.getByTestId('lists-new').fill('Drogist');
	await page.getByTestId('lists-add').click();
	await expect(page.getByTestId('lists-row')).toHaveCount(2);

	// Rename via inline edit.
	await page.getByTestId('lists-name').nth(1).click();
	await page.getByTestId('lists-rename-input').fill('Kruidvat');
	await page.getByTestId('lists-rename-input').press('Enter');
	await expect(page.getByTestId('lists')).toContainText('Kruidvat');

	await page.getByTestId('nav-lijst').click();
	await expect(page.getByTestId('list-chip')).toHaveCount(2);

	// Move Shampoo to the new list.
	await row(page, 'Shampoo').getByTestId('item-edit').click();
	await page.getByTestId('edit-more').click();
	await page.getByTestId('move-list-option').filter({ hasText: 'Kruidvat' }).click();
	await page.getByTestId('edit-save').click();
	await expect.poll(() => activeNames(page)).toEqual(['Melk']);

	await page.getByTestId('list-chip').filter({ hasText: 'Kruidvat' }).click();
	await expect(page.getByTestId('page-title')).toHaveText('Kruidvat');
	await expect.poll(() => activeNames(page)).toEqual(['Shampoo']);

	// Same product may live on both lists independently.
	await addItems(page, 'Melk');
	await expect.poll(() => activeNames(page)).toEqual(['Melk', 'Shampoo']);
	await row(page, 'Melk').getByTestId('item-toggle').click();
	await page.getByTestId('list-chip').filter({ hasText: 'Boodschappen' }).click();
	await expect(row(page, 'Melk')).toHaveAttribute('data-status', 'active');

	// Selected list is remembered.
	await page.getByTestId('list-chip').filter({ hasText: 'Kruidvat' }).click();
	await page.reload();
	await expect(page.getByTestId('page-title')).toHaveText('Kruidvat');

	// Reorder and delete.
	await page.getByTestId('nav-beheer').click();
	await page.getByTestId('lists-up').nth(1).click();
	await expect(page.getByTestId('lists-name').first()).toContainText('Kruidvat');
	await page.getByTestId('lists-delete').first().click();
	await page.getByTestId('confirm-ok').click();
	await expect(page.getByTestId('lists-row')).toHaveCount(1);
	await expect(page.getByTestId('lists-delete')).toBeDisabled();
	await waitForSync(page);
	const snap = await (await page.request.get('/api/snapshot')).json();
	expect(snap.lists.map((l: { name: string }) => l.name)).toEqual(['Boodschappen']);
});

test('categories: guessing, ordering and grouping', async ({ page }) => {
	await addItems(page, 'Bananen', 'Shampoo', 'Melk', 'Iets onbekends');
	await page.getByTestId('group-toggle').click();
	const headings = page.getByTestId('category-group').locator('h3');
	await expect(headings).toHaveText(['Groente & fruit', 'Zuivel & eieren', 'Verzorging', 'Overig']);

	// Move "Verzorging" to the top in Beheer.
	await page.getByTestId('nav-beheer').click();
	const rows = page.getByTestId('categories-row');
	for (let i = 0; i < 9; i++) {
		await rows.filter({ hasText: 'Verzorging' }).getByTestId('categories-up').click();
	}
	await expect(page.getByTestId('categories-name').first()).toContainText('Verzorging');
	await page.getByTestId('categories-new').fill('Baby');
	await page.getByTestId('categories-add').click();
	await expect(rows.filter({ hasText: 'Baby' })).toHaveCount(1);

	await page.getByTestId('nav-lijst').click();
	await expect(headings).toHaveText(['Verzorging', 'Groente & fruit', 'Zuivel & eieren', 'Overig']);

	// Assign a category to the unknown product.
	await row(page, 'Iets onbekends').getByTestId('item-edit').click();
	await page.getByTestId('edit-more').click();
	await page.getByTestId('category-option').filter({ hasText: 'Baby' }).click();
	await page.getByTestId('edit-save').click();
	await expect(headings).toHaveText(['Verzorging', 'Groente & fruit', 'Zuivel & eieren', 'Baby']);

	// Grouping preference persists.
	await page.reload();
	await expect(page.getByTestId('group-toggle')).toHaveAttribute('aria-pressed', 'true');
});

test('favorites can be set and re-added with one tap', async ({ page }) => {
	await addItems(page, 'Pindakaas');
	await row(page, 'Pindakaas').getByTestId('item-edit').click();
	await page.getByTestId('edit-more').click();
	await page.getByTestId('edit-favorite').click();
	await page.getByTestId('edit-save').click();
	await row(page, 'Pindakaas').getByTestId('item-toggle').click();

	await page.getByTestId('nav-suggesties').click();
	const fav = page.getByTestId('favorites-section').getByTestId('product-row');
	await expect(fav).toHaveCount(1);
	await fav.getByTestId('product-quick-add').click();
	await page.getByTestId('nav-lijst').click();
	await expect(row(page, 'Pindakaas')).toHaveAttribute('data-status', 'active');
});
