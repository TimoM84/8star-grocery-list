import { error, json } from '@sveltejs/kit';
import { getRuntime } from '$lib/server/runtime';
import { migrations } from '$lib/server/migrations';

/**
 * Wipes all data back to a fresh install. Only available when the server runs with
 * E2E_TEST_MODE=1 (Playwright); returns 404 in every normal deployment.
 */
export const POST = () => {
	if (process.env.E2E_TEST_MODE !== '1') error(404, 'Not found');
	const { db, store } = getRuntime();
	db.transaction(() => {
		db.exec(`
			DELETE FROM items; DELETE FROM cycles; DELETE FROM products; DELETE FROM id_aliases;
			DELETE FROM ops; DELETE FROM lists; DELETE FROM categories;
		`);
		db.exec(migrations.find((m) => m.version === 2)!.sql);
	})();
	store.touch();
	return json({ ok: true, seq: store.seq });
};
