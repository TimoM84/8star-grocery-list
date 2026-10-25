import { test, expect, type Browser, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {
	addItems,
	audit,
	freshApp,
	postOps,
	resetServer,
	row,
	seedPurchases,
	waitForSync
} from './helpers';

/** End-to-end scenarios for the v1.2 features (see docs/TESTING.md, scenarios 1–8). */

const SHOT_DIR = 'screenshots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

async function device(browser: Browser, baseURL: string, width = 390): Promise<Page> {
	const ctx = await browser.newContext({
		baseURL,
		viewport: { width, height: 844 },
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

async function itemOf(page: Page, name: string) {
	const snap = await snapshot(page);
	const product = snap.products.find((p: { name: string }) => p.name === name);
	return {
		product,
		item: snap.items.find((i: { productId: string }) => i.productId === product?.id)
	};
}

async function goOffline(page: Page) {
	await page.context().setOffline(true);
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'offline', {
		timeout: 15_000
	});
}

async function goOnline(page: Page) {
	await page.context().setOffline(false);
	await waitForSync(page);
}

async function enter(page: Page, text: string) {
	const input = page.getByTestId('add-input');
	await input.fill(text);
	await input.press('Enter');
}

/** A tiny valid PNG (solid colour), built by hand so no image library is needed. */
function png(width: number, height: number): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		return c >>> 0;
	});
	const crc = (buf: Buffer) => {
		let c = 0xffffffff;
		for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type: string, data: Buffer) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2; // RGB
	const rows = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++)
		for (let x = 0; x < width; x++) {
			const o = y * (width * 3 + 1) + 1 + x * 3;
			rows[o] = 40;
			rows[o + 1] = 160 + ((x * 3) % 90);
			rows[o + 2] = 90;
		}
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(rows)),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// ---------------------------------------------------------------------------- scenario 1

test('1 · quantities: explicit choices, atomic increments, idempotent resend, safe undo', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page);
	await addItems(page, '2 melk');

	// Entering it again never changes it silently.
	await enter(page, '1 melk');
	await expect(page.getByTestId('add-prompt-existing')).toContainText('Staat er al op: 2');
	await expect(page.getByTestId('add-prompt-extra')).toHaveText(/1× extra/);
	await page.getByTestId('add-prompt-extra').click();
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('3×');

	await enter(page, '5 melk');
	await page.getByTestId('add-prompt-set').click();
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('5×');

	await enter(page, 'melk');
	await expect(page.getByTestId('add-prompt-extra')).toHaveText(/Eén extra/);
	await page.getByTestId('add-prompt-extra').click();
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('6×');

	// Unknown existing amount is never treated as 1; incompatible units are not added.
	await addItems(page, 'brood');
	await enter(page, 'brood');
	await expect(page.getByTestId('add-prompt-existing')).toContainText('zonder aantal');
	await expect(page.getByTestId('add-prompt-extra')).toHaveCount(0);
	await page.getByTestId('add-prompt-cancel').click();
	await enter(page, '1 l melk');
	await expect(page.getByTestId('add-prompt')).toContainText('andere eenheid');
	await expect(page.getByTestId('add-prompt-extra')).toHaveCount(0);
	await page.getByTestId('add-prompt-cancel').click();
	await waitForSync(page);

	// Two devices add one extra at the same time (one of them offline): both count.
	const b = await device(browser, baseURL!);
	await goOffline(page);
	await enter(page, 'melk');
	await page.getByTestId('add-prompt-extra').click();
	await enter(b, 'melk');
	await b.getByTestId('add-prompt-extra').click();
	await waitForSync(b);
	await goOnline(page);
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('8×');
	await expect(row(b, 'Melk').getByTestId('item-qty')).toHaveText('8×');

	// A resent op (same id) counts once.
	const { item } = await itemOf(page, 'Melk');
	const op = {
		id: 'resend-1',
		at: Date.now(),
		type: 'item.increment',
		itemId: item.id,
		delta: 1,
		unit: null
	};
	for (let i = 0; i < 2; i++) {
		const res = await page.request.post('/api/ops', {
			data: { clientId: 'x', protocol: 2, ops: [op] }
		});
		expect(res.ok()).toBeTruthy();
	}
	expect((await itemOf(page, 'Melk')).item.quantity).toBe(9);

	// Undo of my "+1" keeps someone else's later increment…
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('9×');
	await enter(page, 'melk');
	await page.getByTestId('add-prompt-extra').click();
	await waitForSync(page);
	await enter(b, 'melk');
	await b.getByTestId('add-prompt-extra').click();
	await waitForSync(b);
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('11×');
	await page.getByTestId('toast-action').click();
	await waitForSync(page);
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('10×');

	// …but is refused after someone explicitly changed the amount.
	await enter(page, 'melk');
	await page.getByTestId('add-prompt-extra').click();
	await waitForSync(page);
	await enter(b, '20 melk');
	await b.getByTestId('add-prompt-set').click();
	await waitForSync(b);
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('20×');
	await page.getByTestId('toast-action').click();
	await expect(page.getByTestId('toast')).toContainText('op een andere manier gewijzigd');
	await waitForSync(page);
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('20×');

	// Explicit quantity beats the product's usual quantity.
	const eggs = await postOps(page.request, [
		{
			type: 'item.add',
			itemId: 'egg-item',
			productId: 'egg',
			listId: 'default',
			name: 'Eieren',
			quantity: null,
			unit: null,
			categoryId: null
		},
		{ type: 'product.update', productId: 'egg', changes: { defaultQuantity: 6 }, base: {} },
		{ type: 'item.delete', itemId: 'egg-item' }
	]);
	expect(eggs.results.every((r) => r.status === 'applied')).toBe(true);
	await expect.poll(async () => (await itemOf(page, 'Eieren')).product?.defaultQuantity).toBe(6);
	await enter(page, 'eieren');
	await expect(row(page, 'Eieren').getByTestId('item-qty')).toHaveText('6×');
	await row(page, 'Eieren').getByTestId('item-toggle').click();
	await enter(page, '2 eieren');
	await expect(row(page, 'Eieren').getByTestId('item-qty')).toHaveText('2×');
	await b.context().close();
});

