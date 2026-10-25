import type { Handle, ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { currentTheme } from '$lib/server/theme';
import { householdMessages } from '$lib/server/i18n';
import { readSettings } from '$lib/server/settings';

export const init: ServerInit = () => {
	getRuntime();
	currentTheme();
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event, {
		// The accent color is injected into the HTML shell at runtime, so changing
		// APP_PRIMARY_COLOR only needs a container recreate, never a rebuild.
		// The language follows the household setting, like the in-app text.
		transformPageChunk: ({ html }) => {
			const { db } = getRuntime();
			const m = householdMessages(db);
			return html
				.replace('%8star.theme%', `<style id="app-theme">${currentTheme().css}</style>`)
				.replace('%8star.lang%', readSettings(db).language)
				.replace('%8star.title%', escapeHtml(m.manifest.name))
				.replace('%8star.description%', escapeHtml(m.manifest.htmlDescription));
		}
	});
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	// The camera is only used through the file picker (capture), never via getUserMedia.
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (event.url.pathname.startsWith('/api/media/') && response.ok) {
		// Photos are immutable per id (cached by the service worker, bounded).
	} else if (event.url.pathname.startsWith('/api/')) {
		response.headers.set('Cache-Control', 'no-store');
	} else if (response.headers.get('content-type')?.startsWith('text/html')) {
		// Always revalidate the shell so a new theme or release shows up immediately online.
		response.headers.set('Cache-Control', 'no-cache');
	}
	return response;
};

function escapeHtml(text: string): string {
	return text
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}
