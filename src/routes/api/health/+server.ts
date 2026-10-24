import { json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { schemaVersion } from '$lib/server/db';

export const GET = () => {
	try {
		const { db, store, hub, lastBackupAt } = getRuntime();
		db.prepare('SELECT 1').get();
		return json({
			status: 'ok',
			version: __APP_VERSION__,
			schemaVersion: schemaVersion(db),
			seq: store.seq,
			clients: hub.size,
			lastBackupAt,
			time: Date.now()
		});
	} catch (e) {
		return json({ status: 'error', error: (e as Error).message }, { status: 503 });
	}
};
