/** Small ZIP writer/reader (deflate) for CSV exports and full backups. No dependencies. */

import { crc32, deflateRawSync, inflateRawSync } from 'node:zlib';

export interface ZipEntry {
	name: string;
	data: Buffer | string;
	/** Store without compression (already compressed data such as JPEG). */
	store?: boolean;
}

function dosTime(date: Date): { time: number; date: number } {
	return {
		time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
		date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
	};
}

export function createZip(entries: ZipEntry[], modified = new Date()): Buffer {
	const { time, date } = dosTime(modified);
	const locals: Buffer[] = [];
	const centrals: Buffer[] = [];
	let offset = 0;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, 'utf8');
		const raw = typeof entry.data === 'string' ? Buffer.from(entry.data, 'utf8') : entry.data;
		// Photos are already compressed: store them as they are.
		const store = entry.store === true;
		const compressed = store ? raw : deflateRawSync(raw, { level: 9 });
		const crc = crc32(raw);

		const local = Buffer.alloc(30);
		local.writeUInt32LE(0x04034b50, 0);
		local.writeUInt16LE(20, 4); // version needed
		local.writeUInt16LE(0x0800, 6); // UTF-8 names
		local.writeUInt16LE(store ? 0 : 8, 8); // stored or deflate
		local.writeUInt16LE(time, 10);
		local.writeUInt16LE(date, 12);
		local.writeUInt32LE(crc, 14);
		local.writeUInt32LE(compressed.length, 18);
		local.writeUInt32LE(raw.length, 22);
		local.writeUInt16LE(name.length, 26);
		local.writeUInt16LE(0, 28);
		locals.push(local, name, compressed);

		const central = Buffer.alloc(46);
		central.writeUInt32LE(0x02014b50, 0);
		central.writeUInt16LE(20, 4); // version made by
		central.writeUInt16LE(20, 6);
		central.writeUInt16LE(0x0800, 8);
		central.writeUInt16LE(store ? 0 : 8, 10);
		central.writeUInt16LE(time, 12);
		central.writeUInt16LE(date, 14);
		central.writeUInt32LE(crc, 16);
		central.writeUInt32LE(compressed.length, 20);
		central.writeUInt32LE(raw.length, 24);
		central.writeUInt16LE(name.length, 28);
		central.writeUInt32LE(offset, 42);
		centrals.push(central, name);
		offset += local.length + name.length + compressed.length;
	}
	const centralSize = centrals.reduce((n, b) => n + b.length, 0);
	const end = Buffer.alloc(22);
	end.writeUInt32LE(0x06054b50, 0);
	end.writeUInt16LE(entries.length, 8);
	end.writeUInt16LE(entries.length, 10);
	end.writeUInt32LE(centralSize, 12);
	end.writeUInt32LE(offset, 16);
	return Buffer.concat([...locals, ...centrals, end]);
}

// ------------------------------------------------------------------ reading

export class ZipError extends Error {}

/** Limits against malformed or malicious archives (zip bombs). */
export const MAX_ZIP_ENTRIES = 5000;
export const MAX_ZIP_UNCOMPRESSED = 300 * 1024 * 1024;

/**
 * Minimal ZIP reader (stored and deflate, via the central directory). Entry names are only
 * used as lookup keys, never as file system paths.
 */
export function readZip(buf: Buffer): Map<string, Buffer> {
	let eocd = -1;
	for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
		if (buf.readUInt32LE(i) === 0x06054b50) {
			eocd = i;
			break;
		}
	}
	if (eocd < 0) throw new ZipError('geen geldig ZIP-bestand');
	const count = buf.readUInt16LE(eocd + 10);
	const cdOffset = buf.readUInt32LE(eocd + 16);
	if (count > MAX_ZIP_ENTRIES) throw new ZipError('te veel bestanden in het archief');
	const out = new Map<string, Buffer>();
	let total = 0;
	let p = cdOffset;
	for (let n = 0; n < count; n++) {
		if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50)
			throw new ZipError('beschadigde inhoudsopgave');
		const method = buf.readUInt16LE(p + 10);
		const crc = buf.readUInt32LE(p + 16);
		const compressed = buf.readUInt32LE(p + 20);
		const size = buf.readUInt32LE(p + 24);
		const nameLen = buf.readUInt16LE(p + 28);
		const extraLen = buf.readUInt16LE(p + 30);
		const commentLen = buf.readUInt16LE(p + 32);
		const local = buf.readUInt32LE(p + 42);
		const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
		p += 46 + nameLen + extraLen + commentLen;
		if (name.endsWith('/')) continue;
		total += size;
		if (total > MAX_ZIP_UNCOMPRESSED) throw new ZipError('archief is uitgepakt te groot');
		if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50)
			throw new ZipError('beschadigd bestand in archief');
		const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
		const raw = buf.subarray(start, start + compressed);
		if (raw.length !== compressed) throw new ZipError('archief is afgekapt');
		let data: Buffer;
		if (method === 0) data = Buffer.from(raw);
		else if (method === 8) {
			try {
				data = inflateRawSync(raw, { maxOutputLength: size + 1 });
			} catch {
				throw new ZipError(`kan "${name}" niet uitpakken`);
			}
		} else throw new ZipError(`niet-ondersteunde compressie in "${name}"`);
		if (data.length !== size || crc32(data) !== crc)
			throw new ZipError(`controlesom van "${name}" klopt niet`);
		out.set(name, data);
	}
	return out;
}