// ---------------------------------------------------------------------------- scenario 2

test('2 · partial purchase records what was bought without double counting', async ({ page }) => {
	await freshApp(page);
	await addItems(page, '3 pak yoghurt');
	await row(page, 'Yoghurt').getByTestId('item-edit').click();
	await page.getByTestId('action-partial').click();
	await page.getByTestId('partial-qty').fill('2');
	await expect(page.getByTestId('partial-form')).toContainText('1 pak blijft op de lijst');
	await page.getByTestId('partial-save').click();
	await expect(row(page, 'Yoghurt').getByTestId('item-qty')).toHaveText('1 pak');
	await expect(row(page, 'Yoghurt').getByTestId('item-bought')).toHaveText('2 pak gehaald');
	await waitForSync(page);
	let { product } = await itemOf(page, 'Yoghurt');
	expect(product.purchaseCount).toBe(0);

	// The rest is bought later: one purchase, total 3, frequency counted once.
	await row(page, 'Yoghurt').getByTestId('item-toggle').click();
	await waitForSync(page);
	({ product } = await itemOf(page, 'Yoghurt'));
	expect(product.purchaseCount).toBe(1);
	const history = await (await page.request.get(`/api/products/${product.id}/history`)).json();
	const bought = history.filter((c: { completedAt: number | null }) => c.completedAt);
	expect(bought).toHaveLength(1);
	expect(bought[0]).toMatchObject({ quantity: 3, unit: 'pak' });

	// "Niet verkrijgbaar": still needed, separate, restorable; nothing is bought.
	await addItems(page, 'Kokosmelk');
	await row(page, 'Kokosmelk').getByTestId('item-edit').click();
	await page.getByTestId('action-unavailable').click();
	await expect(page.getByTestId('unavailable-section')).toContainText('Kokosmelk');
	await expect(row(page, 'Kokosmelk')).toHaveAttribute('data-status', 'unavailable');
	await page.getByTestId('retry-unavailable').click();
	await expect(row(page, 'Kokosmelk')).toHaveAttribute('data-status', 'active');
	await waitForSync(page);
	expect((await itemOf(page, 'Kokosmelk')).product.purchaseCount).toBe(0);
});

// ---------------------------------------------------------------------------- scenario 3

