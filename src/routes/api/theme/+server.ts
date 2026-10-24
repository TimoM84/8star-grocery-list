import { json } from '@sveltejs/kit';
import { readTheme } from '$lib/server/theme';
export const GET = () => json(readTheme(), {
  headers: { 'Cache-Control': 'no-store' }
});
