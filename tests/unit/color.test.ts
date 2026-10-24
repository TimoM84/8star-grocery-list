import { describe, expect, it } from 'vitest';
import {
	contrast,
	DEFAULT_PRIMARY,
	deriveTheme,
	MIN_CONTRAST,
	parseHexColor,
	resolveTheme,
	SURFACES,
	themeCss
} from '$lib/shared/color';

const SAMPLES = {
	blue: '#2563EB',
	green: '#1D7F46',
	orange: '#F97316',
	yellow: '#FFFF00',
	cyan: '#22D3EE',
	purple: '#7C3AED',
	red: '#DC2626',
	black: '#000000',
	white: '#FFFFFF',
	navy: '#0B1F4D',
	pink: '#EC4899',
	grey: '#808080'
};

describe('APP_PRIMARY_COLOR parsing', () => {
	it.each([
		['#2563EB', '#2563EB'],
		['#2563eb', '#2563EB'],
		['2563eb', '#2563EB'],
		[' "#F97316" ', '#F97316']
	])('accepts %s', (raw, expected) => expect(parseHexColor(raw)).toBe(expected));

	it.each(['', '#123', 'blue', '#GGGGGG', '#1234567', 'rgb(0,0,0)', '#12345'])(
		'rejects %s',
		(raw) => {
			expect(parseHexColor(raw)).toBeNull();
		}
	);

	it('falls back to the default with a warning for invalid values', () => {
		const r = resolveTheme('not-a-color');
		expect(r.theme.primary).toBe(DEFAULT_PRIMARY);
		expect(r.warning).toMatch(/not a six-digit hex color/);
		expect(resolveTheme(undefined)).toMatchObject({
			warning: null,
			theme: { primary: DEFAULT_PRIMARY }
		});
		expect(resolveTheme('')).toMatchObject({ warning: null });
	});

	it('keeps the hand-tuned v1.0.0 palette for the default green', () => {
		const t = deriveTheme('#1d7f46');
		expect(t.light.accent).toBe('#1d7f46');
		expect(t.dark.accent).toBe('#4cc982');
	});
});

describe('derived palettes are accessible', () => {
	for (const [name, color] of Object.entries(SAMPLES)) {
		it(`${name} ${color}`, () => {
			const { light, dark } = deriveTheme(color);
			// Accent as text/icons on page, cards and soft tints.
			expect(contrast(light.accent, SURFACES.light.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(light.accent, SURFACES.light.surface)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(light.accent, light.soft)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(dark.accent, SURFACES.dark.bg)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(dark.accent, SURFACES.dark.surface)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(dark.accent, dark.soft)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			// Text on accent buttons, normal and pressed.
			expect(contrast(light.contrast, light.accent)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(light.contrast, light.strong)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(dark.contrast, dark.accent)).toBeGreaterThanOrEqual(MIN_CONTRAST);
			expect(contrast(dark.contrast, dark.strong)).toBeGreaterThanOrEqual(MIN_CONTRAST);
		});
	}

	it('keeps hues recognisable (blue stays blue, orange stays orange)', () => {
		const hue = (hex: string) => {
			const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
			return b > r && b > g ? 'blue' : r > g && r > b ? (g > b ? 'orange' : 'red') : 'green';
		};
		expect(hue(deriveTheme(SAMPLES.blue).light.accent)).toBe('blue');
		expect(hue(deriveTheme(SAMPLES.blue).dark.accent)).toBe('blue');
		expect(hue(deriveTheme(SAMPLES.orange).light.accent)).toBe('orange');
		expect(hue(deriveTheme(SAMPLES.orange).dark.accent)).toBe('orange');
	});

	it('renders CSS for light and dark mode', () => {
		const css = themeCss(deriveTheme(SAMPLES.blue));
		expect(css).toMatch(/^:root:root\{--accent:#[0-9a-f]{6};/);
		expect(css).toContain('@media (prefers-color-scheme: dark)');
	});
});
