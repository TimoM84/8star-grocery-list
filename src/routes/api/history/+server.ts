import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

export const GET: RequestHandler = ({ url }) => {
	const before = Number(url.searchParams.get('before')) || undefined;
	const limit = Number(url.searchParams.get('limit')) || 50;
	const query = url.searchParams.get('q')?.slice(0, 80) || undefined;
	return json(getRuntime().store.history({ query, before, limit }));
};
