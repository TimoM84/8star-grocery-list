/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />
/// <reference types="@sveltejs/kit" />

/**
 * Offline app shell. Static assets are cached per app version (cache-first); navigations are
 * network-first with a short timeout and fall back to the cached shell, so the app also starts
 * without the VPN. API traffic (`/api/*`) is never cached: the sync engine keeps its own
 * IndexedDB copy of the data.
 */

import { build, files, version } from '$service-worker';

const sw = self as unknown as ServiceWorkerGlobalScope;
const CACHE = `8star-${version}`;
const SHELL = '/';
const ASSETS = [...build, ...files].filter((f) => !f.endsWith('.DS_Store') && f !== '/manifest.webmanifest');
const ASSET_SET = new Set(ASSETS);
const NAV_TIMEOUT_MS = 3500;

sw.addEventListener('install', (event) => {
	event.waitUntil(
		(async () => {
			const cache = await caches.open(CACHE);
			await cache.addAll(ASSETS);
			const shell = await fetch(SHELL, { cache: 'no-store' });
			if (shell.ok) await cache.put(SHELL, shell);
		})()
	);
});

sw.addEventListener('activate', (event) => {
	event.waitUntil(
		(async () => {
			for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
			await sw.clients.claim();
		})()
	);
});

sw.addEventListener('message', (event) => {
	if (event.data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});

async function networkFirstShell(request: Request): Promise<Response> {
	const cache = await caches.open(CACHE);
	try {
		const response = await Promise.race([
			fetch(request),
			new Promise<never>((_, reject) =>
				setTimeout(() => reject(new Error('timeout')), NAV_TIMEOUT_MS)
			)
		]);
		if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
			void cache.put(SHELL, response.clone());
		}
		return response;
	} catch {
		const cached = (await cache.match(SHELL)) ?? (await cache.match(request));
		if (cached) return cached;
		return new Response('<h1>Offline</h1><p>De app is nog niet beschikbaar op dit apparaat.</p>', {
			status: 503,
			headers: { 'Content-Type': 'text/html; charset=utf-8' }
		});
	}
}

sw.addEventListener('fetch', (event) => {
	const request = event.request;
	if (request.method !== 'GET') return;
	const url = new URL(request.url);
	if (url.origin !== sw.location.origin) return;
	if (url.pathname.startsWith('/api/') || url.pathname === '/manifest.webmanifest') return;

	if (request.mode === 'navigate') {
		event.respondWith(networkFirstShell(request));
		return;
	}

	if (ASSET_SET.has(url.pathname)) {
		event.respondWith(
			(async () => {
				const cache = await caches.open(CACHE);
				const cached = await cache.match(url.pathname);
				if (cached) return cached;
				const response = await fetch(request);
				if (response.ok) void cache.put(url.pathname, response.clone());
				return response;
			})()
		);
	}
});
