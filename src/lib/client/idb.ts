/**
 * Tiny promise wrapper around IndexedDB. Three stores:
 *  - `kv`      : snapshot, client id, aliases, cached history
 *  - `pending` : the durable outbound operation queue (ordered by `seq`)
 *  - `media`   : photos taken offline, waiting for upload (v2)
 */

const DB_NAME = '8star-grocery';
const DB_VERSION = 2;

/** A photo waiting for upload. Uploaded before the op that attaches it to a product. */
export interface PendingMedia {
	id: string;
	blob: Blob;
	createdAt: number;
	/** Set when the server refused the photo (it will not be retried). */
	error: string | null;
}

export interface PendingRecord<T = unknown> {
	id: string;
	seq: number;
	op: T;
	/** Server seq after which this op is reflected in snapshots (set once acknowledged). */
	ackSeq: number | null;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function req<T>(r: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		r.onsuccess = () => resolve(r.result);
		r.onerror = () => reject(r.error);
	});
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve();
		tx.onerror = () => reject(tx.error);
		tx.onabort = () => reject(tx.error ?? new Error('transaction aborted'));
	});
}

export function openIdb(): Promise<IDBDatabase> {
	if (dbPromise) return dbPromise;
	dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
		if (typeof indexedDB === 'undefined') return reject(new Error('IndexedDB unavailable'));
		const open = indexedDB.open(DB_NAME, DB_VERSION);
		open.onupgradeneeded = () => {
			const db = open.result;
			if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
			if (!db.objectStoreNames.contains('pending')) {
				const store = db.createObjectStore('pending', { keyPath: 'id' });
				store.createIndex('seq', 'seq');
			}
			if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
		};
		open.onsuccess = () => {
			const db = open.result;
			db.onversionchange = () => db.close();
			resolve(db);
		};
		open.onerror = () => reject(open.error);
		open.onblocked = () => reject(new Error('IndexedDB blocked'));
	});
	dbPromise.catch(() => (dbPromise = null));
	return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
	const db = await openIdb();
	return (await req(db.transaction('kv').objectStore('kv').get(key))) as T | undefined;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
	const db = await openIdb();
	const tx = db.transaction('kv', 'readwrite');
	tx.objectStore('kv').put(value, key);
	await done(tx);
}

export async function pendingAll<T>(): Promise<PendingRecord<T>[]> {
	const db = await openIdb();
	const rows = (await req(
		db.transaction('pending').objectStore('pending').index('seq').getAll()
	)) as PendingRecord<T>[];
	return rows;
}

export async function pendingPut(records: PendingRecord[]): Promise<void> {
	if (!records.length) return;
	const db = await openIdb();
	const tx = db.transaction('pending', 'readwrite');
	const store = tx.objectStore('pending');
	for (const r of records) store.put(r);
	await done(tx);
}

export async function pendingDelete(ids: string[]): Promise<void> {
	if (!ids.length) return;
	const db = await openIdb();
	const tx = db.transaction('pending', 'readwrite');
	const store = tx.objectStore('pending');
	for (const id of ids) store.delete(id);
	await done(tx);
}

export async function mediaAll(): Promise<PendingMedia[]> {
	const db = await openIdb();
	return (await req(db.transaction('media').objectStore('media').getAll())) as PendingMedia[];
}

export async function mediaPut(record: PendingMedia): Promise<void> {
	const db = await openIdb();
	const tx = db.transaction('media', 'readwrite');
	tx.objectStore('media').put(record);
	await done(tx);
}

export async function mediaDelete(id: string): Promise<void> {
	const db = await openIdb();
	const tx = db.transaction('media', 'readwrite');
	tx.objectStore('media').delete(id);
	await done(tx);
}

/** Test helper: forget the cached connection. */
export function resetIdbConnection() {
	dbPromise = null;
}
