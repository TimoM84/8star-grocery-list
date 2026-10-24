import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { currentTheme } from '$lib/server/theme';
import { ICONS, iconPng, iconSvg } from '$lib/server/icons';

/** App icons in the configured accent color. Short cache: a new color shows up within an hour. */
export const GET: RequestHandler = ({ params, request }) => {
	const accent = currentTheme().theme.light.accent;
	const etag = `"${accent.slice(1)}-${params.file}"`;
	const headers = { 'Cache-Control': 'public, max-age=3600', ETag: etag };
	if (request.headers.get('if-none-match') === etag)
		return new Response(null, { status: 304, headers });
	if (params.file === 'favicon.svg') {
		return new Response(iconSvg(accent), {
			headers: { ...headers, 'Content-Type': 'image/svg+xml' }
		});
	}
	const spec = ICONS[params.file];
	if (!spec) error(404, 'Not found');
	return new Response(new Uint8Array(iconPng(spec.size, accent, spec.opts)), {
		headers: { ...headers, 'Content-Type': 'image/png' }
	});
};
