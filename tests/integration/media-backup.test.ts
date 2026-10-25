/**
 * Product photos (validation, metadata stripping, idempotent uploads, cleanup) and the full
 * backup ZIP (export format 2 + photos) round trip.
 */

import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deflateSync, crc32 } from 'node:zlib';
import { openDatabase } from '$lib/server/db';
import { GroceryStore } from '$lib/server/store';
import { writeSettings } from '$lib/server/settings';
import { MEDIA_GRACE_MS, MediaError, MediaStore, sanitizeImage } from '$lib/server/media';
import { exportBackupZip } from '$lib/server/export';
import { runImport } from '$lib/server/transfer/importer';
import { exportData } from '$lib/server/transfer/format';
import { readZip } from '$lib/server/transfer/zip';
import type { Op, OpPayload } from '$lib/shared/ops';

// ------------------------------------------------------------------ test images

function segment(marker: number, payload: Buffer) {
	const head = Buffer.alloc(4);
	head.writeUInt16BE(0xff00 | marker, 0);
	head.writeUInt16BE(payload.length + 2, 2);
	return Buffer.concat([head, payload]);
}

function exif(orientation: number) {
	const tiff = Buffer.alloc(26);
	tiff.write('MM', 0, 'ascii');
	tiff.writeUInt16BE(42, 2);
	tiff.writeUInt32BE(8, 4);
	tiff.writeUInt16BE(1, 8); // one entry
	tiff.writeUInt16BE(0x0112, 10); // Orientation
	tiff.writeUInt16BE(3, 12); // SHORT
	tiff.writeUInt32BE(1, 14);
	tiff.writeUInt16BE(orientation, 18);
	return Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
}

function jpeg(width: number, height: number, orientation: number | null = 1) {
	const sof = Buffer.alloc(15);
	sof[0] = 8;
	sof.writeUInt16BE(height, 1);
	sof.writeUInt16BE(width, 3);
	sof[5] = 3;
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		segment(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'binary')),
		...(orientation === null ? [] : [segment(0xe1, exif(orientation))]),
		segment(0xfe, Buffer.from('camera: secret model; gps: 52.1,5.1')),
		segment(0xc0, sof),
		segment(0xda, Buffer.from([1, 1, 0, 0, 63, 0])),
		Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a]),
		Buffer.from([0xff, 0xd9])
	]);
}

function pngChunk(type: string, data: Buffer) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function png(width: number, height: number) {
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const raw = Buffer.alloc((width * 3 + 1) * height);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		pngChunk('IHDR', ihdr),
		pngChunk('tEXt', Buffer.from('Author\0Somebody')),
		pngChunk('IDAT', deflateSync(raw)),
		pngChunk('IEND', Buffer.alloc(0))
	]);
}

// ------------------------------------------------------------------ helpers

function setup() {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), '8star-media-'));
	const db = openDatabase(path.join(dir, 'grocery.db'));
	// These tests check the Dutch wording; the household language decides it.
	writeSettings(db, { language: 'nl' });
	const store = new GroceryStore(db);
	const media = new MediaStore(db, path.join(dir, 'media'));
	let k = 0;
	const apply = (payload: OpPayload) =>
		store.applyOps('c', [{ id: `op-${++k}`, at: Date.now(), ...payload } as Op]).results[0];
	return { dir, db, store, media, apply };
}

describe('photo validation', () => {
	it('accepts JPEG and strips EXIF and comments', () => {
		const out = sanitizeImage(jpeg(800, 600));
		expect(out).toMatchObject({ mime: 'image/jpeg', width: 800, height: 600 });
		expect(out.data.includes(Buffer.from('Exif'))).toBe(false);
		expect(out.data.includes(Buffer.from('gps'))).toBe(false);
		expect(out.data.includes(Buffer.from('JFIF'))).toBe(true);
	});

	it('refuses a JPEG whose orientation is only in its metadata', () => {
		expect(() => sanitizeImage(jpeg(800, 600, 6))).toThrow(MediaError);
	});

	it('accepts PNG without text chunks', () => {
		const out = sanitizeImage(png(32, 24));
		expect(out).toMatchObject({ mime: 'image/png', width: 32, height: 24 });
		expect(out.data.includes(Buffer.from('Somebody'))).toBe(false);
	});

	it('refuses SVG, executables, oversized and tiny images', () => {
		const svg = Buffer.from(
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
		);
		expect(() => sanitizeImage(svg)).toThrow(/JPEG/);
		expect(() => sanitizeImage(Buffer.from('MZ\x90\0' + 'x'.repeat(100), 'binary'))).toThrow();
		expect(() => sanitizeImage(jpeg(5000, 100))).toThrow(/too large/);
		expect(() => sanitizeImage(jpeg(8, 8))).toThrow(/too small/);
		expect(() => sanitizeImage(Buffer.alloc(4 * 1024 * 1024, 0xff))).toThrow(/larger than/);
	});
});

