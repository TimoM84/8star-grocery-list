import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';

export const GET = () => json(getRuntime().store.snapshot());