test('3 · shared round, new items, note and snooze from another device; offline reload', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page);
	await seedPurchases(page.request, 'Bananen', 5, 5, 6);
	await page.reload();
	await addItems(page, 'Brood', 'Kaas');
	await page.goto('/beheer');
	await page.getByTestId('device-name').fill('Timo');
	await page.getByTestId('device-name-save').click();
	await page.goto('/');

	const b = await device(browser, baseURL!);
	await page.getByTestId('shopping-enter').click();
	await expect(page.getByTestId('shopping-remaining')).toHaveText('Nog 2 producten');
	await expect(b.getByTestId('round-banner')).toContainText('Timo doet boodschappen');

	// B adds something: A sees it behind a banner, rows don't jump.
	await addItems(b, 'Appels');
	await expect(page.getByTestId('new-items-banner')).toContainText('1 nieuw product');
	await expect(row(page, 'Appels')).toHaveCount(0);
	await page.getByTestId('new-items-banner').click();
	await expect(row(page, 'Appels').getByTestId('item-new')).toBeVisible();

	// B writes a note for this purchase and claims an item; A sees both.
	await row(b, 'Kaas').getByTestId('item-edit').click();
	await b.getByTestId('edit-note').fill('jong belegen, voor zaterdag');
	await b.getByTestId('edit-save').click();
	await expect(row(page, 'Kaas').getByTestId('item-note')).toContainText('voor zaterdag');
	await b.getByTestId('round-join').click();
	await row(b, 'Brood').getByTestId('item-edit').click();
	await b.getByTestId('action-claim').click();
	await expect(row(page, 'Brood').getByTestId('item-claim')).toContainText('pakt dit');

	// Shared "Niet nu" from B hides the suggestion on A.
	await b.goto('/suggesties');
	await b.locator('[data-testid=product-row][data-name=Bananen] [data-testid=snooze]').click();
	await expect(b.getByTestId('toast')).toContainText('niet voorstellen tot');
	await waitForSync(b);
	const snap = await snapshot(page);
	expect(snap.snoozes).toHaveLength(1);

	// Leaving ticks nothing; the round ends when the last participant leaves.
	await page.getByTestId('shopping-exit').click();
	await b.goto('/');
	await b.getByTestId('shopping-exit').click();
	await waitForSync(b);
	const after = await snapshot(page);
	expect(after.rounds).toHaveLength(0);
	expect(after.items.filter((i: { status: string }) => i.status === 'active').length).toBe(3);
	await b.context().close();
});

test.describe('3b · offline start', () => {
	test.use({ serviceWorkers: 'allow' });

	test('offline reload keeps winkelstand, notes, snoozes, ticks and the cached photo', async ({
		page,
		context
	}) => {
		await freshApp(page);
		await seedPurchases(page.request, 'Bananen', 5, 5, 6);
		await page.reload();
		await addItems(page, 'Brood', 'Kaas');
		await waitForSync(page);
		const { item: kaas, product: kaasP } = await itemOf(page, 'Kaas');
		// Another device (via the API): a note, a snooze and a photo.
		await page.request.put(`/api/media/photo-kaas`, {
			headers: { 'content-type': 'application/octet-stream' },
			data: png(32, 32)
		});
		const banaan = (await snapshot(page)).products.find(
			(p: { name: string }) => p.name === 'Bananen'
		);
		await postOps(page.request, [
			{
				type: 'item.update',
				itemId: kaas.id,
				changes: { note: 'jong belegen' },
				base: { note: null }
			},
			{ type: 'product.snooze', productId: banaan.id, until: Date.now() + 3 * 86_400_000 },
			{ type: 'product.setPhoto', productId: kaasP.id, mediaId: 'photo-kaas' }
		]);
		await expect(row(page, 'Kaas').getByTestId('item-note')).toContainText('jong belegen');
		await expect(row(page, 'Kaas').getByTestId('item-photo').locator('img')).toHaveJSProperty(
			'complete',
			true
		);
		await page.getByTestId('shopping-enter').click();
		await waitForSync(page);
		await expect
			.poll(() =>
				page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.active)
			)
			.toBe(true);
		await page.reload();
		await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
		// Load the photo once through the service worker so it is cached.
		await expect(row(page, 'Kaas').getByTestId('item-photo')).toBeVisible();
		await page.waitForTimeout(300);

		await context.setOffline(true);
		await row(page, 'Brood').getByTestId('item-toggle').click();
		await page.reload();
		await expect(page.getByTestId('shopping-bar')).toBeVisible();
		await expect(row(page, 'Kaas').getByTestId('item-note')).toContainText('jong belegen');
		await expect(row(page, 'Brood')).toHaveAttribute('data-status', 'completed');
		const loaded = await row(page, 'Kaas')
			.getByTestId('item-photo')
			.locator('img')
			.evaluate(async (img: HTMLImageElement) => {
				if (!img.complete)
					await new Promise((r) => img.addEventListener('load', r, { once: true }));
				return img.naturalWidth;
			});
		expect(loaded).toBeGreaterThan(0);
		await page.goto('/suggesties');
		await expect(page.getByTestId('suggestions-section')).toBeVisible();
		await expect(
			page
				.getByTestId('suggestions-section')
				.locator('[data-testid=product-row][data-name=Bananen]')
		).toHaveCount(0);
		await context.setOffline(false);
		await page.goto('/');
		await waitForSync(page);
		expect((await itemOf(page, 'Brood')).item.status).toBe('completed');
	});
});

