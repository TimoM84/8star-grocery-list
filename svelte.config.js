import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * Deterministic build id: changes whenever app code or static files change, so the service
 * worker cache is versioned per release, while server and client builds agree on it.
 */
function contentHash(dirs) {
	const hash = createHash('sha256');
	const walk = (dir) => {
		for (const name of readdirSync(dir).sort()) {
			const file = join(dir, name);
			if (statSync(file).isDirectory()) walk(file);
			else hash.update(file).update(readFileSync(file));
		}
	};
	for (const d of dirs) if (existsSync(d)) walk(d);
	return hash.digest('hex').slice(0, 10);
}

const buildId = process.env.BUILD_ID || contentHash(['src', 'static']);

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	kit: {
		adapter: adapter({ out: 'build', precompress: true }),
		paths: { relative: false },
		version: {
			name: `${pkg.version}-${buildId}`,
			pollInterval: 0
		},
		serviceWorker: {
			register: false
		},
		csp: {
			mode: 'hash',
			directives: {
				'default-src': ['self'],
				'script-src': ['self'],
				'style-src': ['self', 'unsafe-inline'],
				// blob: shows photos that are still waiting for upload (offline queue).
				'img-src': ['self', 'data:', 'blob:'],
				'connect-src': ['self'],
				'manifest-src': ['self'],
				'worker-src': ['self'],
				'font-src': ['self'],
				'object-src': ['none'],
				'base-uri': ['self'],
				'form-action': ['self'],
				'frame-ancestors': ['none']
			}
		}
	}
};

export default config;
