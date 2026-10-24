<script lang="ts">
	import type { SortMode } from '$lib/shared/types';

	let { value, onchange }: { value: SortMode; onchange: (m: SortMode) => void } = $props();

	const options: { mode: SortMode; label: string; hint: string }[] = [
		{ mode: 'newest', label: 'Nieuwste ↓', hint: 'Laatst toegevoegd bovenaan' },
		{ mode: 'oldest', label: 'Oudste ↑', hint: 'Eerst toegevoegd bovenaan' },
		{ mode: 'az', label: 'A–Z', hint: 'Alfabetisch' }
	];
</script>

<div
	role="radiogroup"
	aria-label="Sortering"
	class="grid grid-cols-3 gap-1 rounded-2xl bg-surface-2 p-1"
	data-testid="sort-control"
>
	{#each options as o (o.mode)}
		<button
			type="button"
			role="radio"
			aria-checked={value === o.mode}
			title={o.hint}
			class="min-h-12 min-w-0 rounded-xl px-1 py-1 text-[min(0.95rem,4.3vw)] leading-tight font-semibold transition-colors duration-150 {value ===
			o.mode
				? 'bg-surface text-ink shadow-card'
				: 'text-muted active:bg-surface-3'}"
			data-testid="sort-{o.mode}"
			onclick={() => onchange(o.mode)}
		>
			{o.label}
		</button>
	{/each}
</div>