// ---------------------------------------------------------------------------- scenario 4

test('4 · product memory: aliases, preferred list, walking route', async ({ page }) => {
	await freshApp(page);
	await postOps(page.request, [{ type: 'list.create', listId: 'drogist', name: 'Drogist' }]);
	await seedPurchases(page.request, 'Tandpasta', 4, 10, 12, 'drogist');
	await page.reload();
	await addItems(page, 'Melk');

	// Alias: typing another name finds the same product.
	await row(page, 'Melk').getByTestId('item-edit').click();
	await page.getByTestId('edit-more').click();
	await page.getByTestId('edit-open-product').click();
	await page.getByTestId('alias-input').fill('Halfvolle melk');
	await page.getByTestId('alias-add').click();
	await expect(page.getByTestId('alias-list')).toContainText('Halfvolle melk');
	await page.goBack();
	await enter(page, 'halfvolle melk');
	await expect(page.getByTestId('add-prompt-existing')).toContainText('Staat er al op');
	await page.getByTestId('add-prompt-cancel').click();
	await expect(page.locator('[data-testid=item-row]')).toHaveCount(1);

	// Suggestions are list-aware: Tandpasta belongs on Drogist.
	await expect(page.getByTestId('maybe-strip')).toHaveCount(0);
	await page.getByTestId('list-chip').filter({ hasText: 'Drogist' }).click();
	await expect(page.getByTestId('maybe-strip')).toContainText('Tandpasta');
	// Active elsewhere: adding asks "ook hier" or move.
	await page.getByTestId('maybe-chip').click();
	await page.getByTestId('list-chip').filter({ hasText: 'Boodschappen' }).click();
	await enter(page, 'tandpasta');
	await expect(page.getByTestId('add-prompt-elsewhere')).toContainText('Drogist');
	await page.getByTestId('add-prompt-move').click();
	await expect(row(page, 'Tandpasta')).toBeVisible();

	// Walking route per list.
	await addItems(page, 'Tomaten', 'Kaas');
	await page.goto('/beheer');
	const settings = page.locator('[data-testid=list-settings][data-name=Boodschappen]');
	await settings.getByTestId('route-toggle').click();
	const route = settings.getByTestId('route-list').locator('li');
	const first = (await route.first().textContent())?.trim();
	await settings.getByTestId('route-down').first().click();
	await expect(route.nth(1)).toContainText(first!);
	await page.goto('/');
	await page.getByTestId('group-toggle').click();
	await waitForSync(page);
	const snap = await snapshot(page);
	expect(
		snap.lists.find((l: { id: string }) => l.id === 'default').categoryOrder?.[1]
	).toBeTruthy();
});

// ---------------------------------------------------------------------------- scenario 5

