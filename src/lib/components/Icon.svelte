<script lang="ts" module>
	const PATHS = {
		plus: 'M12 5v14M5 12h14',
		check: 'M5 12.5l4.5 4.5L19 7.5',
		pencil: 'M4 20h4L18.5 9.5a2.1 2.1 0 0 0-4-4L4 16v4zM13.5 6.5l4 4',
		star: 'M12 3.5l2.6 5.3 5.9.9-4.25 4.1 1 5.85L12 16.9l-5.25 2.75 1-5.85L3.5 9.7l5.9-.9z',
		trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3',
		list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
		sparkles:
			'M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z',
		history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3.5 2',
		settings: 'M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1M15 4v4M9 10v4M17 16v4',
		chevronDown: 'M6 9l6 6 6-6',
		chevronUp: 'M6 15l6-6 6 6',
		arrowUp: 'M12 19V5M6 11l6-6 6 6',
		arrowDown: 'M12 5v14M6 13l6 6 6-6',
		arrowRight: 'M5 12h14M13 6l6 6-6 6',
		x: 'M6 6l12 12M18 6L6 18',
		undo: 'M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
		search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
		download: 'M12 4v11M7 10l5 5 5-5M5 20h14',
		upload: 'M12 16V5M7 10l5-5 5 5M5 20h14',
		brain:
			'M9 4a3 3 0 0 0-3 3v.2A3 3 0 0 0 4 10a3 3 0 0 0 1 2.2A3.5 3.5 0 0 0 8.5 18H9V4zM15 4a3 3 0 0 1 3 3v.2a3 3 0 0 1 2 2.8 3 3 0 0 1-1 2.2 3.5 3.5 0 0 1-3.5 5.8H15V4zM9 18v2M15 18v2',
		refresh: 'M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4',
		cloudOff:
			'M3 3l18 18M8.5 8.6A4.5 4.5 0 0 0 7 17h10M20.5 15.5A3.5 3.5 0 0 0 17 11h-.3A5.5 5.5 0 0 0 10.6 6.3',
		tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
		minus: 'M5 12h14',
		database:
			'M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
		info: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01',
		camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
		cart: 'M3 4h2l2.4 11h10.2L20 7H6.2M9 20h.01M17 20h.01',
		more: 'M5 12h.01M12 12h.01M19 12h.01',
		hand: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V11M11 10V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-.5a6 6 0 0 1-4.6-2.2L3.5 15a1.5 1.5 0 0 1 2.3-2l2.2 2',
		ban: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM5.6 5.6l12.8 12.8',
		note: 'M5 4h14v11l-5 5H5zM14 20v-5h5M8 9h8M8 13h4',
		box: 'M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10',
		users:
			'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14a6 6 0 0 1 3.5 6',
		layers: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
		swap: 'M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
		paste: 'M9 4h6v3H9zM7 5H5v16h14V5h-2M8 12h8M8 16h5'
	} as const;
	export type IconName = keyof typeof PATHS;
</script>

<script lang="ts">
	let {
		name,
		size = 24,
		filled = false,
		class: klass = '',
		stroke = 2
	}: {
		name: IconName;
		size?: number;
		filled?: boolean;
		class?: string;
		stroke?: number;
	} = $props();
</script>

<svg
	class={klass}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={filled ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	focusable="false"
>
	<path d={PATHS[name]} />
</svg>
