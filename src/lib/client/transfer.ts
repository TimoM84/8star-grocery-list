/** Client side of imports: uploads the raw file and returns the server's report. */

import {
	MAX_IMPORT_BYTES,
	REPLACE_CONFIRMATION,
	type ImportKind,
	type ImportMode,
	type ImportReport
} from '$lib/shared/transfer';
import { m } from './i18n';

export type ImportResult = { report: ImportReport } | { failure: string };

export async function uploadImport(
	kind: ImportKind,
	mode: ImportMode,
	file: Blob,
	preview: boolean
): Promise<ImportResult> {
	if (file.size > MAX_IMPORT_BYTES)
		return { failure: m.importPanel.fileTooLarge(MAX_IMPORT_BYTES / 1024 / 1024) };
	const params = new URLSearchParams({ kind, mode });
	if (preview) params.set('preview', '1');
	// Not a form content type, so SvelteKit's CSRF origin check never blocks it behind a proxy.
	const headers: Record<string, string> = { 'Content-Type': 'application/octet-stream' };
	if (mode === 'replace' && !preview) headers['X-Confirm-Replace'] = REPLACE_CONFIRMATION;
	try {
		const res = await fetch(`/api/import?${params}`, {
			method: 'POST',
			headers,
			// Sent as-is: JSON/CSV text or a full backup ZIP (binary).
			body: file
		});
		if (res.status === 200 || res.status === 422)
			return { report: (await res.json()) as ImportReport };
		if (res.status === 413) return { failure: m.importPanel.serverTooLarge };
		return { failure: m.importPanel.serverRefused(res.status) };
	} catch {
		return { failure: m.importPanel.offline };
	}
}
