import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { parseOpsRequest, ValidationError } from '$lib/shared/ops';

export const POST: RequestHandler = async ({ request }) => {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid JSON');
	}
	try {
		// Every protocol version's ops are accepted; unknown op types are rejected per op
		// (visible to the user), never dropped silently. See docs/SYNC.md.
		const { clientId, ops } = parseOpsRequest(body);
		return json(getRuntime().store.applyOps(clientId, ops));
	} catch (e) {
		if (e instanceof ValidationError) error(400, e.message);
		const code = (e as { code?: string }).code;
		if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') error(503, 'Database busy, retry');
		throw e;
	}
};
