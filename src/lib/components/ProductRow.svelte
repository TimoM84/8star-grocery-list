<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { ProductView } from '$lib/shared/selectors';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';

	let {
		view,
		detail,
		extra,
		listId
	}: { view: ProductView; detail?: string; extra?: Snippet; listId?: string } = $props();
	/** Target list for the quick add (defaults to the current list). */
	const target = $derived(listId ?? app.listId);
	const onList = $derived(
		listId ? app.itemFor(view.product.id, listId)?.status === 'active' : view.status === 'active'
	);
	const targetName = $derived(listId && listId !== app.listId ? app.list(listId)?.name : null);
</script>

<div
	class="flex items-stretch overflow-hidden rounded-2xl bg-surface shadow-card"
	data-testid="product-row"
	data-name={view.product.name}
>
	<button
		type="button"
		class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-4 text-left active:bg-surface-2"
		onclick={() => ui.openSheet('product', { productId: view.product.id })}
		data-testid="product-open"
	>
		<span class="min-w-0 flex-1">
			<span class="block text-[1.0625rem] leading-snug font-medium [overflow-wrap:anywhere]">
				{view.product.name}
				{#if view.product.favorite}
					<span class="ml-0.5 inline-block align-[-2px] text-star"
						><Icon name="star" size={15} filled stroke={1.5} /><span class="sr-only">favoriet</span
						></span
					>
				{/if}
			</span>
			{#if detail}<span class="block text-sm leading-tight [overflow-wrap:anywhere] text-muted"
					>{detail}</span
				>{/if}
		</span>
	</button>
	{@render extra?.()}
	<button
		type="button"
		class="grid w-14 shrink-0 place-items-center {onList
			? 'text-accent'
			: 'bg-accent-soft text-accent active:bg-accent/20'}"
		aria-label={onList
			? `${view.product.name} staat op ${targetName ?? 'de lijst'}`
			: `${view.product.name} op ${targetName ?? 'de lijst'} zetten`}
		disabled={onList}
		onclick={() => app.addProduct(view.product, target)}
		data-testid="product-quick-add"
	>
		<Icon name={onList ? 'check' : 'plus'} size={24} stroke={2.5} />
	</button>
</div>
