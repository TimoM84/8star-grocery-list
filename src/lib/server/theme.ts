/** Global accent color read at runtime from Dockhand / Docker Compose. */
const DEFAULT = '#1D7F46';
const HEX = /^#[\da-fA-F]{6}$/;

function rgb(value: string): number[] {
	return [1, 3, 5].map((i) => Number.parseInt(value.slice(i, i + 2), 16));
}

function mix(a: string, b: string, amount: number): string {
	const x = rgb(a);
	const y = rgb(b);
	return (
		'#' +
		x
			.map((v, i) =>
				Math.round(v * (1 - amount) + y[i] * amount)
					.toString(16)
					.padStart(2, '0')
			)
			.join('')
	);
}

function luminance(color: string): number {
	const [r, g, b] = rgb(color).map((v) => {
		const c = v / 255;
		return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	});
	return r * 0.2126 + g * 0.7152 + b * 0.0722;
}

function ratio(a: string, b: string): number {
	const x = luminance(a);
	const y = luminance(b);
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function accessible(base: string, background: string): string {
	let result = base;
	const target = ratio('#ffffff', background) > ratio('#000000', background) ? '#ffffff' : '#000000';
	for (let i = 0; i < 40 && ratio(result, background) < 4.5; i++) {
		result = mix(result, target, 0.12);
	}
	return result;
}

function palette(color: string, background: string, surface: string) {
	const accent = accessible(color, background);
	const contrast = ratio(accent, '#ffffff') >= 4.5 ? '#ffffff' : '#000000';
	return {
		accent,
		strong: accessible(mix(accent, contrast === '#ffffff' ? '#000000' : '#ffffff', 0.15), background),
		contrast,
		soft: mix(accent, surface, 0.86)
	};
}

export function readTheme(value: string | undefined = process.env.APP_PRIMARY_COLOR) {
	const raw = value?.trim() || DEFAULT;
	if (!HEX.test(raw)) console.warn('[8star] Invalid APP_PRIMARY_COLOR; using ' + DEFAULT);
	const primary = HEX.test(raw) ? raw.toUpperCase() : DEFAULT;
	return {
		primary,
		light: palette(primary, '#ffffff', '#ffffff'),
		dark: palette(primary, '#151a16', '#151a16')
	};
}
