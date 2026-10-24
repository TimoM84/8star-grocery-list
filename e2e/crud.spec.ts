import { test, expect } from '@playwright/test';
import { activeNames, addItems, freshApp, row, waitForSync } from './helpers';

test.beforeEach(async ({ page }) => {
	await freshApp(page);
});

test('adds items with Enter and with the + button, keeping focus for fast entry', async ({
	page
}) => {
	const input = page.getByTestId('add-input');
	await input.fill('Melk');
	await input.press('Enter');
	await expect(row(page, 'Melk')).toBeVisible();
	await expect(input).toBeFocused();

	await input.fill('brood');
	await page.getByTestId('add-button').click();
	await expect(row(page, 'Brood')).toBeVisible();
	await expect(input).toHaveValue('');

	await expect(page.getByTestId('page-subtitle')).toHaveText('2 items te halen');
	await waitForSync(page);
	const snap = await (await page.request.get('/api/snapshot')).json();
	expect(snap.items).toHaveLength(2);
});

test('parses quantities and units from the entry', async ({ page }) => {
	await addItems(page, '2 kg aardappelen', 'eieren x10', '500 g gehakt');
	await expect(row(page, 'Aardappelen').getByTestId('item-qty')).toHaveText('2 kg');
	await expect(row(page, 'Eieren').getByTestId('item-qty')).toHaveText('10×');
	await expect(row(page, 'Gehakt').getByTestId('item-qty')).toHaveText('500 g');
});

test('prevents duplicates ignoring case and whitespace', async ({ page }) => {
	await addItems(page, 'Halfvolle melk');
	await page.getByTestId('add-input').fill('  HALFVOLLE   melk ');
	await page.getByTestId('add-input').press('Enter');
	await expect(page.getByTestId('toast')).toContainText('staat al op de lijst');
	await expect(page.locator('[data-testid=item-row]')).toHaveCount(1);
	await waitForSync(page);
	const snap = await (await page.request.get('/api/snapshot')).json();
	expect(snap.products).toHaveLength(1);
});

test('autocompletes from previous products and re-adds with one tap', async ({ page }) => {
	await addItems(page, 'Volkorenbrood', 'Komkommer');
	await row(page, 'Volkorenbrood').getByTestId('item-toggle').click();
	await page.getByTestId('add-input').fill('volk');
	const option = page.getByTestId('autocomplete-option').first();
	await expect(option).toContainText('Volkorenbrood');
	await expect(option).toContainText('afgevinkt');
	await option.click();
	await expect(row(page, 'Volkorenbrood')).toHaveAttribute('data-status', 'active');
	await expect(page.getByTestId('add-input')).toBeFocused();
});

test('completes and reactivates items; reactivation moves it to the top (newest)', async ({
	page
}) => {
	await addItems(page, 'Appels', 'Peren', 'Kiwi');
	await expect.poll(() => activeNames(page)).toEqual(['Kiwi', 'Peren', 'Appels']);

	await row(page, 'Appels').getByTestId('item-toggle').click();
	await expect(page.locator('[data-testid=completed-list] [data-name="Appels"]')).toBeVisible();
	await expect.poll(() => activeNames(page)).toEqual(['Kiwi', 'Peren']);

	await page
		.locator('[data-testid=completed-list] [data-name="Appels"] [data-testid=item-toggle]')
		.click();
	await expect.poll(() => activeNames(page)).toEqual(['Appels', 'Kiwi', 'Peren']);
	await expect(page.getByTestId('completed-toggle')).toBeHidden();
});

test('undo of a completion does not count a purchase', async ({ page }) => {
	await addItems(page, 'Kaas');
	await waitForSync(page);
	await row(page, 'Kaas').getByTestId('item-toggle').click();
	await waitForSync(page);
	await page.getByTestId('toast-action').click();
	await expect(row(page, 'Kaas')).toHaveAttribute('data-status', 'active');
	await waitForSync(page);
	await expect
		.poll(
			async () => (await (await page.request.get('/api/snapshot')).json()).products[0].purchaseCount
		)
		.toBe(0);
	await expect
		.poll(async () => (await (await page.request.get('/api/snapshot')).json()).items[0].status)
		.toBe('active');
});

