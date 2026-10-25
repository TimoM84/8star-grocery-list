<script lang="ts">
	import Icon from './Icon.svelte';
	import QuantityEditor from './QuantityEditor.svelte';
	import PhotoField from './PhotoField.svelte';
	import StockControl from './StockControl.svelte';
	import type { Product } from '$lib/shared/types';
	import { app } from '$lib/client/app.svelte';
	import { formatQuantity } from '$lib/shared/quantity';
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

<section class="space-y-6" aria-label="Productgeheugen" data-testid="product-memory">
	<div>
		<h3 class={label}>Voorraad</h3>
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
					? `Staat op ${app.list(target)?.name}`
					: `Op ${app.list(target)?.name ?? 'de lijst'}`}
			</button>
		{/if}
		<p class="mt-1 text-sm text-faint">
			Alleen wat jullie zelf aangeven. Er wordt nooit iets automatisch op de lijst gezet.
		</p>
	</div>

	<div>
		<h3 class={label}>Gebruikelijk aantal</h3>
		{#if editingQty}
			<QuantityEditor bind:quantity={qty} bind:unit />
			<button
				type="button"
				class="mt-3 min-h-12 w-full rounded-2xl bg-accent font-semibold text-on-accent"
				onclick={saveQty}
				data-testid="default-qty-save">Opslaan</button
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
						? formatQuantity(product.defaultQuantity, product.defaultUnit)
						: 'Niet ingesteld'}</span
				>
				<Icon name="pencil" size={18} class="text-faint" />
			</button>
			<p class="mt-1 text-sm text-faint">
				Gebruikt als je het toevoegt zonder aantal. Een getypt aantal gaat altijd voor.
			</p>
		{/if}
	</div>

	{#if app.groceryLists.length > 1}
		<fieldset>
			<legend class={label}>Hoort meestal op</legend>
			<div class="flex flex-wrap gap-2">
				{#each [{ id: null, name: 'Geen vaste lijst' }, ...app.groceryLists] as l (l.id ?? 'none')}
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
			<p class="mt-1 text-sm text-faint">Bepaalt op welke lijst het wordt voorgesteld.</p>
		</fieldset>
	{/if}

	<div>
		<label for="product-note" class={label}>Vaste notitie</label>
		<input
			id="product-note"
			bind:value={note}
			maxlength={MAX_NOTE_LENGTH}
			placeholder="bijv. ongezouten"
			onchange={() => app.updateProduct(product, { note })}
			class="h-12 w-full rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent"
			data-testid="product-note"
		/>
		<p class="mt-1 text-sm text-faint">Blijft bij het product, ook bij volgende keren.</p>
	</div>

	<div>
		<h3 class={label}>Andere namen</h3>
		{#if aliases.length}
			<ul class="mb-2 flex flex-wrap gap-2" data-testid="alias-list">
				{#each aliases as a (a.id)}
					<li class="flex items-center rounded-full bg-surface-2 pl-3.5">
						<span class="py-2">{a.alias}</span>
						<button
							type="button"
							class="grid h-12 w-11 place-items-center text-faint"
							aria-label="Andere naam {a.alias} verwijderen"
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
				placeholder="bijv. halfvolle melk"
				aria-label="Andere naam toevoegen"
				class="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent"
				data-testid="alias-input"
			/>
			<button
				type="submit"
				class="min-h-12 rounded-2xl bg-surface-2 px-4 font-semibold active:bg-surface-3"
				data-testid="alias-add">Toevoegen</button
			>
		</form>
		<p class="mt-1 text-sm text-faint">
			Typen of plakken van deze naam vindt dit product. Producten worden nooit automatisch
			samengevoegd.
		</p>
	</div>

	<PhotoField {product} />

	{#if snoozedUntil > app.now}
		<div
			class="flex items-center gap-2 rounded-2xl bg-surface-2 py-1 pr-1 pl-4"
			data-testid="snooze-info"
		>
			<span class="min-w-0 flex-1 py-2 text-sm"
				>Niet voorstellen tot {formatDate(snoozedUntil, app.now)}</span
			>
			<button
				type="button"
				class="min-h-12 rounded-xl px-3 text-sm font-semibold text-accent"
				onclick={() => app.unsnooze(product)}>Weer voorstellen</button
			>
		</div>
	{/if}
</section>
