<script lang="ts">
	import Icon from './Icon.svelte';
	import QuantityEditor from './QuantityEditor.svelte';
	import PhotoField from './PhotoField.svelte';
	import StockControl from './StockControl.svelte';
	import type { Product } from '$lib/shared/types';
	import { app } from '$lib/client/app.svelte';
	import { m, qty as formatQty } from '$lib/client/i18n';
	import { MAX_NOTE_LENGTH } from '$lib/shared/text';
	import { formatDate } from '$lib/client/format';

	let { product }: { product: Product } = $props();

	let editingQty = $state(false);
	let qty = $state<number | null>(null);
	let unit = $state<string | null>(null);
	let alias = $state('');
	let note = $state('');
	let noteFor = $state<string | null>(null);

	$effect(() => {
		if (noteFor !== product.id) {
			noteFor = product.id;
			note = product.note ?? '';
			editingQty = false;
			alias = '';
		}
	});

	const aliases = $derived(app.aliasesFor(product.id));
	const snoozedUntil = $derived(app.snoozed[product.id] ?? 0);
	const target = $derived(app.targetList(product));
	const onTarget = $derived(app.itemFor(product.id, target)?.status === 'active');

	function saveQty() {
		app.updateProduct(product, { defaultQuantity: qty, defaultUnit: qty === null ? null : unit });
		editingQty = false;
	}

	function addAlias(e: Event) {
		e.preventDefault();
		if (app.addAlias(product, alias)) alias = '';
	}

	const label = 'mb-2 block text-sm font-semibold text-muted';
</script>

<section class="space-y-6" aria-label={m.memory.label} data-testid="product-memory">
	<div>
		<h3 class={label}>{m.memory.stock}</h3>
		<StockControl {product} />
		{#if product.stockStatus === 'low' || product.stockStatus === 'out'}
			<button
				type="button"
				class="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line font-semibold active:bg-surface-2 disabled:opacity-60"
				disabled={onTarget}
				onclick={() => app.addProduct(product, target)}
				data-testid="stock-to-list"
			>
				<Icon name={onTarget ? 'check' : 'plus'} size={20} class="text-accent" />
				{onTarget
					? m.memory.isOn(app.list(target)?.name ?? m.productRow.theList)
					: m.memory.putOn(app.list(target)?.name ?? m.productRow.theList)}
			</button>
		{/if}
		<p class="mt-1 text-sm text-faint">
			{m.memory.stockHelp}
		</p>
	</div>

	<div>
		<h3 class={label}>{m.memory.usual}</h3>
		{#if editingQty}
			<QuantityEditor bind:quantity={qty} bind:unit />
			<button
				type="button"
				class="mt-3 min-h-12 w-full rounded-2xl bg-accent font-semibold text-on-accent"
				onclick={saveQty}
				data-testid="default-qty-save">{m.common.save}</button
			>
		{:else}
			<button
				type="button"
				class="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line px-4 text-left"
				onclick={() => {
					qty = product.defaultQuantity;
					unit = product.defaultUnit;
					editingQty = true;
				}}
				data-testid="default-qty"
			>
				<span class="flex-1 font-semibold"
					>{product.defaultQuantity !== null
						? formatQty(product.defaultQuantity, product.defaultUnit)
						: m.memory.notSet}</span
				>
				<Icon name="pencil" size={18} class="text-faint" />
			</button>
			<p class="mt-1 text-sm text-faint">
				{m.memory.usualHelp}
			</p>
		{/if}
	</div>

	{#if app.groceryLists.length > 1}
		<fieldset>
			<legend class={label}>{m.memory.preferred}</legend>
			<div class="flex flex-wrap gap-2">
				{#each [{ id: null, name: m.memory.noPreferred }, ...app.groceryLists] as l (l.id ?? 'none')}
					<button
						type="button"
						aria-pressed={product.preferredListId === l.id}
						class="min-h-12 rounded-full border px-4 text-base font-medium {product.preferredListId ===
						l.id
							? 'border-accent bg-accent text-on-accent'
							: 'border-line bg-surface'}"
						onclick={() => app.updateProduct(product, { preferredListId: l.id })}
						data-testid="preferred-list-option">{l.name}</button
					>
				{/each}
			</div>
			<p class="mt-1 text-sm text-faint">{m.memory.preferredHelp}</p>
		</fieldset>
	{/if}

	<div>
		<label for="product-note" class={label}>{m.memory.note}</label>
		<input
			id="product-note"
			bind:value={note}
			maxlength={MAX_NOTE_LENGTH}
			placeholder={m.itemSheet.productNotePlaceholder}
			onchange={() => app.updateProduct(product, { note })}
			class="h-12 w-full rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent"
			data-testid="product-note"
		/>
		<p class="mt-1 text-sm text-faint">{m.memory.noteHelp}</p>
	</div>

	<div>
		<h3 class={label}>{m.memory.aliases}</h3>
		{#if aliases.length}
			<ul class="mb-2 flex flex-wrap gap-2" data-testid="alias-list">
				{#each aliases as a (a.id)}
					<li class="flex items-center rounded-full bg-surface-2 pl-3.5">
						<span class="py-2">{a.alias}</span>
						<button
							type="button"
							class="grid h-12 w-11 place-items-center text-faint"
							aria-label={m.memory.removeAlias(a.alias)}
							onclick={() => app.removeAlias(a.id)}><Icon name="x" size={18} /></button
						>
					</li>
				{/each}
			</ul>
		{/if}
		<form class="flex gap-2" onsubmit={addAlias}>
			<input
				bind:value={alias}
				maxlength="80"
				placeholder={m.memory.aliasPlaceholder}
				aria-label={m.memory.addAlias}
				class="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent"
				data-testid="alias-input"
			/>
			<button
				type="submit"
				class="min-h-12 rounded-2xl bg-surface-2 px-4 font-semibold active:bg-surface-3"
				data-testid="alias-add">{m.common.add}</button
			>
		</form>
		<p class="mt-1 text-sm text-faint">
			{m.memory.aliasHelp}
		</p>
	</div>

	<PhotoField {product} />

	{#if snoozedUntil > app.now}
		<div
			class="flex items-center gap-2 rounded-2xl bg-surface-2 py-1 pr-1 pl-4"
			data-testid="snooze-info"
		>
			<span class="min-w-0 flex-1 py-2 text-sm"
				>{m.memory.snoozedUntil(formatDate(snoozedUntil, app.now))}</span
			>
			<button
				type="button"
				class="min-h-12 rounded-xl px-3 text-sm font-semibold text-accent"
				onclick={() => app.unsnooze(product)}>{m.memory.unsnooze}</button
			>
		</div>
	{/if}
</section>