describe('photo storage', () => {
	it('stores under a generated name, is idempotent and refuses a different photo under the same id', () => {
		const t = setup();
		const row = t.media.put('photo-1', jpeg(400, 300));
		expect(fs.readdirSync(t.media.dir)).toEqual(['photo-1.jpg']);
		expect(t.media.put('photo-1', jpeg(400, 300))).toEqual(row);
		expect(() => t.media.put('photo-1', jpeg(401, 300))).toThrow(/andere foto/);
		expect(() => t.media.put('../evil', jpeg(400, 300))).toThrow(/Ongeldige/);
	});

	it('attaching needs an uploaded photo; replacing and removing are undoable', () => {
		const t = setup();
		const added = t.apply({
			type: 'item.add',
			itemId: 'i1',
			productId: 'p1',
			listId: 'default',
			name: 'Boter',
			quantity: null,
			unit: null,
			categoryId: null
		});
		expect(t.apply({ type: 'product.setPhoto', productId: 'p1', mediaId: 'nope' }).reason).toBe(
			'media_missing'
		);
		t.media.put('ph1', jpeg(400, 300));
		t.media.put('ph2', png(40, 30));
		t.apply({ type: 'product.setPhoto', productId: added.productId!, mediaId: 'ph1' });
		const replace = t.store.applyOps('c', [
			{ id: 'replace', at: Date.now(), type: 'product.setPhoto', productId: 'p1', mediaId: 'ph2' }
		]).results[0];
		expect(t.store.snapshot().products[0].photoId).toBe('ph2');
		t.apply({ type: 'undo', targetOpId: replace.opId });
		expect(t.store.snapshot().products[0].photoId).toBe('ph1');
		t.apply({ type: 'product.setPhoto', productId: 'p1', mediaId: null });
		expect(t.store.snapshot().products[0].photoId).toBeNull();
		// Snapshots carry only the id, never image bytes.
		expect(JSON.stringify(t.store.snapshot()).length).toBeLessThan(20_000);
	});

	it('cleanup never removes photos in use and keeps unused ones for the grace period', () => {
		const t = setup();
		t.apply({
			type: 'item.add',
			itemId: 'i1',
			productId: 'p1',
			listId: 'default',
			name: 'Boter',
			quantity: null,
			unit: null,
			categoryId: null
		});
		const old = Date.now() - MEDIA_GRACE_MS - 1000;
		t.media.put('used', jpeg(100, 100), old);
		t.media.put('unused', jpeg(120, 100), old);
		t.media.put('fresh', jpeg(140, 100));
		t.db.prepare("UPDATE products SET photo_id = 'used'").run();
		expect(t.media.gc()).toBe(1);
		expect(t.media.row('used')).toBeDefined();
		expect(t.media.row('fresh')).toBeDefined();
		expect(t.media.row('unused')).toBeUndefined();
		expect(fs.readdirSync(t.media.dir).sort()).toEqual(['fresh.jpg', 'used.jpg']);
	});
});

