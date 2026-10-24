/** Minimal RFC 4180 CSV reader/writer (`;` by default, for Dutch spreadsheet software). */

export function toCsv(header: string[], rows: unknown[][], separator = ';'): string {
	const cell = (v: unknown) => {
		if (v === null || v === undefined) return '';
		const s = String(v);
		return /["\n\r;,\t]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
	};
	// UTF-8 BOM so Excel detects the encoding.
	return '\ufeff' + [header, ...rows].map((r) => r.map(cell).join(separator)).join('\r\n') + '\r\n';
}

/** Picks the separator that splits the header line into the most fields. */
export function detectSeparator(text: string): string {
	const firstLine = text.replace(/^\ufeff/, '').split(/\r?\n/, 1)[0] ?? '';
	let best = ';';
	let bestCount = 0;
	for (const sep of [';', ',', '\t']) {
		const count = firstLine.split(sep).length;
		if (count > bestCount) {
			best = sep;
			bestCount = count;
		}
	}
	return best;
}

export class CsvError extends Error {}

/** Parses CSV into rows of strings. Handles quotes, escaped quotes and newlines in quotes. */
export function parseCsv(text: string, separator = detectSeparator(text)): string[][] {
	const src = text.replace(/^\ufeff/, '');
	const rows: string[][] = [];
	let row: string[] = [];
	let field = '';
	let inQuotes = false;
	let i = 0;
	while (i < src.length) {
		const ch = src[i];
		if (inQuotes) {
			if (ch === '"') {
				if (src[i + 1] === '"') {
					field += '"';
					i += 2;
					continue;
				}
				inQuotes = false;
				i++;
				continue;
			}
			field += ch;
			i++;
			continue;
		}
		if (ch === '"' && field === '') {
			inQuotes = true;
			i++;
		} else if (ch === separator) {
			row.push(field);
			field = '';
			i++;
		} else if (ch === '\r' || ch === '\n') {
			row.push(field);
			rows.push(row);
			row = [];
			field = '';
			i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
		} else {
			field += ch;
			i++;
		}
	}
	if (inQuotes) throw new CsvError('Onafgesloten aanhalingsteken in CSV-bestand.');
	if (field !== '' || row.length) {
		row.push(field);
		rows.push(row);
	}
	return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export interface CsvTable {
	header: string[];
	/** Rows as objects keyed by normalised header name, with their 1-based line numbers. */
	records: { line: number; values: Record<string, string> }[];
}

const normaliseHeader = (h: string) =>
	h
		.trim()
		.toLowerCase()
		.replace(/[\s-]+/g, '_');

export function readCsvTable(text: string): CsvTable {
	const rows = parseCsv(text);
	if (!rows.length) throw new CsvError('Het CSV-bestand is leeg.');
	const header = rows[0].map(normaliseHeader);
	const records = rows.slice(1).map((r, idx) => {
		const values: Record<string, string> = {};
		header.forEach((h, i) => (values[h] = (r[i] ?? '').trim()));
		return { line: idx + 2, values };
	});
	return { header, records };
}

/** First non-empty value among the given column aliases. */
export function pick(values: Record<string, string>, ...names: string[]): string {
	for (const n of names) {
		const v = values[n];
		if (v !== undefined && v !== '') return v;
	}
	return '';
}

export function hasColumn(table: CsvTable, ...names: string[]): boolean {
	return names.some((n) => table.header.includes(n));
}
