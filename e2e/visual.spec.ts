import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { addItems, audit, freshApp, postOps, seedPurchases, waitForSync } from './helpers';

/**
 * Mobile layout audit. Screenshots land in screenshots/ for manual inspection; the assertions
 * enforce the hard rules (no overflow, no clipping, ≥48px targets, visible sort controls,
 * no dropdowns).
 */

const SHOT_DIR = 'screenshots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const WIDTHS = [
	{ width: 320, height: 640 },
	{ width: 360, height: 780 },
	{ width: 390, height: 844 },
	{ width: 430, height: 932 }
];
const SHOT_WIDTHS = new Set([360, 390, 430]);
const PAGES = [
	{ path: '/', name: 'lijst' },
	{ path: '/suggesties', name: 'suggesties' },
	{ path: '/historie', name: 'historie' },
	{ path: '/beheer', name: 'beheer' },
	{ path: '/beheer/gegevens', name: 'gegevens' }
];

test.use({ contextOptions: { reducedMotion: 'reduce' } });

async function seed(page: Page) {
	await freshApp(page);
	await seedPurchases(page.request, 'Halfvolle melk', 6, 7, 7);
	await seedPurchases(page.request, 'Volkorenbrood', 8, 3, 1);
	await seedPurchases(page.request, 'Bananen', 5, 5, 4);
	await postOps(page.request, [{ type: 'list.create', listId: 'drogist', name: 'Drogist' }]);
	await page.reload();
	await addItems(
		page,
		'2 kg aardappelen',
		'Eieren x10',
		'Griekse yoghurt',
		'Ongezouten roomboter',
		'Kipfilet',
		'500 g gehakt',
		'Extra vierge olijfolie van de lokale markt met een erg lange naam',
		'Tomaten',
		'Wc-papier'
	);
	await page
		.locator('[data-testid=item-row][data-name="Tomaten"] [data-testid=item-toggle]')
		.click();
	await page
		.locator('[data-testid=item-row][data-name="Kipfilet"] [data-testid=item-toggle]')
		.click();
	await waitForSync(page);
	// Mark a favourite through the UI-independent API.
	const snap = await (await page.request.get('/api/snapshot')).json();
	const yog = snap.products.find((p: { name: string }) => p.name === 'Griekse yoghurt');
	await postOps(page.request, [
		{ type: 'product.update', productId: yog.id, changes: { favorite: true }, base: {} }
	]);
	const melk = snap.products.find((p: { name: string }) => p.name === 'Halfvolle melk');
	const res = await page.request.post('/api/import?kind=ai&mode=merge', {
		headers: { 'content-type': 'application/octet-stream' },
		data: JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			source: 'ChatGPT',
			recommendations: [
				{
					productId: melk.id,
					suggestedQuantity: 2,
					unit: 'l',
					nextPurchaseDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
					confidence: 0.82,
					reasoning:
						'Je koopt elke week halfvolle melk en de laatste aankoop was zeven dagen geleden; twee liter dekt de komende week.'
				}
			]
		})
	});
	expect((await res.json()).ok).toBe(true);
	await page.reload();
	await expect(page.locator('[data-testid=item-row]').first()).toBeVisible();
}

async function expectSortVisible(page: Page) {
	const vw = page.viewportSize()!.width;
	for (const id of ['sort-newest', 'sort-oldest', 'sort-az']) {
		const el = page.getByTestId(id);
		await expect(el).toBeVisible();
		const box = (await el.boundingBox())!;
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(vw);
		expect(box.height).toBeGreaterThanOrEqual(48);
	}
}

for (const scheme of ['light', 'dark'] as const) {
	for (const size of WIDTHS) {
		for (const orientation of ['portrait', 'landscape'] as const) {
			const viewport =
				orientation === 'portrait' ? size : { width: size.height, height: size.width };
			const label = `${size.width}-${orientation}-${scheme}`;

			test(`layout ${label}`, async ({ page }) => {
				await page.setViewportSize(viewport);
				await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
				await seed(page);

				for (const p of PAGES) {
					await page.goto(p.path);
					await expect(page.getByTestId('page-title')).toBeVisible();
					await page.waitForTimeout(150);
					if (p.path === '/') await expectSortVisible(page);
					const problems = await audit(page);
					expect(problems, `${p.name} @ ${label}`).toEqual([]);
					if (SHOT_WIDTHS.has(size.width) && (orientation === 'portrait' || p.path === '/')) {
						await page.screenshot({
							path: `${SHOT_DIR}/${p.name}-${label}.png`,
							fullPage: orientation === 'portrait'
						});
					}
				}
			});
		}
	}
}

