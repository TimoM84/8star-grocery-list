import { expect, type Page, type APIRequestContext } from '@playwright/test';

export async function resetServer(request: APIRequestContext) {
	const res = await request.post('/api/test/reset');
	expect(res.ok()).toBeTruthy();
}

/** Opens the app with a clean server and clean local storage. */
export async function freshApp(page: Page, path = '/') {
	await resetServer(page.request);
	// Clear storage from a same-origin page that doesn't run the app.
	await page.goto('/api/health');
	await page.evaluate(async () => {
		localStorage.clear();
		await new Promise<void>((resolve) => {
			const r = indexedDB.deleteDatabase('8star-grocery');
			r.onsuccess = r.onerror = r.onblocked = () => resolve();
		});
	});
	await page.goto(path);
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
}

export async function addItems(page: Page, ...names: string[]) {
	const input = page.getByTestId('add-input');
	for (const name of names) {
		await input.fill(name);
		await input.press('Enter');
		await expect(input).toHaveValue('');
	}
}

export function row(page: Page, name: string) {
	return page.locator(`[data-testid=item-row][data-name="${name}"]`);
}

export async function activeNames(page: Page): Promise<string[]> {
	return page
		.locator('[data-testid=item-row][data-status=active]')
		.evaluateAll((els) => els.map((e) => e.getAttribute('data-name') ?? ''));
}

/** Waits until all local changes reached the server. */
export async function waitForSync(page: Page) {
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online', {
		timeout: 15_000
	});
	await expect
		.poll(async () =>
			page.evaluate(() => document.querySelector('[data-testid=sync-badge]')?.textContent?.trim())
		)
		.toBe('Live');
}

type Op = Record<string, unknown> & { type: string };
let opCounter = 0;

/** Posts raw operations to the server (used to seed history with past timestamps). */
export async function postOps(request: APIRequestContext, ops: Op[]) {
	const res = await request.post('/api/ops', {
		data: {
			clientId: 'e2e-seed',
			ops: ops.map((op) => ({ id: `seed-${Date.now()}-${++opCounter}`, at: Date.now(), ...op }))
		}
	});
	expect(res.ok()).toBeTruthy();
	return (await res.json()) as { results: { status: string; itemId?: string }[] };
}

const DAY = 24 * 60 * 60 * 1000;

/** Seeds `times` purchase cycles of a product, `everyDays` apart, ending `lastDaysAgo` ago. */
export async function seedPurchases(
	request: APIRequestContext,
	name: string,
	times: number,
	everyDays: number,
	lastDaysAgo: number,
	listId = 'default'
) {
	const now = Date.now();
	const first = now - (lastDaysAgo + everyDays * (times - 1)) * DAY;
	const itemId = `seed-item-${name.replace(/\W/g, '')}-${Math.random().toString(36).slice(2, 8)}`;
	const ops: Op[] = [
		{
			type: 'item.add',
			at: first - 3600_000,
			itemId,
			productId: itemId + '-p',
			listId,
			name,
			quantity: null,
			unit: null,
			categoryId: null
		}
	];
	for (let i = 0; i < times; i++) {
		const t = first + i * everyDays * DAY;
		if (i > 0) ops.push({ type: 'item.reactivate', at: t - 3600_000, itemId });
		ops.push({ type: 'item.complete', at: t, itemId });
	}
	return postOps(request, ops);
}
