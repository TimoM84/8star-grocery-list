import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import { addItems, audit, freshApp, postOps, row, seedPurchases, waitForSync } from './helpers';

/**
 * UI language: English by default, a household-wide choice in Beheer, live on every device,
 * and a layout audit of the main screens in every language (German and French run long).
 */

const SHOT_DIR = 'screenshots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function device(browser: Browser, baseURL: string, path = '/'): Promise<Page> {
	const ctx = await browser.newContext({
		baseURL,
		viewport: { width: 390, height: 844 },
		isMobile: true,
		hasTouch: true,
		locale: 'en-GB',
		reducedMotion: 'reduce',
		serviceWorkers: 'block'
	});
	const page = await ctx.newPage();
	await page.goto(path);
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
	return page;
}

test('a fresh install is English; the language picked in Beheer applies live to every device', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page, '/', 'en');
	await expect(page.locator('html')).toHaveAttribute('lang', 'en');
	await expect(page.getByTestId('page-title')).toHaveText('Groceries');
	await expect(page.getByTestId('add-input')).toHaveAttribute('placeholder', 'What do we need?');
	await expect(page.getByTestId('nav-beheer')).toContainText('Settings');

	await addItems(page, '2 bottles cola', '1.5 kg potatoes');
	await expect(row(page, 'Cola').getByTestId('item-qty')).toHaveText('2 bottles');
	await expect(row(page, 'Potatoes').getByTestId('item-qty')).toHaveText('1.5 kg');
	await waitForSync(page);

	const other = await device(browser, baseURL!);
	await expect(other.getByTestId('nav-lijst')).toContainText('List');

	await page.goto('/beheer');
	const picker = page.getByTestId('setting-language');
	await expect(picker.getByRole('radio', { checked: true })).toHaveText('English');
	await page.getByTestId('language-nl').click();
	await expect(page.getByTestId('toast')).toContainText(
		'Taal op alle apparaten gewijzigd naar Nederlands'
	);
	await expect(page.getByTestId('language-nl')).toHaveAttribute('aria-checked', 'true');
	await expect(picker).toContainText('Taal · Language');
	await expect(page.locator('html')).toHaveAttribute('lang', 'nl');

	// The other device follows without a reload, including seeded names and units.
	await expect(other.getByTestId('nav-lijst')).toContainText('Lijst');
	await expect(other.getByTestId('page-title')).toHaveText('Boodschappen');
	await expect(row(other, 'Cola').getByTestId('item-qty')).toHaveText('2 fles');
	await expect(row(other, 'Potatoes').getByTestId('item-qty')).toHaveText('1,5 kg');

	await page.getByTestId('language-de').click();
	await expect(other.getByTestId('page-title')).toHaveText('Einkäufe');
	await expect(row(other, 'Cola').getByTestId('item-qty')).toHaveText('2 Flaschen');
	await expect(other.getByTestId('add-input')).toHaveAttribute('placeholder', 'Was brauchen wir?');

	// Typed names never change, and the choice survives a reload (also before the first sync).
	await other.reload();
	await expect(other.getByTestId('nav-beheer')).toContainText('Verwaltung');
	await expect(row(other, 'Potatoes')).toBeVisible();

	// The server shell and manifest follow too.
	const html = await (await page.request.get('/')).text();
	expect(html).toContain('<html lang="de">');
	expect(html).toContain('<title>8star Einkäufe</title>');

	await page.getByTestId('language-en').click();
	await expect(other.getByTestId('page-title')).toHaveText('Groceries');
	await other.context().close();
});

const PAGES = [
	{ path: '/', name: 'list' },
	{ path: '/suggesties', name: 'suggestions' },
	{ path: '/historie', name: 'history' },
	{ path: '/beheer', name: 'settings' },
	{ path: '/beheer/gegevens', name: 'data' }
];

for (const language of ['en', 'nl', 'de', 'fr', 'es']) {
	test(`layout in ${language}: no overflow or clipping at 320 and 390 px`, async ({ page }) => {
		await freshApp(page, '/', language);
		await seedPurchases(page.request, 'Milk', 4, 7, 7);
		await postOps(page.request, [
			{
				type: 'bundle.save',
				bundleId: 'b1',
				name: 'Pancakes',
				servings: 4,
				lines: [
					{
						lineId: 'l1',
						productId: 'p-flour',
						name: 'Flour',
						quantity: 500,
						unit: 'g',
						note: null
					},
					{ lineId: 'l2', productId: 'p-egg', name: 'Eggs', quantity: 3, unit: null, note: null }
				]
			}
		]);
		await page.reload();
		await addItems(page, '2 kg potatoes', '3 pak yoghurt', 'Bread', 'Tomatoes');
		await row(page, 'Tomatoes').getByTestId('item-toggle').click();
		await waitForSync(page);
		for (const width of [320, 390]) {
			await page.setViewportSize({ width, height: width === 320 ? 640 : 844 });
			for (const p of PAGES) {
				await page.goto(p.path);
				await expect(page.getByTestId('page-title')).toBeVisible();
				await page.waitForTimeout(150);
				expect(await audit(page), `${p.name} @ ${width} (${language})`).toEqual([]);
			}
			await page.goto('/');
			await page.getByTestId('shopping-enter').click();
			await expect(page.getByTestId('shopping-bar')).toBeVisible();
			expect(await audit(page), `shopping @ ${width} (${language})`).toEqual([]);
			await row(page, 'Bread').getByTestId('item-edit').click();
			expect(await audit(page), `actions @ ${width} (${language})`).toEqual([]);
			await page.goBack();
			await page.getByTestId('shopping-exit').click();
			if (width === 390) await page.screenshot({ path: `${SHOT_DIR}/lang-${language}-list.png` });
		}
	});
}
