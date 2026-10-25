import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { MAX_MEDIA_BYTES, MediaError } from '$lib/server/media';

/** Photo bytes. Ids are never reused for other content, so responses are immutable. */
export const GET: RequestHandler = ({ params }) => {
	const found = getRuntime().media.read(params.id);
	if (!found) error(404, 'Foto niet gevonden');
	return new Response(new Uint8Array(found.data), {
		headers: {
			'Content-Type': found.row.mime,
			'Content-Length': String(found.data.length),
			'Cache-Control': 'private, max-age=31536000, immutable',
			'Content-Security-Policy': "default-src 'none'; sandbox",
			'Content-Disposition': 'inline'
		}
	});
};

/**
 * Upload (PUT /api/media/:id, raw image body). The app queues photos offline and uploads them
 * before the op that attaches them, so retries with the same id must succeed.
 */
export const PUT: RequestHandler = async ({ params, request }) => {
	const length = Number(request.headers.get('content-length') ?? 0);
	if (length > MAX_MEDIA_BYTES) error(413, 'Foto is te groot');
	const body = Buffer.from(await request.arrayBuffer());
	try {
		const row = getRuntime().media.put(params.id, body);
		return json({
			id: row.id,
			mime: row.mime,
			width: row.width,
			height: row.height,
			bytes: row.bytes
		});
	} catch (e) {
		if (e instanceof MediaError) return json({ message: e.message }, { status: e.status });
		throw e;
	}
};
