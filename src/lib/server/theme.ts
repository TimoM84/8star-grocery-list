/** Runtime theme from APP_PRIMARY_COLOR (Docker Compose / Dockhand), read per request. */

import { resolveTheme, themeCss, type Theme } from '$lib/shared/color';

let cache: { raw: string | undefined; theme: Theme; css: string } | null = null;

export function currentTheme(): { theme: Theme; css: string } {
	const raw = process.env.APP_PRIMARY_COLOR;
	if (!cache || cache.raw !== raw) {
		const { theme, warning } = resolveTheme(raw);
		if (warning) console.warn(`[8star] ${warning}`);
		cache = { raw, theme, css: themeCss(theme) };
	}
	return cache;
}
