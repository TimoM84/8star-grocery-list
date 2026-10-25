<script lang="ts">
	import type { SortMode } from '$lib/shared/types';
	import { m } from '$lib/client/i18n';

	let { value, onchange }: { value: SortMode; onchange: (m: SortMode) => void } = $props();

	const options = $derived<{ mode: SortMode; label: string; hint: string }[]>([
		{ mode: 'newest', label: m.sort.newest, hint: m.sort.newestHint },
		{ mode: 'oldest', label: m.sort.oldest, hint: m.sort.oldestHint },
		{ mode: 'az', label: m.sort.az, hint: m.sort.azHint }
	]);
</script>

<div
	role="radiogroup"
	aria-label={m.sort.label}
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
