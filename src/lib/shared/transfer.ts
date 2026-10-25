/** Import/export types shared by server and client. */

export type ImportKind = 'json' | 'products-csv' | 'purchases-csv' | 'ai';
export type ImportMode = 'merge' | 'replace';

export interface Counter {
	added: number;
	matched: number;
	updated: number;
	duplicates: number;
	skipped: number;
	removed: number;
}

export interface ImportReport {
	ok: boolean;
	preview: boolean;
	kind: ImportKind;
	mode: ImportMode;
	/** Human-readable Dutch summary lines. */
	summary: string[];
	counts: Record<string, Counter>;
	warnings: string[];
	errors: string[];
	/** Safety backup written before a replace. */
	backupFile?: string;
}

/** Header value required by the server before it replaces all data. */
export const REPLACE_CONFIRMATION = 'VERVANGEN';
/** Full backups include photos; keep below BODY_SIZE_LIMIT (100M in the image). */
export const MAX_IMPORT_BYTES = 95 * 1024 * 1024;