test('5 · multiline paste and bundles work offline and survive a double submit', async ({
	page
}) => {
	await freshApp(page);
	await addItems(page, '2 melk');
	await goOffline(page);

	await page.getByTestId('bulk-open').click();
	await page
		.getByTestId('bulk-text')
		.fill('- 2 kg aardappelen\n• melk\n* kaas, jong belegen\nkaas, jong belegen\n\n3. brood');
	await page.getByTestId('bulk-preview').click();
	const lines = page.getByTestId('bulk-line');
	await expect(lines).toHaveCount(5);
	await expect(lines.nth(1).getByTestId('bulk-line-status')).toContainText('Staat er al op: 2×');
	// The duplicate in the input is left out by default.
	await expect(lines.nth(3).getByTestId('bulk-include')).toHaveAttribute('aria-checked', 'false');
	await lines.nth(1).getByTestId('bulk-choice-extra').click();
	if (await page.getByTestId('bulk-blocking').isVisible()) throw new Error('unexpected blocking');
	await expect(page.getByTestId('bulk-submit')).toHaveText('4 producten verwerken');
	await page.getByTestId('bulk-submit').dblclick();
	await expect(page.getByTestId('bulk-sheet')).toBeHidden();
	await expect(row(page, 'Aardappelen').getByTestId('item-qty')).toHaveText('2 kg');
	await expect(row(page, 'Melk').getByTestId('item-qty')).toHaveText('3×');

	// A bundle: created online, used offline; scaled to more people, rounded counts flagged.
	await goOnline(page);
	await page.goto('/suggesties');
	await page.getByTestId('bundle-new').click();
	await page.getByTestId('bundle-name').fill('Lasagne');
	await page.getByTestId('bundle-servings').fill('4');
	await page.getByTestId('bundle-line').first().fill('500 g gehakt');
	await page.getByTestId('bundle-add-line').click();
	await page.getByTestId('bundle-line').nth(1).fill('1 blik tomaten');
	await page.getByTestId('bundle-add-line').click();
	await page.getByTestId('bundle-line').nth(2).fill('kaas, jong belegen');
	await page.getByTestId('bundle-save').click();
	await waitForSync(page);
	await goOffline(page);
	await page.getByTestId('bundle-use').click();
	await page.getByTestId('bundle-servings-plus').click();
	await page.getByTestId('bundle-servings-plus').click();
	await expect(page.getByTestId('bundle-servings-value')).toHaveText('6');
	await expect(page.getByTestId('bundle-rounded')).toContainText('1,5');
	const bundleLines = page.getByTestId('bundle-add-line');
	await expect(bundleLines.nth(0)).toContainText('750 g');
	await expect(bundleLines.nth(1)).toContainText('2 blik');
	await expect(bundleLines.nth(2)).toContainText('Staat er al op');
	await page.getByTestId('bundle-add-submit').dblclick();
	await expect(page.getByTestId('bundle-add-sheet')).toBeHidden();

	await goOnline(page);
	const snap = await snapshot(page);
	const active = snap.items.filter((i: { status: string }) => i.status === 'active');
	const names = active
		.map(
			(i: { productId: string }) =>
				snap.products.find((p: { id: string }) => p.id === i.productId).name
		)
		.sort();
	expect(names).toEqual([
		'Aardappelen',
		'Brood',
		'Gehakt',
		'Kaas, jong belegen',
		'Melk',
		'Tomaten'
	]);
	expect(snap.bundles).toHaveLength(1);
	const gehakt = active.find(
		(i: { productId: string }) =>
			snap.products.find((p: { id: string }) => p.id === i.productId).name === 'Gehakt'
	);
	expect(gehakt).toMatchObject({ quantity: 750, unit: 'g' });
});

// ---------------------------------------------------------------------------- scenario 6

