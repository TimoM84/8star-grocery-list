<script lang="ts">
	import Icon from './Icon.svelte';
	import type { ItemView } from '$lib/shared/selectors';
	import type { Claim } from '$lib/shared/types';
	import { m, qty as formatQty } from '$lib/client/i18n';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';

	let {
		view,
		categoryName = null,
		highlight = false,
		isNew = false,
		claim = null,
		shopping = false,
		ontoggle,
		onedit
	}: {
		view: ItemView;
		categoryName?: string | null;
		highlight?: boolean;
		/** Added since the round/winkelstand started ("Net toegevoegd"). */
		isNew?: boolean;
		claim?: Claim | null;
		/** Winkelstand: the side button opens the actions instead of the editor. */
		shopping?: boolean;
		ontoggle: () => void;
		onedit: () => void;
	} = $props();

	const item = $derived(view.item);
	const product = $derived(view.product);
	const done = $derived(item.status === 'completed');
	const unavailable = $derived(!done && item.unavailableAt !== null);
	const qty = $derived(formatQty(item.quantity, item.unit));
	const bought = $derived(
		!done && item.purchasedQuantity ? formatQty(item.purchasedQuantity, item.unit) : ''
	);
	const claimLabel = $derived(
		!claim || done
			? ''
			: claim.deviceId === app.deviceId
				? m.itemRow.you
				: m.itemRow.claimedBy(claim.deviceName ?? m.common.someoneElse)
	);
	const photo = $derived(product.photoId ? app.photoUrl(product.photoId) : null);
</script>

<div
	class="flex items-stretch overflow-hidden rounded-2xl border transition-colors {done
		? 'border-transparent bg-surface/60'
		: unavailable
			? 'border-dashed border-warn/50 bg-surface/80'
			: 'border-transparent bg-surface shadow-card'} {highlight ? 'flash' : ''}"
	data-testid="item-row"
	data-status={unavailable ? 'unavailable' : item.status}
	data-name={product.name}
>
	<button
		type="button"
		class="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pr-2 pl-3.5 text-left active:bg-surface-2"
		aria-label={done ? m.itemRow.putBack(product.name) : m.itemRow.tick(product.name)}
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
				{product.name}
				{#if product.favorite && !done}
					<span class="ml-0.5 inline-block align-[-2px] text-star" title={m.common.favorite}>
						<Icon name="star" size={15} filled stroke={1.5} />
						<span class="sr-only">{m.common.favoriteSr}</span>
					</span>
				{/if}
				{#if isNew && !done}
					<span
						class="ml-1 inline-block rounded-full bg-accent px-2 py-px align-[2px] text-xs font-bold text-on-accent"
						data-testid="item-new">{m.itemRow.isNew}</span
					>
				{/if}
			</span>
			{#if !done}
				{#if item.note || product.note}
					<span
						class="block text-sm leading-snug [overflow-wrap:anywhere] text-muted"
						data-testid="item-note"
					>
						{[item.note, product.note].filter(Boolean).join(' · ')}
					</span>
				{/if}
				{#if item.substituteOk || bought || claimLabel || unavailable}
					<span class="mt-0.5 flex flex-wrap gap-1 text-sm leading-tight">
						{#if unavailable}
							<span class="font-semibold text-warn">{m.itemRow.unavailable}</span>
						{/if}
						{#if bought}
							<span class="font-semibold text-accent" data-testid="item-bought"
								>{m.itemRow.bought(bought)}</span
							>
						{/if}
						{#if item.substituteOk}
							<span class="text-muted" data-testid="item-substitute"
								>{m.itemRow.substitute}{item.substituteNote ? `: ${item.substituteNote}` : ''}</span
							>
						{/if}
						{#if claimLabel}
							<span class="font-semibold text-accent" data-testid="item-claim">{claimLabel}</span>
						{/if}
					</span>
				{/if}
				{#if categoryName}
					<span class="block text-sm leading-tight [overflow-wrap:anywhere] text-faint"
						>{categoryName}</span
					>
				{/if}
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
	{#if photo && !done}
		<button
			type="button"
			class="grid w-12 shrink-0 place-items-center active:bg-surface-2"
			aria-label={m.itemRow.viewPhoto(product.name)}
			onclick={() => ui.openSheet('photo', { productId: product.id })}
			data-testid="item-photo"
		>
			<img src={photo} alt="" class="h-9 w-9 rounded-lg object-cover" loading="lazy" />
		</button>
	{/if}
	<button
		type="button"
		class="grid w-12 shrink-0 place-items-center text-faint active:bg-surface-2"
		aria-label={shopping ? m.itemRow.moreActions(product.name) : m.itemRow.edit(product.name)}
		onclick={onedit}
		data-testid="item-edit"
	>
		<Icon name={shopping ? 'more' : 'pencil'} size={20} stroke={shopping ? 3 : 2} />
	</button>
</div>
