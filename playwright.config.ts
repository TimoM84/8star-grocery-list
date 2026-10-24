import { defineConfig, devices } from '@playwright/test';
import os from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.E2E_PORT ?? 4173);
const DATA_DIR = path.join(os.tmpdir(), `8star-e2e-${PORT}`);

export default defineConfig({
	testDir: 'e2e',
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	timeout: 45_000,
	expect: { timeout: 7_000 },
	reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
	use: {
		baseURL: `http://localhost:${PORT}`,
		locale: 'nl-NL',
		timezoneId: 'Europe/Amsterdam',
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		serviceWorkers: 'block',
		contextOptions: { reducedMotion: 'reduce' }
	},
	projects: [
		{
			name: 'mobile-chromium',
			use: {
				...devices['Pixel 7'],
				// Galaxy A57 / Pixel 10 class: ~412 CSS px wide, high DPR, touch.
				viewport: { width: 412, height: 915 }
			}
		}
	],
	webServer: {
		command: `rm -rf "${DATA_DIR}" && node build/index.js`,
		url: `http://localhost:${PORT}/api/health`,
		reuseExistingServer: false,
		timeout: 60_000,
		env: {
			PORT: String(PORT),
			DATA_DIR,
			E2E_TEST_MODE: '1',
			BACKUP_INTERVAL_HOURS: '0'
		}
	}
});
