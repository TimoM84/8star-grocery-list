/** Load the global theme without bundling Compose values into the frontend. */
type Palette = { accent: string; strong: string; contrast: string; soft: string };
type Theme = { primary: string; light: Palette; dark: Palette };
const CACHE = '8star.runtimeTheme';
const HEX = /^#[\da-fA-F]{6}$/;

function apply(theme: Theme) {
	if (!HEX.test(theme.primary)) return;
	for (const mode of ['light', 'dark'] as const) {
		for (const [key, value] of Object.entries(theme[mode])) {
			if (!HEX.test(value)) return;
			if (!['accent', 'strong', 'contrast', 'soft'].includes(key)) return;
		}
	}
	const root = document.documentElement;
	for (const mode of ['light', 'dark'] as const) {
		for (const [key, value] of Object.entries(theme[mode])) {
			root.style.setProperty(`--runtime-${mode}-${key}`, value);
		}
	}
	for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
		meta.setAttribute('content', theme.primary);
	}
}

export async function initializeTheme() {
	try {
		const saved = localStorage.getItem(CACHE);
		if (saved) apply(JSON.parse(saved) as Theme);
	} catch {
		// Local storage may be unavailable.
	}
	try {
		const response = await fetch('/api/theme', { cache: 'no-store' });
		if (!response.ok) return;
		const theme = (await response.json()) as Theme;
		apply(theme);
		try {
			localStorage.setItem(CACHE, JSON.stringify(theme));
		} catch {
			// Local storage may be unavailable.
		}
	} catch {
		// Use cached colors when offline.
	}
}
