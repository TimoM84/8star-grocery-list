import type { Handle, ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { currentTheme } from '$lib/server/theme';

export const init: ServerInit = () => {
	getRuntime();
	currentTheme();
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		// The accent color is injected into the HTML shell at runtime, so changing
		// APP_PRIMARY_COLOR only needs a container recreate, never a rebuild.
		transformPageChunk: ({ html }) =>
			html.replace('%8star.theme%', `<style id="app-theme">${currentTheme().css}</style>`)
	});
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (event.url.pathname.startsWith('/api/')) {
		response.headers.set('Cache-Control', 'no-store');
	} else if (response.headers.get('content-type')?.startsWith('text/html')) {
		// Always revalidate the shell so a new theme or release shows up immediately online.
		response.headers.set('Cache-Control', 'no-cache');
	}
	return response;
};
