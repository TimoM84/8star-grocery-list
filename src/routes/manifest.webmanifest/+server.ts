import type { RequestHandler } from './$types';
import { currentTheme } from '$lib/server/theme';

/** PWA manifest, generated at runtime so `theme_color` follows APP_PRIMARY_COLOR. */
export const GET: RequestHandler = () => {
	const { theme } = currentTheme();
	const manifest = {
		id: '/',
		name: '8star Boodschappen',
		short_name: 'Boodschappen',
		description: 'Gedeelde boodschappenlijst voor het hele huishouden — ook offline.',
		lang: 'nl',
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
				name: 'Suggesties',
				short_name: 'Suggesties',
				url: '/suggesties',
				icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }]
			},
			{
				name: 'Historie',
				short_name: 'Historie',
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