test('6 · checklists never count as purchases; reset with preview and undo', async ({ page }) => {
	await freshApp(page);
	await postOps(page.request, [{ type: 'list.create', listId: 'vak', name: 'Vakantie' }]);
	await page.reload();
	await page.goto('/beheer');
	await page
		.locator('[data-testid=list-settings][data-name=Vakantie]')
		.getByTestId('list-kind-checklist')
		.click();
	await expect(page.getByTestId('confirm-dialog')).toContainText('geschiedenis blijft bewaard');
	await page.getByTestId('confirm-ok').click();
	await page.goto('/');
	await page.getByTestId('list-chip').filter({ hasText: 'Vakantie' }).click();
	await expect(page.getByTestId('shopping-enter')).toHaveCount(0);
	await addItems(page, 'Paspoort', 'Zonnebrand', 'Opladers');
	await expect(page.getByRole('heading', { name: /Nog te doen/ })).toBeVisible();
	// Fixed manual order, changed with the arrow buttons.
	await page.getByTestId('reorder-toggle').click();
	await page.getByTestId('move-up').last().click();
	await page.getByTestId('reorder-toggle').click();
	await expect
		.poll(() =>
			page
				.locator('[data-testid=item-row]')
				.evaluateAll((els) => els.map((e) => e.getAttribute('data-name')))
		)
		.toEqual(['Paspoort', 'Opladers', 'Zonnebrand']);
	for (const n of ['Paspoort', 'Zonnebrand']) await row(page, n).getByTestId('item-toggle').click();
	await expect(page.getByRole('heading', { name: /Afgerond/ })).toBeVisible();
	await waitForSync(page);
	let snap = await snapshot(page);
	expect(snap.products.every((p: { purchaseCount: number }) => p.purchaseCount === 0)).toBe(true);

	await page.getByTestId('reset-checklist').click();
	await expect(page.getByTestId('confirm-dialog')).toContainText('Paspoort');
	await page.getByTestId('confirm-ok').click();
	await expect(page.locator('[data-testid=item-row][data-status=active]')).toHaveCount(3);
	await page.getByTestId('toast-action').click();
	await expect(page.locator('[data-testid=item-row][data-status=active]')).toHaveCount(1);
	await waitForSync(page);
	snap = await snapshot(page);
	expect(snap.products.every((p: { purchaseCount: number }) => p.purchaseCount === 0)).toBe(true);
	const history = await (await page.request.get('/api/history')).json();
	expect(Array.isArray(history) ? history.length : (history.entries?.length ?? 0)).toBe(0);
});

// ---------------------------------------------------------------------------- scenario 7

test('7 · photos: offline queue, display, full backup and restore', async ({ page }) => {
	await freshApp(page);
	await addItems(page, 'Pindakaas');
	await goOffline(page);
	await row(page, 'Pindakaas').getByTestId('item-edit').click();
	await page.getByTestId('edit-more').click();
	await page.getByTestId('photo-input').setInputFiles({
		name: 'pot.png',
		mimeType: 'image/png',
		buffer: png(64, 48)
	});
	await expect(page.getByTestId('photo-pending')).toBeVisible();
	await expect(page.getByTestId('photo-thumb')).toBeVisible();
	await page.getByTestId('edit-save').click();
	await expect(row(page, 'Pindakaas').getByTestId('item-photo')).toBeVisible();

	await goOnline(page);
	const { product } = await itemOf(page, 'Pindakaas');
	expect(product.photoId).toBeTruthy();
	const media = await page.request.get(`/api/media/${product.photoId}`);
	expect(media.status()).toBe(200);
	expect(media.headers()['content-type']).toBe('image/jpeg');

	await row(page, 'Pindakaas').getByTestId('item-photo').click();
	await expect(page.getByTestId('photo-large')).toBeVisible();
	await page.goBack();

	// Full backup (ZIP) contains the photo; restoring brings it back.
	const backup = await page.request.get('/api/export?format=backup');
	expect(backup.ok()).toBeTruthy();
	const zip = await backup.body();
	expect(zip.subarray(0, 2).toString()).toBe('PK');
	await resetServer(page.request);
	// Also remove the photo files, so the restore really has to bring them back.
	fs.rmSync(path.join(os.tmpdir(), `8star-e2e-${process.env.E2E_PORT ?? 4173}`, 'media'), {
		recursive: true,
		force: true
	});
	expect((await page.request.get(`/api/media/${product.photoId}`)).status()).toBe(404);
	const restored = await page.request.post('/api/import?kind=json&mode=replace', {
		headers: { 'content-type': 'application/octet-stream', 'x-confirm-replace': 'VERVANGEN' },
		data: zip
	});
	const report = await restored.json();
	expect(report.ok).toBe(true);
	await page.reload();
	await expect(row(page, 'Pindakaas').getByTestId('item-photo')).toBeVisible();
	const again = await itemOf(page, 'Pindakaas');
	expect(again.product.photoId).toBe(product.photoId);
	expect((await page.request.get(`/api/media/${product.photoId}`)).status()).toBe(200);
});