for (const size of WIDTHS) {
	test(`interactions @ ${size.width}px: sheets, keyboard, autocomplete, font scaling, long list`, async ({
		page
	}) => {
		await page.setViewportSize(size);
		await seed(page);
		const shots = SHOT_WIDTHS.has(size.width);

		// Edit sheet.
		await page
			.locator('[data-testid=item-row][data-name="Griekse yoghurt"] [data-testid=item-edit]')
			.click();
		await expect(page.getByTestId('item-sheet')).toBeVisible();
		expect(await audit(page), 'item sheet').toEqual([]);
		if (shots) await page.screenshot({ path: `${SHOT_DIR}/sheet-edit-${size.width}.png` });
		await page.getByTestId('edit-delete').click();
		await expect(page.getByTestId('confirm-dialog')).toBeVisible();
		if (shots) await page.screenshot({ path: `${SHOT_DIR}/confirm-${size.width}.png` });
		await page.getByRole('button', { name: 'Annuleren' }).last().click();
		await expect(page.getByTestId('confirm-dialog')).toBeHidden();
		await expect(page.getByTestId('item-sheet')).toBeVisible();
		await page.goBack();
		await expect(page.getByTestId('item-sheet')).toBeHidden();

		// Product sheet with statistics.
		await page.goto('/historie');
		await page
			.locator('[data-testid=product-row][data-name="Halfvolle melk"] [data-testid=product-open]')
			.click();
		await expect(page.getByTestId('product-stats')).toBeVisible();
		expect(await audit(page), 'product sheet').toEqual([]);
		if (shots) await page.screenshot({ path: `${SHOT_DIR}/sheet-product-${size.width}.png` });
		await page.goBack();

		// Keyboard open: the viewport shrinks while the input is focused; the input, + button and
		// autocomplete stay usable and the bottom navigation steps aside.
		await page.goto('/');
		const input = page.getByTestId('add-input');
		await input.click();
		await input.fill('ba');
		await page.setViewportSize({ width: size.width, height: Math.round(size.height * 0.55) });
		await page.waitForTimeout(200);
		await expect(page.getByTestId('autocomplete')).toBeVisible();
		await expect(page.locator('nav[aria-label=Hoofdnavigatie]')).toBeHidden();
		const inputBox = (await input.boundingBox())!;
		const addBox = (await page.getByTestId('add-button').boundingBox())!;
		expect(inputBox.y + inputBox.height).toBeLessThanOrEqual(Math.round(size.height * 0.55));
		expect(addBox.x + addBox.width).toBeLessThanOrEqual(size.width);
		const ac = (await page.getByTestId('autocomplete').boundingBox())!;
		expect(ac.y + ac.height).toBeLessThanOrEqual(Math.round(size.height * 0.55) + 1);
		expect(await audit(page), 'keyboard open').toEqual([]);
		if (shots) await page.screenshot({ path: `${SHOT_DIR}/keyboard-${size.width}.png` });
		// Fast consecutive entry while the keyboard is up.
		await input.fill('Pasta');
		await input.press('Enter');
		await input.fill('Pesto');
		await input.press('Enter');
		await expect(input).toBeFocused();
		await expect(page.locator('[data-testid=item-row][data-name="Pesto"]')).toBeVisible();
		await input.blur();
		await page.setViewportSize(size);
		await expect(page.locator('nav[aria-label=Hoofdnavigatie]')).toBeVisible();

		// Increased font scaling (Android "font size" setting scales rem).
		for (const scale of ['130%', '160%']) {
			await page.evaluate((s) => (document.documentElement.style.fontSize = s), scale);
			await page.waitForTimeout(100);
			await expectSortVisible(page);
			expect(await audit(page), `font ${scale}`).toEqual([]);
			if (shots)
				await page.screenshot({
					path: `${SHOT_DIR}/font-${scale.replace('%', '')}-${size.width}.png`
				});
		}
		await page.evaluate(() => (document.documentElement.style.fontSize = ''));

		// Long list.
		const names = Array.from({ length: 45 }, (_, i) => `Product nummer ${i + 1}`);
		await addItems(page, ...names);
		await expectSortVisible(page);
		expect(await audit(page), 'long list').toEqual([]);
		if (shots)
			await page.screenshot({ path: `${SHOT_DIR}/long-list-${size.width}.png`, fullPage: true });
		// Bottom content stays reachable above the fixed navigation.
		await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
		const last = page.getByTestId('clear-completed');
		const navTop = (await page.locator('nav[aria-label=Hoofdnavigatie]').boundingBox())!.y;
		const lastBox = (await last.boundingBox())!;
		expect(lastBox.y + lastBox.height).toBeLessThanOrEqual(navTop);
	});
}

test('one-thumb reach: primary actions sit in comfortable zones on a 412px phone', async ({
	page
}) => {
	await page.setViewportSize({ width: 412, height: 915 });
	await seed(page);
	const nav = (await page.locator('nav[aria-label=Hoofdnavigatie]').boundingBox())!;
	expect(nav.y + nav.height).toBeGreaterThan(915 - 100);
	const firstRow = (await page.getByTestId('item-toggle').first().boundingBox())!;
	expect(firstRow.width).toBeGreaterThan(412 * 0.6);
	expect(firstRow.height).toBeGreaterThanOrEqual(56);
	await page.screenshot({ path: `${SHOT_DIR}/pixel-412-lijst.png` });
});