test('edits name, quantity and unit', async ({ page }) => {
	await addItems(page, 'Tomaat');
	await row(page, 'Tomaat').getByTestId('item-edit').click();
	const sheet = page.getByTestId('item-sheet');
	await expect(sheet).toBeVisible();
	await sheet.getByTestId('edit-name').fill('Trostomaten');
	await sheet.getByTestId('qty-plus').click();
	await sheet.getByTestId('qty-plus').click();
	await sheet.getByTestId('unit-pak').click();
	await page.getByTestId('edit-save').click();
	await expect(sheet).toBeHidden();
	await expect(row(page, 'Trostomaten').getByTestId('item-qty')).toHaveText('2 pak');
	await waitForSync(page);
	const snap = await (await page.request.get('/api/snapshot')).json();
	expect(snap.products[0].name).toBe('Trostomaten');
	expect(snap.items[0]).toMatchObject({ quantity: 2, unit: 'pak' });
});

test('deletes an item after confirmation and can undo', async ({ page }) => {
	await addItems(page, 'Chips');
	await row(page, 'Chips').getByTestId('item-edit').click();
	await page.getByTestId('edit-delete').click();
	await expect(page.getByTestId('confirm-dialog')).toBeVisible();
	await page.getByRole('button', { name: 'Annuleren' }).last().click();
	await expect(page.getByTestId('confirm-dialog')).toBeHidden();
	await expect(page.getByTestId('item-sheet')).toBeVisible();

	await page.getByTestId('edit-delete').click();
	await page.getByTestId('confirm-ok').click();
	await expect(page.getByTestId('item-sheet')).toBeHidden();
	await expect(row(page, 'Chips')).toHaveCount(0);
	await page.getByTestId('toast-action').click();
	await expect(row(page, 'Chips')).toBeVisible();
});

test('back gesture closes the edit sheet instead of leaving the app', async ({ page }) => {
	await addItems(page, 'Rijst');
	await row(page, 'Rijst').getByTestId('item-edit').click();
	await expect(page.getByTestId('item-sheet')).toBeVisible();
	await page.goBack();
	await expect(page.getByTestId('item-sheet')).toBeHidden();
	await expect(page).toHaveURL(/\/$/);
	await expect(row(page, 'Rijst')).toBeVisible();
});

test('sorts newest, oldest and A–Z (Dutch) and remembers the choice', async ({ page }) => {
	await addItems(page, 'zout', 'Appel', 'ijs', 'Éclair', 'banaan');
	await expect.poll(() => activeNames(page)).toEqual(['Banaan', 'Éclair', 'Ijs', 'Appel', 'Zout']);

	await page.getByTestId('sort-oldest').click();
	await expect(page.getByTestId('sort-oldest')).toHaveAttribute('aria-checked', 'true');
	await expect.poll(() => activeNames(page)).toEqual(['Zout', 'Appel', 'Ijs', 'Éclair', 'Banaan']);

	await page.getByTestId('sort-az').click();
	await expect.poll(() => activeNames(page)).toEqual(['Appel', 'Banaan', 'Éclair', 'Ijs', 'Zout']);

	await page.reload();
	await expect(page.getByTestId('sort-az')).toHaveAttribute('aria-checked', 'true');
	await expect.poll(() => activeNames(page)).toEqual(['Appel', 'Banaan', 'Éclair', 'Ijs', 'Zout']);
});

test('completed section collapses and clears with confirmation', async ({ page }) => {
	await addItems(page, 'A1', 'B1', 'C1');
	await row(page, 'A1').getByTestId('item-toggle').click();
	await row(page, 'B1').getByTestId('item-toggle').click();
	await expect(page.getByTestId('completed-list').locator('[data-testid=item-row]')).toHaveCount(2);
	await page.getByTestId('completed-toggle').click();
	await expect(page.getByTestId('completed-list')).toBeHidden();
	await page.reload();
	await expect(page.getByTestId('completed-list')).toBeHidden();
	await page.getByTestId('completed-toggle').click();
	await page.getByTestId('clear-completed').click();
	await page.getByTestId('confirm-ok').click();
	await expect(page.getByTestId('completed-toggle')).toBeHidden();
	await expect.poll(() => activeNames(page)).toEqual(['C1']);
});

test('state survives a reload (server persistence and local cache)', async ({ page }) => {
	await addItems(page, 'Koffie', 'Thee');
	await row(page, 'Thee').getByTestId('item-toggle').click();
	await waitForSync(page);
	await page.reload();
	await expect(row(page, 'Koffie')).toHaveAttribute('data-status', 'active');
	await expect(row(page, 'Thee')).toHaveAttribute('data-status', 'completed');
});
