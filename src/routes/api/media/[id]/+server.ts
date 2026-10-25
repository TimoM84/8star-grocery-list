import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { MAX_MEDIA_BYTES, MediaError } from '$lib/server/media';
import { householdMessages } from '$lib/server/i18n';

/** Photo bytes. Ids are never reused for other content, so responses are immutable. */
export const GET: RequestHandler = ({ params }) => {
	const { db, media } = getRuntime();
	const found = media.read(params.id);
	if (!found) error(404, householdMessages(db).media.notFound);
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
	if (length > MAX_MEDIA_BYTES)
		error(413, householdMessages(getRuntime().db).media.tooLarge(MAX_MEDIA_BYTES / 1024 / 1024));
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
