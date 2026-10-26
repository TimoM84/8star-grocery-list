import { test, expect, type Browser, type Page } from '@playwright/test';
import { freshApp, seedPurchases, waitForSync } from './helpers';

async function device(browser: Browser, baseURL: string, path: string): Promise<Page> {
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
	await page.goto(path);
	await expect(page.getByTestId('sync-badge')).toHaveAttribute('data-state', 'online');
	return page;
}

async function importRecommendation(page: Page) {
	const snap = await (await page.request.get('/api/snapshot')).json();
	const melk = snap.products.find((p: { name: string }) => p.name === 'Halfvolle melk').id;
	const res = await page.request.post('/api/import?kind=ai', {
		headers: { 'content-type': 'application/json' },
		data: JSON.stringify({
			format: '8star-ai-recommendations',
			formatVersion: 1,
			recommendations: [{ productId: melk, confidence: 0.8, reasoning: 'Elke week.' }]
		})
	});
	expect(res.ok()).toBeTruthy();
}

test('suggestions (including AI) can be hidden and shown again from Beheer, on every device, without losing data', async ({
	page,
	browser,
	baseURL
}) => {
	await freshApp(page, '/beheer');
	await seedPurchases(page.request, 'Halfvolle melk', 3, 7, 1);
	await importRecommendation(page);
	const other = await device(browser, baseURL!, '/suggesties');
	await expect(other.getByTestId('ai-card')).toHaveCount(1);

	// Default: on.
	const toggle = page.getByTestId('setting-suggestions');
	await expect(toggle).toHaveAttribute('aria-checked', 'true');
	await expect(page.getByTestId('open-gegevens')).toContainText('AI-analyse');

	await toggle.click();
	await expect(toggle).toHaveAttribute('aria-checked', 'false');
	await expect(page.getByTestId('open-gegevens')).not.toContainText('AI');
	await waitForSync(page);

	// Hidden everywhere: Suggesties (also live on the other device), badge count and Gegevens.
	await expect(other.getByTestId('ai-section')).toHaveCount(0);
	await expect(other.getByTestId('suggestions-section')).toHaveCount(0);
	await expect(other.getByTestId('bundles-section')).toBeVisible();
	await page.goto('/suggesties');
	await expect(page.getByTestId('ai-section')).toHaveCount(0);
	await expect(page.getByText('AI-bestand importeren')).toHaveCount(0);
	await page.goto('/beheer/gegevens');
	await expect(page.getByTestId('export-ai-prompt')).toHaveCount(0);
	await expect(page.getByText('Analyseren met AI')).toHaveCount(0);
	await expect(page.getByTestId('export-json')).toBeVisible();

	// Persisted on the server and survives a reload.
	const snap = await (await page.request.get('/api/snapshot')).json();
	expect(snap.settings).toEqual({
		suggestionsEnabled: false,
		bulkAddEnabled: true,
		language: 'nl'
	});
	expect(snap.aiRecommendations).toHaveLength(1);
	await page.reload();
	await expect(page.getByTestId('export-ai-prompt')).toHaveCount(0);

	// Part of the JSON export.
	const exported = await (await page.request.get('/api/export?format=json')).json();
	expect(exported.data.settings).toEqual({
		suggestionsEnabled: false,
		bulkAddEnabled: true,
		language: 'nl'
	});

	// Switching back on brings the kept suggestion back.
	await page.goto('/beheer');
	await page.getByTestId('setting-suggestions').click();
	await expect(page.getByTestId('setting-suggestions')).toHaveAttribute('aria-checked', 'true');
	await expect(other.getByTestId('ai-card')).toHaveCount(1);
	await other.context().close();
});
