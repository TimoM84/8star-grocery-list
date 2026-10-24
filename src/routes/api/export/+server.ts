import type { RequestHandler } from './$types';
import { error } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { CSV_DATASETS, csvFor, exportJson, exportZip, type CsvDataset } from '$lib/server/export';
import { exportData } from '$lib/server/transfer/format';
import { AI_PROMPT } from '$lib/server/transfer/ai-prompt';

export const GET: RequestHandler = ({ url }) => {
	const { db } = getRuntime();
	const format = url.searchParams.get('format') ?? 'json';
	const date = new Date().toISOString().slice(0, 10);
	const download = (body: BodyInit, type: string, name: string) =>
		new Response(body, {
			headers: {
				'Content-Type': type,
				'Content-Disposition': `attachment; filename="${name}"`,
				'Cache-Control': 'no-store'
			}
		});

	if (format === 'json') {
		return download(
			JSON.stringify(exportJson(db, __APP_VERSION__), null, 2),
			'application/json; charset=utf-8',
			`8star-export-${date}.json`
		);
	}
	if (format === 'zip') {
		return download(new Uint8Array(exportZip(db)), 'application/zip', `8star-csv-${date}.zip`);
	}
	if (format === 'csv') {
		const type = (url.searchParams.get('type') ?? 'purchases') as CsvDataset;
		if (!CSV_DATASETS.includes(type)) error(400, 'Unknown CSV dataset');
		return download(
			csvFor(type, exportData(db)),
			'text/csv; charset=utf-8',
			`8star-${type}-${date}.csv`
		);
	}
	if (format === 'ai-prompt') {
		return download(AI_PROMPT, 'text/markdown; charset=utf-8', '8star-ai-opdracht.md');
	}
	error(400, 'Unknown format');
};
