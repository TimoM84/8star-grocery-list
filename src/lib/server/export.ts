/** Export endpoints' content builders: versioned JSON, CSV datasets and a ZIP of all CSVs. */

import type { DB } from './db';
import { buildExport, exportData, statisticsRows, type ExportData } from './transfer/format';
import { toCsv } from './transfer/csv';
import { createZip, type ZipEntry } from './transfer/zip';
import { BACKUP_FORMAT, BACKUP_FORMAT_VERSION } from './transfer/importer';
import type { MediaStore } from './media';

export { toCsv };

const STATUS_NL = { purchased: 'gekocht', cancelled: 'geannuleerd', open: 'open' } as const;
/** Decimal comma, matching the `;` separator used for Dutch spreadsheet software. */
const dec = (n: number | null | undefined) =>
	n === null || n === undefined ? '' : String(n).replace('.', ',');

export function exportJson(db: DB, version: string, now = Date.now()) {
	return buildExport(db, version, now);
}

/**
 * Full backup: `manifest.json` (what is inside), `export.json` (export format 2, all data) and
 * `media/<id>.<ext>` (every photo in use). Restorable via Beheer → Gegevens (replace or merge).
 */
export function exportBackupZip(db: DB, media: MediaStore, version: string, now = Date.now()) {
	const file = buildExport(db, version, now);
	const photos = media.referenced();
	const present = new Set(photos.map((p) => p.row.id));
	const missing = file.data.media.filter((m) => !present.has(m.id)).map((m) => m.id);
	const manifest = {
		format: BACKUP_FORMAT,
		formatVersion: BACKUP_FORMAT_VERSION,
		app: file.app,
		databaseSchemaVersion: file.databaseSchemaVersion,
		exportedAt: file.exportedAt,
		contents: {
			'export.json': `${file.format} v${file.formatVersion}: lijsten, categorieën, producten, zoekwoorden, items, aankopen, bundels, AI-suggesties`,
			media: `${photos.length} foto('s)`
		},
		notIncluded: ['winkelrondes', 'claims', 'apparaatnamen', '"Niet nu"-meldingen'],
		missingPhotos: missing
	};
	const entries: ZipEntry[] = [
		{ name: 'manifest.json', data: JSON.stringify(manifest, null, 2) },
		{ name: 'export.json', data: JSON.stringify(file, null, 2) },
		...photos.map((p) => ({
			name: file.data.media.find((m) => m.id === p.row.id)!.file,
			data: p.data,
			store: true
		}))
	];
	return createZip(entries, new Date(now));
}

export type CsvDataset =
	'purchases' | 'products' | 'statistics' | 'lists' | 'categories' | 'list-items';
export const CSV_DATASETS: CsvDataset[] = [
	'purchases',
	'products',
	'statistics',
	'lists',
	'categories',
	'list-items'
];

export function csvFor(dataset: CsvDataset, data: ExportData, now = Date.now()): string {
	const products = new Map(data.products.map((p) => [p.id, p]));
	const lists = new Map(data.lists.map((l) => [l.id, l]));
	const categories = new Map(data.categories.map((c) => [c.id, c]));
	const catName = (id: string | null | undefined) => (id ? (categories.get(id)?.name ?? '') : '');

	switch (dataset) {
		case 'purchases':
			return toCsv(
				[
					'purchase_id',
					'product_id',
					'product',
					'categorie',
					'lijst_id',
					'lijst',
					'status',
					'geactiveerd',
					'gekocht',
					'geannuleerd',
					'aantal',
					'eenheid'
				],
				data.purchaseEvents.map((e) => {
					const p = products.get(e.productId);
					return [
						e.id,
						e.productId,
						p?.name,
						catName(p?.categoryId),
						e.listId,
						e.listId ? lists.get(e.listId)?.name : '',
						STATUS_NL[e.status],
						e.activatedAt,
						e.completedAt,
						e.cancelledAt,
						dec(e.quantity),
						e.unit
					];
				})
			);
		case 'products':
			return toCsv(
				[
					'product_id',
					'product',
					'categorie_id',
					'categorie',
					'favoriet',
					'aangemaakt',
					'bijgewerkt'
				],
				data.products.map((p) => [
					p.id,
					p.name,
					p.categoryId,
					catName(p.categoryId),
					p.favorite ? 'ja' : 'nee',
					p.createdAt,
					p.updatedAt
				])
			);
		case 'statistics':
			return toCsv(
				[
					'product_id',
					'product',
					'aantal_keer_gekocht',
					'eerste_aankoop',
					'laatste_aankoop',
					'gem_interval_dagen',
					'per_maand',
					'aankopen_90_dagen',
					'volgende_verwacht',
					'voldoende_historie'
				],
				statisticsRows(data, now).map((s) => [
					s.productId,
					s.name,
					s.purchaseCount,
					s.firstPurchasedAt,
					s.lastPurchasedAt,
					dec(s.avgIntervalDays),
					dec(s.purchasesPerMonth),
					s.purchasesLast90Days,
					s.nextEstimatedAt,
					s.enoughHistory ? 'ja' : 'nee'
				])
			);
		case 'lists':
		case 'categories':
			return toCsv(
				[
					dataset === 'lists' ? 'lijst_id' : 'categorie_id',
					'naam',
					'positie',
					'aangemaakt',
					'bijgewerkt'
				],
				(dataset === 'lists' ? data.lists : data.categories).map((l) => [
					l.id,
					l.name,
					l.position,
					l.createdAt,
					l.updatedAt
				])
			);
		case 'list-items':
			return toCsv(
				[
					'item_id',
					'lijst_id',
					'lijst',
					'product_id',
					'product',
					'status',
					'aantal',
					'eenheid',
					'geactiveerd',
					'afgevinkt',
					'purchase_id'
				],
				data.listItems.map((i) => [
					i.id,
					i.listId,
					lists.get(i.listId)?.name,
					i.productId,
					products.get(i.productId)?.name,
					i.status === 'active' ? 'te halen' : 'afgevinkt',
					dec(i.quantity),
					i.unit,
					i.activatedAt,
					i.completedAt,
					i.purchaseEventId
				])
			);
	}
}

const ZIP_README = `8star Boodschappen — CSV-export

Alle bestanden: UTF-8, scheidingsteken ";", decimale komma, tijden in ISO 8601 (UTC).
Python/pandas: pd.read_csv("purchases.csv", sep=";", decimal=",")

purchases.csv    Elke activering van een product met uitkomst (gekocht/geannuleerd/open).
products.csv     Alle producten met stabiele product_id.
statistics.csv   Afgeleide statistieken per product.
lists.csv        Lijsten.
categories.csv   Categorieën.
list-items.csv   Huidige inhoud van de lijsten.

purchases.csv en products.csv kunnen weer worden geïmporteerd (Beheer → Gegevens).
Voor een volledige herstelbare kopie: gebruik de JSON-export.
`;

export function exportZip(db: DB, now = Date.now()): Buffer {
	const data = exportData(db);
	return createZip([
		{ name: 'README.txt', data: ZIP_README },
		...CSV_DATASETS.map((d) => ({ name: `${d}.csv`, data: csvFor(d, data, now) }))
	]);
}
