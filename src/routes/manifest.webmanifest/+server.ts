import type { RequestHandler } from './$types';
import { currentTheme } from '$lib/server/theme';
import { getRuntime } from '$lib/server/runtime';
import { householdMessages } from '$lib/server/i18n';
import { readSettings } from '$lib/server/settings';

/**
 * PWA manifest, generated at runtime so `theme_color` follows APP_PRIMARY_COLOR and the
 * names follow the household language.
 */
export const GET: RequestHandler = () => {
	const { theme } = currentTheme();
	const { db } = getRuntime();
	const m = householdMessages(db);
	const manifest = {
		id: '/',
		name: m.manifest.name,
		short_name: m.manifest.shortName,
		description: m.manifest.description,
		lang: readSettings(db).language,
		dir: 'ltr',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		display_override: ['standalone'],
		orientation: 'any',
		background_color: '#f4f5f2',
		theme_color: theme.light.accent,
		categories: ['food', 'shopping', 'lifestyle'],
		icons: [
			{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
			{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
			{ src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
			{ src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' }
		],
		// Web Share Target (Android/Chromium, installed PWA only): shared text opens a preview.
		share_target: {
			action: '/delen',
			method: 'GET',
			params: { title: 'title', text: 'text', url: 'url' }
		},
		shortcuts: [
			{
				name: m.nav.suggestions,
				short_name: m.nav.suggestions,
				url: '/suggesties',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
			},
			{
				name: m.nav.history,
				short_name: m.nav.history,
				url: '/historie',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
			}
		]
	};
	return new Response(JSON.stringify(manifest, null, 2), {
		headers: {
			'Content-Type': 'application/manifest+json; charset=utf-8',
			'Cache-Control': 'no-cache'
		}
	});
};
