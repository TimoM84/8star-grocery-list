<script lang="ts">
	import type { Product, StockStatus } from '$lib/shared/types';
	import { app } from '$lib/client/app.svelte';
	import { stockIsStale } from '$lib/shared/planning';
	import { timeAgo } from '$lib/client/format';
	import { m } from '$lib/client/i18n';

	let { product, compact = false }: { product: Product; compact?: boolean } = $props();

	const OPTIONS = $derived<{ id: StockStatus; label: string }[]>([
		{ id: 'enough', label: m.stock.enough },
		{ id: 'low', label: m.stock.low },
		{ id: 'out', label: m.stock.out },
		{ id: 'unknown', label: m.stock.unknown }
	]);
	const stale = $derived(stockIsStale(product, app.now));
</script>

<div data-testid="stock-control">
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.stock.label(product.name)}>
		{#each OPTIONS as o (o.id)}
			<button
				type="button"
				role="radio"
				aria-checked={product.stockStatus === o.id}
				class="min-h-12 rounded-full border px-3.5 text-base font-medium {product.stockStatus ===
				o.id
					? o.id === 'out'
						? 'border-danger bg-danger text-white dark:text-black'
						: o.id === 'low'
							? 'border-warn bg-warn text-white dark:text-black'
							: 'border-accent bg-accent text-on-accent'
					: 'border-line bg-surface'}"
				onclick={() => app.setStock(product, o.id)}
				data-testid="stock-{o.id}">{o.label}</button
			>
		{/each}
	</div>
	{#if !compact && product.stockUpdatedAt && product.stockStatus !== 'unknown'}
		<p class="mt-1 text-sm {stale ? 'text-warn' : 'text-faint'}" data-testid="stock-age">
			{m.stock.updated(timeAgo(product.stockUpdatedAt, app.now))}{stale ? m.stock.stale : ''}
		</p>
	{/if}
</div>
