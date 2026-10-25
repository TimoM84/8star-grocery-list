import { expect, type Page, type APIRequestContext } from '@playwright/test';

/**
 * Wipes the server. Most specs check the Dutch wording, so the household language is set to
 * Dutch unless another one is asked for (a fresh install itself defaults to English).
 */
export async function resetServer(request: APIRequestContext, language = 'nl') {
	const res = await request.post('/api/test/reset');
	expect(res.ok()).toBeTruthy();
	if (language !== 'en') await postOps(request, [{ type: 'settings.update', language }]);
}

/** Opens the app with a clean server and clean local storage. */
export async function freshApp(page: Page, path = '/', language = 'nl') {
	await resetServer(page.request, language);
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

export interface Problem {
	kind: string;
	detail: string;
}

/** Collects layout problems from the live DOM. */
export async function audit(page: Page): Promise<Problem[]> {
	return page.evaluate(() => {
		const problems: { kind: string; detail: string }[] = [];
		const vw = document.documentElement.clientWidth;
		const describe = (el: Element) =>
			`${el.tagName.toLowerCase()}${el.getAttribute('data-testid') ? `[${el.getAttribute('data-testid')}]` : ''} "${(el.textContent ?? el.getAttribute('aria-label') ?? '').trim().slice(0, 40)}"`;
		const visible = (el: Element) => {
			const r = el.getBoundingClientRect();
			const s = getComputedStyle(el);
			return (
				r.width > 0 &&
				r.height > 0 &&
				s.visibility !== 'hidden' &&
				s.display !== 'none' &&
				!el.closest('[inert]')
			);
		};

		if (document.documentElement.scrollWidth > vw + 1)
			problems.push({
				kind: 'horizontal-scroll',
				detail: `${document.documentElement.scrollWidth} > ${vw}`
			});

		for (const el of document.querySelectorAll('body *')) {
			if (
				!visible(el) ||
				el.closest('svg') ||
				el.classList.contains('sr-only') ||
				el.id === 'svelte-announcer'
			)
				continue;
			const r = el.getBoundingClientRect();
			if (r.right > vw + 1 || r.left < -1)
				problems.push({ kind: 'offscreen-x', detail: describe(el) });
			const s = getComputedStyle(el);
			if (
				(s.overflowX === 'hidden' || s.overflowX === 'clip') &&
				el.scrollWidth > el.clientWidth + 1 &&
				el.textContent?.trim()
			)
				problems.push({ kind: 'clipped', detail: describe(el) });
		}

		const targets = [
			...document.querySelectorAll('button, a[href], input, [role=radio], [role=tab]')
		].filter(
			(el) =>
				visible(el) &&
				!(el as HTMLElement).hasAttribute('tabindex') &&
				!el.classList.contains('sr-only') &&
				!el.closest('[aria-hidden=true]')
		);
		for (const el of targets) {
			const r = el.getBoundingClientRect();
			if (el.tagName !== 'INPUT' && el.scrollWidth > el.clientWidth + 1)
				problems.push({ kind: 'content-overflow', detail: describe(el) });
			if (r.height < 47.5 || r.width < 47.5)
				problems.push({
					kind: 'small-target',
					detail: `${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`
				});
		}
		// Interactive elements must not overlap each other (fixed bars are allowed over content).
		const inFlow = targets.filter(
			(el) =>
				!el.closest('nav, header, [aria-live], [role=dialog], [role=alertdialog], [role=listbox]')
		);
		for (let i = 0; i < inFlow.length; i++) {
			for (let j = i + 1; j < inFlow.length; j++) {
				const a = inFlow[i].getBoundingClientRect();
				const b = inFlow[j].getBoundingClientRect();
				if (inFlow[i].contains(inFlow[j]) || inFlow[j].contains(inFlow[i])) continue;
				const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
				const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
				if (ox > 1 && oy > 1)
					problems.push({
						kind: 'overlap',
						detail: `${describe(inFlow[i])} × ${describe(inFlow[j])}`
					});
			}
		}
		if (document.querySelector('select, [role=menu], details > summary'))
			problems.push({ kind: 'dropdown', detail: 'select/menu element present' });
		return problems;
	});
}
