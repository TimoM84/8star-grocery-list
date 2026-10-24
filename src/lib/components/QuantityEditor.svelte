<script lang="ts">
	import Icon from './Icon.svelte';
	import { UNITS, quantityStep } from '$lib/shared/quantity';

	let {
		quantity = $bindable(),
		unit = $bindable()
	}: { quantity: number | null; unit: string | null } = $props();

	const step = $derived(quantityStep(unit));
	let text = $state('');

	$effect(() => {
		const formatted = quantity === null ? '' : String(quantity).replace('.', ',');
		if (Number(text.replace(',', '.')) !== quantity || (quantity === null && text !== ''))
			text = formatted;
	});

	function set(n: number | null) {
		quantity = n === null || n <= 0 ? null : Math.round(n * 1000) / 1000;
	}

	function oninput(e: Event & { currentTarget: HTMLInputElement }) {
		text = e.currentTarget.value;
		const n = Number(text.replace(',', '.'));
		if (!text.trim()) quantity = null;
		else if (Number.isFinite(n) && n > 0 && n < 100000) quantity = Math.round(n * 1000) / 1000;
	}
</script>

<fieldset>
	<legend class="mb-2 text-sm font-semibold text-muted">Aantal</legend>
	<div class="flex items-center gap-2">
		<button
			type="button"
			class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 active:bg-surface-3 disabled:opacity-40"
			aria-label="Minder"
			disabled={quantity === null}
			onclick={() => set((quantity ?? 0) - step)}
			data-testid="qty-minus"
		>
			<Icon name="minus" />
		</button>
		<input
			value={text}
			{oninput}
			inputmode="decimal"
			enterkeyhint="done"
			placeholder="—"
			aria-label="Aantal"
			class="h-12 w-0 min-w-0 flex-1 rounded-2xl border border-line bg-bg text-center text-lg font-semibold outline-none focus:border-accent"
			data-testid="qty-input"
		/>
		<button
			type="button"
			class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 active:bg-surface-3"
			aria-label="Meer"
			onclick={() => set((quantity ?? 0) + step)}
			data-testid="qty-plus"
		>
			<Icon name="plus" />
		</button>
		<button
			type="button"
			class="min-h-12 shrink-0 rounded-2xl px-3 text-base font-medium text-muted active:bg-surface-2 disabled:opacity-40"
			disabled={quantity === null && unit === null}
			onclick={() => {
				quantity = null;
				unit = null;
			}}
			data-testid="qty-clear">Wissen</button
		>
	</div>
	<div class="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Eenheid">
		{#each [null, ...UNITS] as u (u ?? 'none')}
			<button
				type="button"
				role="radio"
				aria-checked={unit === u}
				class="min-h-12 min-w-12 rounded-full border px-3.5 text-base font-medium {unit === u
					? 'border-accent bg-accent text-on-accent'
					: 'border-line bg-surface'}"
				onclick={() => (unit = u)}
				data-testid="unit-{u ?? 'none'}"
			>
				{u ?? 'geen'}
			</button>
		{/each}
	</div>
</fieldset>
