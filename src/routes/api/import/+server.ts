import type { RequestHandler } from './$types';
import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { runImport } from '$lib/server/transfer/importer';
import { REPLACE_CONFIRMATION, type ImportKind, type ImportMode } from '$lib/shared/transfer';

const KINDS: ImportKind[] = ['json', 'products-csv', 'purchases-csv', 'ai'];

/**
 * POST /api/import?kind=json|products-csv|purchases-csv|ai&mode=merge|replace[&preview=1]
 * Body: the raw file content (JSON, or a full backup ZIP for kind=json). A replace needs header
 * `X-Confirm-Replace: VERVANGEN`.
 */
export const POST: RequestHandler = async ({ url, request }) => {
	const kind = url.searchParams.get('kind') as ImportKind;
	const mode = (url.searchParams.get('mode') ?? 'merge') as ImportMode;
	const preview = url.searchParams.get('preview') === '1';
	if (!KINDS.includes(kind)) error(400, 'Unknown import kind');
	if (mode !== 'merge' && mode !== 'replace') error(400, 'Unknown import mode');
	if (mode === 'replace' && kind !== 'json') error(400, 'Only JSON imports can replace all data');
	if (
		mode === 'replace' &&
		!preview &&
		request.headers.get('x-confirm-replace') !== REPLACE_CONFIRMATION
	)
		error(428, 'Replacing all data requires explicit confirmation');

	const bytes = Buffer.from(await request.arrayBuffer());
	const text = bytes.toString('utf8');
	if (!text.trim()) error(400, 'Empty file');
	const { store, config, media } = getRuntime();
	const report = runImport(store, {
		kind,
		mode,
		text,
		bytes,
		preview,
		backupDir: config.backupDir,
		media
	});
	return json(report, { status: report.ok ? 200 : 422 });
};