describe('full backup ZIP', () => {
	function richStore() {
		const t = setup();
		t.apply({ type: 'list.create', listId: 'camp', name: 'Kamperen', kind: 'checklist' });
		t.apply({ type: 'list.create', listId: 'drogist', name: 'Drogist' });
		t.apply({
			type: 'item.add',
			itemId: 'i-boter',
			productId: 'p-boter',
			listId: 'default',
			name: 'Boter',
			quantity: 2,
			unit: 'pak',
			categoryId: 'cat-zuivel',
			note: 'voor zaterdag'
		});
		t.apply({
			type: 'item.update',
			itemId: 'i-boter',
			changes: { substituteOk: true, substituteNote: 'ander merk mag' },
			base: {}
		});
		t.apply({
			type: 'product.update',
			productId: 'p-boter',
			changes: {
				note: 'ongezouten',
				defaultQuantity: 1,
				defaultUnit: 'pak',
				preferredListId: 'default'
			},
			base: {}
		});
		t.apply({ type: 'product.setStock', productId: 'p-boter', status: 'low' });
		t.apply({ type: 'alias.add', aliasId: 'al-1', productId: 'p-boter', alias: 'roomboter' });
		t.apply({
			type: 'item.add',
			itemId: 'i-tent',
			productId: 'p-tent',
			listId: 'camp',
			name: 'Tent',
			quantity: null,
			unit: null,
			categoryId: null
		});
		t.apply({
			type: 'bundle.save',
			bundleId: 'b-pan',
			name: 'Pannenkoeken',
			servings: 4,
			lines: [
				{
					lineId: 'bl-1',
					productId: 'p-boter',
					name: 'Boter',
					quantity: 1,
					unit: 'pak',
					note: null
				},
				{
					lineId: 'bl-2',
					productId: 'p-bloem',
					name: 'Bloem',
					quantity: 500,
					unit: 'g',
					note: 'zelfrijzend'
				}
			]
		});
		t.apply({
			type: 'list.setCategoryOrder',
			listId: 'drogist',
			categoryIds: ['cat-verzorging', 'cat-huishouden']
		});
		t.media.put('photo-boter', jpeg(640, 480));
		t.apply({ type: 'product.setPhoto', productId: 'p-boter', mediaId: 'photo-boter' });
		return t;
	}

	it('contains a manifest, export format 2 and the photos', () => {
		const t = richStore();
		const zip = readZip(exportBackupZip(t.db, t.media, '1.2.0'));
		expect([...zip.keys()].sort()).toEqual([
			'export.json',
			'manifest.json',
			'media/photo-boter.jpg'
		]);
		const manifest = JSON.parse(zip.get('manifest.json')!.toString());
		expect(manifest).toMatchObject({ format: '8star-grocery-backup', formatVersion: 1 });
		expect(manifest.notIncluded).toContain('winkelrondes');
		const file = JSON.parse(zip.get('export.json')!.toString());
		expect(file.formatVersion).toBe(2);
		expect(file.data.bundles[0].lines).toHaveLength(2);
		expect(file.data.productAliases[0].alias).toBe('roomboter');
	});

	it('restores everything, including photos, into an empty installation', () => {
		const src = richStore();
		const zip = exportBackupZip(src.db, src.media, '1.2.0');
		const dst = setup();
		const preview = runImport(dst.store, {
			kind: 'json',
			mode: 'replace',
			text: '',
			bytes: zip,
			preview: true,
			backupDir: path.join(dst.dir, 'backups'),
			media: dst.media
		});
		expect(preview.ok, preview.errors.join('\n')).toBe(true);
		expect(fs.existsSync(dst.media.dir)).toBe(false); // a preview writes no files

		const report = runImport(dst.store, {
			kind: 'json',
			mode: 'replace',
			text: '',
			bytes: zip,
			preview: false,
			backupDir: path.join(dst.dir, 'backups'),
			media: dst.media
		});
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.counts.media.added).toBe(1);
		const a = exportData(src.db);
		const b = exportData(dst.db);
		expect(b.lists).toEqual(a.lists);
		expect(b.products).toEqual(a.products);
		expect(b.listItems).toEqual(a.listItems);
		expect(b.productAliases).toEqual(a.productAliases);
		expect(b.bundles).toEqual(a.bundles);
		expect(b.media).toEqual(a.media);
		expect(dst.media.read('photo-boter')!.data).toEqual(src.media.read('photo-boter')!.data);
	});

	it('a JSON-only export keeps everything but tells that photos are only in the ZIP', () => {
		const src = richStore();
		const dst = setup();
		const json = JSON.stringify({
			format: '8star-grocery-export',
			formatVersion: 2,
			data: exportData(src.db)
		});
		const report = runImport(dst.store, {
			kind: 'json',
			mode: 'replace',
			text: json,
			preview: false,
			backupDir: path.join(dst.dir, 'backups'),
			media: dst.media
		});
		expect(report.ok, report.errors.join('\n')).toBe(true);
		expect(report.warnings.join(' ')).toMatch(/foto/);
		const boter = dst.store.snapshot().products.find((p) => p.name === 'Boter')!;
		expect(boter).toMatchObject({ photoId: null, note: 'ongezouten', stockStatus: 'low' });
	});

	it('merging a backup keeps existing data and adds missing bundles and aliases', () => {
		const src = richStore();
		const zip = exportBackupZip(src.db, src.media, '1.2.0');
		const dst = setup();
		const opts = {
			kind: 'json' as const,
			mode: 'merge' as const,
			text: '',
			bytes: zip,
			preview: false,
			backupDir: path.join(dst.dir, 'backups'),
			media: dst.media
		};
		expect(runImport(dst.store, opts).ok).toBe(true);
		const again = runImport(dst.store, opts);
		expect(again.ok).toBe(true);
		expect(again.counts.bundles).toMatchObject({ added: 0, matched: 1 });
		expect(dst.store.snapshot().bundles).toHaveLength(1);
		expect(dst.store.snapshot().aliases).toHaveLength(1);
		expect(dst.store.snapshot().products.find((p) => p.name === 'Boter')!.photoId).toBe(
			'photo-boter'
		);
	});

	it('refuses a CSV ZIP or a damaged archive without changing anything', () => {
		const dst = setup();
		const before = JSON.stringify(exportData(dst.db));
		const bad = runImport(dst.store, {
			kind: 'json',
			mode: 'merge',
			text: '',
			bytes: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]),
			preview: false,
			backupDir: path.join(dst.dir, 'backups'),
			media: dst.media
		});
		expect(bad.ok).toBe(false);
		expect(JSON.stringify(exportData(dst.db))).toBe(before);
	});
});