// ---------------------------------------------------------------------------- scenario 8

test('8 · share target opens a preview and never adds directly', async ({ page }) => {
	await freshApp(page);
	await page.goto(
		'/delen?title=Boodschappen&text=' +
			encodeURIComponent('- melk\n- 2 kg uien\nhttps://example.com/recept')
	);
	await expect(page.getByTestId('bulk-sheet')).toBeVisible();
	await expect(page.getByTestId('share-note')).toContainText('nog niets toegevoegd');
	await expect(page.getByTestId('bulk-line')).toHaveCount(3);
	await waitForSync(page);
	expect((await snapshot(page)).items).toHaveLength(0);
	await page.getByTestId('bulk-submit').click();
	await expect(row(page, 'Uien').getByTestId('item-qty')).toHaveText('2 kg');
	const manifest = await (await page.request.get('/manifest.webmanifest')).json();
	expect(manifest.share_target).toMatchObject({ action: '/delen', method: 'GET' });
});

for (const width of [320, 390, 430]) {
	for (const scheme of ['light', 'dark'] as const) {
		test(`8 · new screens @ ${width}px ${scheme}: winkelstand, choices, sheets, large text`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: width === 320 ? 640 : 860 });
			await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
			await freshApp(page);
			await postOps(page.request, [
				{ type: 'list.create', listId: 'drogist', name: 'Drogist' },
				{
					type: 'bundle.save',
					bundleId: 'b1',
					name: 'Pannenkoeken',
					servings: 4,
					lines: [
						{
							lineId: 'l1',
							productId: 'p-meel',
							name: 'Bloem',
							quantity: 500,
							unit: 'g',
							note: null
						},
						{ lineId: 'l2', productId: 'p-ei', name: 'Eieren', quantity: 3, unit: null, note: null }
					]
				}
			]);
			await page.reload();
			await addItems(
				page,
				'2 melk',
				'Brood',
				'3 pak yoghurt',
				'Extra vierge olijfolie van de lokale markt'
			);
			const shot = async (name: string) => {
				expect(await audit(page), name).toEqual([]);
				await page.screenshot({ path: `${SHOT_DIR}/v12-${name}-${width}-${scheme}.png` });
			};

			await row(page, 'Brood').getByTestId('item-edit').click();
			await page.getByTestId('edit-note').fill('volkoren, gesneden');
			await page.getByTestId('edit-substitute').click();
			await shot('edit');
			await page.getByTestId('edit-save').click();

			await enter(page, '1 melk');
			await expect(page.getByTestId('add-prompt')).toBeVisible();
			await shot('staat-er-al-op');
			await page.getByTestId('add-prompt-cancel').click();

			await page.getByTestId('shopping-enter').click();
			await expect(page.getByTestId('shopping-bar')).toBeVisible();
			await row(page, 'Brood').getByTestId('item-toggle').click();
			await page.getByTestId('toast').waitFor();
			await shot('winkelstand');
			for (const scale of ['130%', '160%']) {
				await page.evaluate((s) => (document.documentElement.style.fontSize = s), scale);
				await page.waitForTimeout(100);
				expect(await audit(page), `winkelstand font ${scale}`).toEqual([]);
			}
			await page.screenshot({ path: `${SHOT_DIR}/v12-winkelstand-160-${width}-${scheme}.png` });
			await page.evaluate(() => (document.documentElement.style.fontSize = ''));
			await row(page, 'Yoghurt').getByTestId('item-edit').click();
			await page.getByTestId('action-partial').click();
			await shot('acties');
			await page.goBack();
			await page.getByTestId('shopping-exit').click();

			await page.getByTestId('bulk-open').click();
			await page
				.getByTestId('bulk-text')
				.fill('- melk\n- kaas, jong belegen\n- kaas, jong belegen');
			await page.getByTestId('bulk-preview').click();
			await shot('meerdere');
			await page.goBack();

			await page.goto('/suggesties');
			await page.getByTestId('bundle-use').click();
			await shot('bundel');
			await page.goBack();
			await shot('suggesties');

			await page.goto('/beheer');
			await shot('beheer');
		});
	}
}
