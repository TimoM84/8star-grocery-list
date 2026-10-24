/**
 * Accent palette derivation for APP_PRIMARY_COLOR. Pure functions (used by the server and the
 * tests): every derived pair is checked against WCAG AA (4.5:1) for normal text.
 */

export const DEFAULT_PRIMARY = '#1D7F46';
export const MIN_CONTRAST = 4.5;

/** Backgrounds the accent is used on (must match src/app.css). */
export const SURFACES = {
	light: { bg: '#f4f5f2', surface: '#ffffff' },
	dark: { bg: '#0c0f0d', surface: '#151a16' }
} as const;

export interface Palette {
	/** Buttons, active states, accent text and focus rings. */
	accent: string;
	/** Pressed state of accent buttons. */
	strong: string;
	/** Text/icons on accent backgrounds. */
	contrast: string;
	/** Subtle tinted backgrounds (chips, highlights). */
	soft: string;
}

export interface Theme {
	primary: string;
	light: Palette;
	dark: Palette;
}

/** The hand-tuned v1.0.0 palette, used unchanged for the default color. */
const DEFAULT_THEME: Theme = {
	primary: DEFAULT_PRIMARY,
	light: { accent: '#1d7f46', strong: '#166b3a', contrast: '#ffffff', soft: '#ebf6ee' },
	dark: { accent: '#4cc982', strong: '#6bd697', contrast: '#04210f', soft: '#163322' }
};

const HEX = /^#?([0-9a-fA-F]{6})$/;

/**
 * Normalises a configured color. Accepts `#RRGGBB` or `RRGGBB` (quotes/whitespace tolerated).
 * Anything else yields `null` so the caller can fall back to the default.
 */
export function parseHexColor(raw: string | undefined | null): string | null {
	if (raw === undefined || raw === null) return null;
	const m = HEX.exec(raw.trim().replace(/^["']|["']$/g, ''));
	return m ? `#${m[1].toUpperCase()}` : null;
}

function rgb(hex: string): [number, number, number] {
	const h = hex.replace('#', '');
	return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toHex([r, g, b]: number[]): string {
	return (
		'#' +
		[r, g, b]
			.map((v) =>
				Math.round(Math.min(255, Math.max(0, v)))
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

/** Linear mix in sRGB: amount 0 → a, 1 → b. */
export function mix(a: string, b: string, amount: number): string {
	const x = rgb(a);
	const y = rgb(b);
	return toHex(x.map((v, i) => v + (y[i] - v) * amount));
}

export function luminance(hex: string): number {
	const [r, g, b] = rgb(hex).map((v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
	const la = luminance(a);
	const lb = luminance(b);
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Moves `color` towards `target` in small steps until `ok` holds (or it reaches the target). */
function adjust(color: string, target: string, ok: (c: string) => boolean): string {
	let c = color;
	for (let i = 0; i <= 40 && !ok(c); i++) c = mix(color, target, Math.min(1, i * 0.025));
	return c;
}

function lightPalette(primary: string): Palette {
	const { bg, surface } = SURFACES.light;
	// Accent must read as text on the page, on cards and on its own soft tint.
	let accent = adjust(
		primary,
		'#000000',
		(c) => contrast(c, bg) >= MIN_CONTRAST + 0.1 && contrast(c, surface) >= MIN_CONTRAST
	);
	let soft = mix(accent, '#ffffff', 0.86);
	for (let i = 0; i < 20 && contrast(accent, soft) < MIN_CONTRAST; i++) {
		accent = mix(accent, '#000000', 0.05);
		soft = mix(accent, '#ffffff', 0.86);
	}
	const fg = contrast('#ffffff', accent) >= MIN_CONTRAST ? '#ffffff' : '#0b0f0c';
	const strong = mix(accent, fg === '#ffffff' ? '#000000' : '#ffffff', 0.15);
	return { accent, strong, contrast: fg, soft };
}

function darkPalette(primary: string): Palette {
	const { bg, surface } = SURFACES.dark;
	// On dark backgrounds the accent becomes a lighter tint of the primary color.
	let accent = adjust(primary, '#ffffff', (c) => contrast(c, surface) >= 6 && contrast(c, bg) >= 6);
	let soft = mix(accent, surface, 0.8);
	for (let i = 0; i < 20 && contrast(accent, soft) < MIN_CONTRAST; i++) {
		soft = mix(accent, surface, Math.min(0.97, 0.8 + (i + 1) * 0.01));
		if (i > 10) accent = mix(accent, '#ffffff', 0.05);
	}
	let fg = mix(accent, '#000000', 0.86);
	if (contrast(fg, accent) < MIN_CONTRAST)
		fg = contrast('#000000', accent) >= contrast('#ffffff', accent) ? '#000000' : '#ffffff';
	const strong = mix(accent, '#ffffff', 0.15);
	return { accent, strong, contrast: fg, soft };
}

export function deriveTheme(primary: string): Theme {
	if (primary.toUpperCase() === DEFAULT_PRIMARY) return DEFAULT_THEME;
	return { primary, light: lightPalette(primary), dark: darkPalette(primary) };
}

export interface ThemeResolution {
	theme: Theme;
	/** Set when a configured value was rejected. */
	warning: string | null;
}

/** Resolves the runtime theme from the APP_PRIMARY_COLOR value; invalid → default + warning. */
export function resolveTheme(raw: string | undefined | null): ThemeResolution {
	const empty = raw === undefined || raw === null || raw.trim() === '';
	const parsed = parseHexColor(raw);
	if (!parsed) {
		return {
			theme: DEFAULT_THEME,
			warning: empty
				? null
				: `APP_PRIMARY_COLOR "${raw}" is not a six-digit hex color (e.g. #2563EB); using ${DEFAULT_PRIMARY}.`
		};
	}
	return { theme: deriveTheme(parsed), warning: null };
}

/** CSS that overrides the accent variables from src/app.css (light, dark, both modes). */
export function themeCss(t: Theme): string {
	const vars = (p: Palette) =>
		`--accent:${p.accent};--accent-strong:${p.strong};--accent-contrast:${p.contrast};--accent-soft:${p.soft};`;
	return `:root:root{${vars(t.light)}}@media (prefers-color-scheme: dark){:root:root{${vars(t.dark)}}}`;
}
