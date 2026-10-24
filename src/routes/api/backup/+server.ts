import { json } from '@sveltejs/kit';
import path from 'node:path';
import { getRuntime } from '$lib/server/runtime';
import { createBackup, listBackups } from '$lib/server/backup';

export const GET = () => {
	const { config } = getRuntime();
	return json(listBackups(config.backupDir).slice(0, 20));
};

export const POST = async () => {
	const rt = getRuntime();
	const file = await createBackup(rt.db, rt.config.backupDir, 'manual');
	rt.lastBackupAt = Date.now();
	return json({ file: path.basename(file), createdAt: rt.lastBackupAt });
};
