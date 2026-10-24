<script lang="ts">
	import Icon from './Icon.svelte';
	import type { ItemView } from '$lib/shared/selectors';
	import { formatQuantity } from '$lib/shared/quantity';

	let {
		view,
		categoryName = null,
		highlight = false,
		ontoggle,
		onedit
	}: {
		view: ItemView;
		categoryName?: string | null;
		highlight?: boolean;
		ontoggle: () => void;
		onedit: () => void;
	} = $props();

	const done = $derived(view.item.status === 'completed');
	const qty = $derived(formatQuantity(view.item.quantity, view.item.unit));
</script>

<div
	class="flex items-stretch overflow-hidden rounded-2xl border border-transparent transition-colors {done
		? 'bg-surface/60'
		: 'bg-surface shadow-card'} {highlight ? 'flash' : ''}"
	data-testid="item-row"
	data-status={view.item.status}
	data-name={view.product.name}
>
	<button
		type="button"
		class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3.5 text-left active:bg-surface-2"
		aria-label={done
			? `${view.product.name} terugzetten op de lijst`
			: `${view.product.name} afvinken`}
		aria-pressed={done}
		onclick={ontoggle}
		data-testid="item-toggle"
	>
		<span
			class="grid h-7 w-7 shrink-0 place-items-center rounded-full border-2 transition-all duration-200 {done
				? 'border-done bg-done text-surface'
				: 'border-faint'}"
		>
			{#if done}<Icon name="check" size={16} stroke={3} />{/if}
		</span>
		<span class="min-w-0 flex-1">
			<span
				class="block text-[1.0625rem] leading-snug font-medium [overflow-wrap:anywhere] {done
					? 'text-done line-through decoration-2'
					: 'text-ink'}"
				data-testid="item-name"
			>
				{view.product.name}
				{#if view.product.favorite && !done}
					<span class="ml-0.5 inline-block align-[-2px] text-star" title="Favoriet">
						<Icon name="star" size={15} filled stroke={1.5} />
						<span class="sr-only">favoriet</span>
					</span>
				{/if}
			</span>
			{#if categoryName && !done}
				<span class="block text-sm leading-tight [overflow-wrap:anywhere] text-faint"
					>{categoryName}</span
				>
			{/if}
		</span>
		{#if qty}
			<span
				class="shrink-0 rounded-full px-2.5 py-1 text-sm font-semibold whitespace-nowrap {done
					? 'text-done'
					: 'bg-accent-soft text-accent'}"
				data-testid="item-qty">{qty}</span
			>
		{/if}
	</button>
	<button
		type="button"
		class="grid w-12 shrink-0 place-items-center text-faint active:bg-surface-2"
		aria-label="{view.product.name} bewerken"
		onclick={onedit}
		data-testid="item-edit"
	>
		<Icon name="pencil" size={20} />
	</button>
</div>
