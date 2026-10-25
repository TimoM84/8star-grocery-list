/**
 * Product photos. Files live under DATA_DIR/media (on the persistent volume, outside the
 * read-only container root) with generated names `<id>.<ext>`; SQLite keeps their metadata.
 *
 * Uploads are validated server-side even though the app already resizes them: only JPEG, PNG
 * and WebP (detected by content, never by name or header), size and pixel limits, and all
 * metadata (EXIF, XMP, comments, text chunks) is stripped. SVG and anything else is refused.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { DB } from './db';

export const MAX_MEDIA_BYTES = 3 * 1024 * 1024;
export const MAX_MEDIA_EDGE = 4096;
export const MAX_MEDIA_PIXELS = 16_000_000;
export const MIN_MEDIA_EDGE = 16;
/** Unreferenced photos are kept this long, so undo and restoring recent backups still work. */
export const MEDIA_GRACE_MS = 30 * 24 * 60 * 60 * 1000;

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export type MediaMime = 'image/jpeg' | 'image/png' | 'image/webp';
const EXT: Record<MediaMime, string> = {
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

export class MediaError extends Error {
	constructor(
		public status: number,
		message: string
	) {
		super(message);
	}
}

export interface SanitizedImage {
	mime: MediaMime;
	width: number;
	height: number;
	data: Buffer;
}

export interface MediaRow {
	id: string;
	mime: MediaMime;
	width: number;
	height: number;
	bytes: number;
	sha256: string;
	created_at: number;
}

// ------------------------------------------------------------------ sanitising

/** Validates an image and returns a copy without metadata. Throws MediaError. */
export function sanitizeImage(input: Buffer): SanitizedImage {
	if (input.length > MAX_MEDIA_BYTES)
		throw new MediaError(413, `Foto is groter dan ${MAX_MEDIA_BYTES / 1024 / 1024} MB.`);
	if (input.length < 24) throw new MediaError(415, 'Geen geldige foto.');
	let out: SanitizedImage;
	if (input[0] === 0xff && input[1] === 0xd8 && input[2] === 0xff) out = sanitizeJpeg(input);
	else if (
		input.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
	)
		out = sanitizePng(input);
	else if (input.toString('ascii', 0, 4) === 'RIFF' && input.toString('ascii', 8, 12) === 'WEBP')
		out = sanitizeWebp(input);
	else throw new MediaError(415, 'Alleen JPEG-, PNG- of WebP-foto’s zijn toegestaan.');
	const { width, height } = out;
	if (width < MIN_MEDIA_EDGE || height < MIN_MEDIA_EDGE)
		throw new MediaError(422, 'Foto is te klein.');
	if (width > MAX_MEDIA_EDGE || height > MAX_MEDIA_EDGE || width * height > MAX_MEDIA_PIXELS)
		throw new MediaError(422, `Foto is te groot (max ${MAX_MEDIA_EDGE} px per zijde).`);
	return out;
}

function exifOrientation(app1: Buffer): number | null {
	// "Exif\0\0" + TIFF header
	if (app1.toString('ascii', 0, 4) !== 'Exif') return null;
	const tiff = app1.subarray(6);
	if (tiff.length < 8) return null;
	const le = tiff.toString('ascii', 0, 2) === 'II';
	const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
	const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
	const ifd = u32(4);
	if (ifd + 2 > tiff.length) return null;
	const count = u16(ifd);
	for (let i = 0; i < count; i++) {
		const e = ifd + 2 + i * 12;
		if (e + 12 > tiff.length) return null;
		if (u16(e) === 0x0112) return u16(e + 8);
	}
	return null;
}

function sanitizeJpeg(buf: Buffer): SanitizedImage {
	const parts: Buffer[] = [buf.subarray(0, 2)];
	let width = 0;
	let height = 0;
	let i = 2;
	while (i < buf.length) {
		if (buf[i] !== 0xff) throw new MediaError(415, 'Beschadigde JPEG.');
		const marker = buf[i + 1];
		if (marker === 0xd9) {
			parts.push(buf.subarray(i, i + 2));
			break;
		}
		if (marker === 0xff) {
			i++;
			continue;
		}
		if (i + 4 > buf.length) throw new MediaError(415, 'Beschadigde JPEG.');
		const len = buf.readUInt16BE(i + 2);
		const end = i + 2 + len;
		if (end > buf.length) throw new MediaError(415, 'Beschadigde JPEG.');
		const segment = buf.subarray(i, end);
		const payload = buf.subarray(i + 4, end);
		const isSof =
			marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
		if (isSof) {
			height = payload.readUInt16BE(1);
			width = payload.readUInt16BE(3);
		}
		if (marker === 0xe1) {
			const o = exifOrientation(payload);
			// The app bakes the orientation into the pixels; a rotated original would show sideways
			// once its EXIF is stripped, so it is refused instead of stored wrongly.
			if (o !== null && o !== 1)
				throw new MediaError(422, 'Foto heeft een draaiing in de metadata; kies hem via de app.');
		}
		// Keep JFIF (APP0) and Adobe (APP14, colour transform); drop all other APPn and comments.
		const isApp = marker >= 0xe0 && marker <= 0xef;
		const drop = (isApp && marker !== 0xe0 && marker !== 0xee) || marker === 0xfe;
		if (!drop) parts.push(segment);
		if (marker === 0xda) {
			// Start of scan: entropy-coded data follows until EOI; copy the rest verbatim.
			parts.push(buf.subarray(end));
			break;
		}
		i = end;
	}
	if (!width || !height) throw new MediaError(415, 'Beschadigde JPEG.');
	return { mime: 'image/jpeg', width, height, data: Buffer.concat(parts) };
}

const PNG_DROP = new Set(['tEXt', 'zTXt', 'iTXt', 'eXIf', 'tIME']);

function sanitizePng(buf: Buffer): SanitizedImage {
	const parts: Buffer[] = [buf.subarray(0, 8)];
	let width = 0;
	let height = 0;
	let i = 8;
	let ended = false;
	while (i + 12 <= buf.length) {
		const len = buf.readUInt32BE(i);
		const type = buf.toString('ascii', i + 4, i + 8);
		const end = i + 12 + len;
		if (end > buf.length) throw new MediaError(415, 'Beschadigde PNG.');
		if (type === 'IHDR') {
			width = buf.readUInt32BE(i + 8);
			height = buf.readUInt32BE(i + 12);
		}
		if (!PNG_DROP.has(type)) parts.push(buf.subarray(i, end));
		i = end;
		if (type === 'IEND') {
			ended = true;
			break;
		}
	}
	if (!ended || !width || !height) throw new MediaError(415, 'Beschadigde PNG.');
	return { mime: 'image/png', width, height, data: Buffer.concat(parts) };
}

function sanitizeWebp(buf: Buffer): SanitizedImage {
	const chunks: Buffer[] = [];
	let width = 0;
	let height = 0;
	let i = 12;
	let vp8x: Buffer | null = null;
	while (i + 8 <= buf.length) {
		const type = buf.toString('ascii', i, i + 4);
		const len = buf.readUInt32LE(i + 4);
		const end = i + 8 + len + (len % 2);
		if (i + 8 + len > buf.length) throw new MediaError(415, 'Beschadigde WebP.');
		const data = buf.subarray(i + 8, i + 8 + len);
		if (type === 'VP8 ' && len >= 10) {
			width = data.readUInt16LE(6) & 0x3fff;
			height = data.readUInt16LE(8) & 0x3fff;
		} else if (type === 'VP8L' && len >= 5) {
			const bits = data.readUInt32LE(1);
			width = (bits & 0x3fff) + 1;
			height = ((bits >> 14) & 0x3fff) + 1;
		} else if (type === 'VP8X' && len >= 10) {
			width = data.readUIntLE(4, 3) + 1;
			height = data.readUIntLE(7, 3) + 1;
		}
		if (type === 'EXIF' || type === 'XMP ') {
			i = end;
			continue;
		}
		const chunk = Buffer.from(buf.subarray(i, Math.min(end, buf.length)));
		if (type === 'VP8X') vp8x = chunk;
		chunks.push(chunk);
		i = end;
	}
	if (!width || !height) throw new MediaError(415, 'Beschadigde WebP.');
	// Clear the EXIF (0x08) and XMP (0x04) flags of the extended header.
	if (vp8x) vp8x[8] &= ~0x0c;
	const body = Buffer.concat(chunks);
	const header = Buffer.alloc(12);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(body.length + 4, 4);
	header.write('WEBP', 8, 'ascii');
	return { mime: 'image/webp', width, height, data: Buffer.concat([header, body]) };
}

// ------------------------------------------------------------------ storage

export class MediaStore {
	constructor(
		private db: DB,
		public readonly dir: string
	) {}

	private file(row: { id: string; mime: MediaMime }) {
		return path.join(this.dir, `${row.id}.${EXT[row.mime]}`);
	}

	row(id: string): MediaRow | undefined {
		if (!ID_RE.test(id)) return undefined;
		return this.db.prepare('SELECT * FROM media WHERE id = ?').get(id) as MediaRow | undefined;
	}

	/**
	 * Stores an upload under a client-generated id. Idempotent: re-sending the same photo with
	 * the same id (offline queue retries) succeeds; a different photo under an existing id fails.
	 */
	put(id: string, input: Buffer, now = Date.now()): MediaRow {
		if (!ID_RE.test(id)) throw new MediaError(400, 'Ongeldige foto-id.');
		const img = sanitizeImage(input);
		const sha256 = createHash('sha256').update(img.data).digest('hex');
		const existing = this.row(id);
		if (existing) {
			if (existing.sha256 === sha256 && fs.existsSync(this.file(existing))) return existing;
			if (existing.sha256 !== sha256)
				throw new MediaError(409, 'Er bestaat al een andere foto met deze id.');
		}
		this.writeFile({ id, mime: img.mime }, img.data);
		const row: MediaRow = {
			id,
			mime: img.mime,
			width: img.width,
			height: img.height,
			bytes: img.data.length,
			sha256,
			created_at: existing?.created_at ?? now
		};
		this.db
			.prepare(
				`INSERT INTO media (id, mime, width, height, bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
				 ON CONFLICT(id) DO NOTHING`
			)
			.run(row.id, row.mime, row.width, row.height, row.bytes, row.sha256, row.created_at);
		return row;
	}

	private writeFile(row: { id: string; mime: MediaMime }, data: Buffer) {
		fs.mkdirSync(this.dir, { recursive: true });
		const target = this.file(row);
		const tmp = `${target}.${process.pid}.tmp`;
		fs.writeFileSync(tmp, data);
		fs.renameSync(tmp, target);
	}

	read(id: string): { row: MediaRow; data: Buffer } | null {
		const row = this.row(id);
		if (!row) return null;
		try {
			return { row, data: fs.readFileSync(this.file(row)) };
		} catch {
			return null;
		}
	}

	/** Photo files for a full backup (only those referenced by products). */
	referenced(): { row: MediaRow; data: Buffer }[] {
		const rows = this.db
			.prepare(
				'SELECT m.* FROM media m WHERE m.id IN (SELECT photo_id FROM products WHERE photo_id IS NOT NULL) ORDER BY m.id'
			)
			.all() as MediaRow[];
		const out: { row: MediaRow; data: Buffer }[] = [];
		for (const row of rows) {
			try {
				out.push({ row, data: fs.readFileSync(this.file(row)) });
			} catch {
				/* missing file: the export reports it as a warning */
			}
		}
		return out;
	}

	/** Writes a sanitised photo from a backup and registers it (inside the import transaction). */
	restore(id: string, data: Buffer, createdAt: number): MediaRow {
		return this.put(id, data, createdAt);
	}

	/**
	 * Removes photos that no product uses anymore and that are older than the grace period,
	 * unless a recent op could still restore them (undo). Never touches photos in use.
	 */
	gc(now = Date.now()): number {
		const cutoff = now - MEDIA_GRACE_MS;
		const candidates = this.db
			.prepare(
				`SELECT * FROM media WHERE created_at < ?
				 AND id NOT IN (SELECT photo_id FROM products WHERE photo_id IS NOT NULL)`
			)
			.all(cutoff) as MediaRow[];
		const recentOp = this.db.prepare(
			"SELECT 1 FROM ops WHERE received_at >= ? AND undone_at IS NULL AND inverse LIKE '%' || ? || '%' LIMIT 1"
		);
		let removed = 0;
		for (const row of candidates) {
			if (recentOp.get(cutoff, row.id)) continue;
			this.db.prepare('DELETE FROM media WHERE id = ?').run(row.id);
			fs.rmSync(this.file(row), { force: true });
			removed++;
		}
		// Files without a database row (e.g. left by an aborted import) after the grace period.
		if (fs.existsSync(this.dir)) {
			for (const name of fs.readdirSync(this.dir)) {
				const id = name.replace(/\.(jpg|png|webp)$/, '');
				const full = path.join(this.dir, name);
				if (name.endsWith('.tmp') || !this.row(id)) {
					const st = fs.statSync(full);
					if (st.mtimeMs < cutoff || name.endsWith('.tmp')) fs.rmSync(full, { force: true });
				}
			}
		}
		return removed;
	}
}
