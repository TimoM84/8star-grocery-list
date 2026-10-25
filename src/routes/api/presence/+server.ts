import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Heartbeat from a device in winkelstand (keeps "… doet boodschappen" fresh). */
export const POST: RequestHandler = async ({ request }) => {
	let body: { roundId?: unknown; deviceId?: unknown };
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	if (
		typeof body.roundId !== 'string' ||
		!ID_RE.test(body.roundId) ||
		typeof body.deviceId !== 'string' ||
		!ID_RE.test(body.deviceId)
	)
		error(400, 'Invalid presence');
	return json({ active: getRuntime().store.heartbeat(body.roundId, body.deviceId) });
};
