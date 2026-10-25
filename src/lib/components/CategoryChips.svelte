<script lang="ts">
	import { app } from '$lib/client/app.svelte';
	import { m } from '$lib/client/i18n';

	let {
		value = $bindable(),
		onchange
	}: { value: string | null; onchange?: (id: string | null) => void } = $props();

	function select(id: string | null) {
		value = id;
		onchange?.(id);
	}
	const categories = $derived(app.view?.categories ?? []);
</script>

<fieldset>
	<legend class="mb-2 text-sm font-semibold text-muted">{m.category.label}</legend>
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.category.label}>
		{#each categories as c (c.id)}
			<button
				type="button"
				role="radio"
				aria-checked={value === c.id}
				class="min-h-12 rounded-full border px-3.5 text-base font-medium {value === c.id
					? 'border-accent bg-accent text-on-accent'
					: 'border-line bg-surface'}"
				onclick={() => select(c.id)}
				data-testid="category-option"
			>
				{c.name}
			</button>
		{/each}
		<button
			type="button"
			role="radio"
			aria-checked={value === null}
			class="min-h-12 rounded-full border px-3.5 text-base font-medium {value === null
				? 'border-accent bg-accent text-on-accent'
				: 'border-line bg-surface'}"
			onclick={() => select(null)}
		>
			{m.category.none}
		</button>
	</div>
</fieldset>
