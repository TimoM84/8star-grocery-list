import type { Handle, ServerInit } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

export const init: ServerInit = () => {
	getRuntime();
};

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'no-referrer');
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	if (event.url.pathname.startsWith('/api/')) {
		response.headers.set('Cache-Control', 'no-store');
	}
	return response;
};
