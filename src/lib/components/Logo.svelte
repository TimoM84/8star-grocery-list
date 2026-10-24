<script lang="ts">
	let { size = 32 }: { size?: number } = $props();
</script>

<svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" class="shrink-0">
	<rect width="64" height="64" rx="16" fill="var(--accent)" />
	<path
		d="M32 8L38.7 15.83L48.97 15.03L48.17 25.3L56 32L48.17 38.7L48.97 48.97L38.7 48.17L32 56L25.3 48.17L15.03 48.97L15.83 38.7L8 32L15.83 25.3L15.03 15.03L25.3 15.83Z"
		fill="var(--accent-contrast)"
	/>
	<path
		d="M24.5 32.5l5 5L40 27"
		fill="none"
		stroke="var(--accent)"
		stroke-width="4.2"
		stroke-linecap="round"
		stroke-linejoin="round"
	/>
</svg>
