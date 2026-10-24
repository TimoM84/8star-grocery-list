import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { exportJson, exportProductsCsv, exportPurchasesCsv } from '$lib/server/export';

export const GET: RequestHandler = ({ url }) => {
	const { store } = getRuntime();
	const format = url.searchParams.get('format') ?? 'json';
	const type = url.searchParams.get('type') ?? 'purchases';
	const date = new Date().toISOString().slice(0, 10);

	if (format === 'json') {
		return new Response(JSON.stringify(exportJson(store, __APP_VERSION__), null, 2), {
			headers: {
				'Content-Type': 'application/json; charset=utf-8',
				'Content-Disposition': `attachment; filename="8star-boodschappen-${date}.json"`
			}
		});
	}
	if (format === 'csv') {
		const body = type === 'products' ? exportProductsCsv(store) : exportPurchasesCsv(store);
		const name = type === 'products' ? 'producten' : 'aankopen';
		return new Response(body, {
			headers: {
				'Content-Type': 'text/csv; charset=utf-8',
				'Content-Disposition': `attachment; filename="8star-${name}-${date}.csv"`
			}
		});
	}
	error(400, 'Unknown format');
};
