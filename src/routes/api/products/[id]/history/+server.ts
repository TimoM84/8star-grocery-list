import type { RequestHandler } from './$types';
import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

export const GET: RequestHandler = ({ params }) =>
	json(getRuntime().store.productCycles(params.id));
