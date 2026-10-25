<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	import QuantityEditor from './QuantityEditor.svelte';
	import CategoryChips from './CategoryChips.svelte';
	import PhotoField from './PhotoField.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { formatQuantity, quantityStep } from '$lib/shared/quantity';
	import { MAX_NOTE_LENGTH } from '$lib/shared/text';

	const open = $derived(ui.isOpen('item'));
	const itemId = $derived(ui.data<{ itemId: string }>('item')?.itemId ?? null);
	const item = $derived(itemId ? app.item(itemId) : undefined);
	const product = $derived(item ? app.product(item.productId) : undefined);
	const list = $derived(item ? app.list(item.listId) : undefined);
	const grocery = $derived(list?.kind !== 'checklist');
	const active = $derived(item?.status === 'active');
	const claim = $derived(item ? app.claims.get(item.id) : undefined);
	const canClaim = $derived(!!item && grocery && active && (app.inShopping || !!app.round));

	let name = $state('');
	let quantity = $state<number | null>(null);
	let unit = $state<string | null>(null);
	let note = $state('');
	let substituteOk = $state(false);
	let substituteNote = $state('');
	let productNote = $state('');
	let categoryId = $state<string | null>(null);
	let favorite = $state(false);
	let listId = $state('');
	let more = $state(false);
	let partial = $state(false);
	let partialQty = $state(1);
	let loadedFor = $state<string | null>(null);

	// Initialise the draft once per opened item (remote changes don't clobber typing).
	$effect(() => {
		if (!open) {
			loadedFor = null;
			return;
		}
		if (item && product && loadedFor !== item.id) {
			loadedFor = item.id;
			name = product.name;
			quantity = item.quantity;
			unit = item.unit;
			note = item.note ?? '';
			substituteOk = item.substituteOk;
			substituteNote = item.substituteNote ?? '';
			productNote = product.note ?? '';
			categoryId = product.categoryId;
			favorite = product.favorite;
			listId = item.listId;
			more = false;
			partial = false;
		}
	});

	// The item disappeared (deleted on another device) while the sheet was open.
	$effect(() => {
		if (open && loadedFor && !item) ui.closeSheet();
	});

	function save() {
		if (!item || !product) return;
		const ok = app.updateProduct(product, { name, categoryId, favorite, note: productNote });
		if (!ok) return;
		app.updateItem(item, {
			quantity,
			unit,
			note,
			substituteOk,
			substituteNote: substituteOk ? substituteNote : null
		});
		if (listId !== item.listId) app.moveItem(item, listId);
		ui.closeSheet();
	}

	function startPartial() {
		if (!item?.quantity) return;
		const step = quantityStep(item.unit);
		partialQty = Math.max(step, Math.round((item.quantity - step) * 1000) / 1000);
		partial = true;
	}

	function savePartial() {
		if (!item) return;
		app.purchasePartial(item, partialQty);
		ui.closeSheet();
	}

	function unavailable() {
		if (!item) return;
		app.setUnavailable(item, item.unavailableAt === null);
		ui.closeSheet();
	}

	function toggleClaim() {
		if (!item) return;
		if (claim?.deviceId === app.deviceId) app.release(item);
		else app.claim(item);
		ui.closeSheet();
	}

	async function remove() {
		if (!item || !product) return;
		const ok = await ui.confirm({
			title: `“${product.name}” verwijderen?`,
			message: 'Het item verdwijnt van deze lijst. De aankoopgeschiedenis blijft bewaard.',
			confirmLabel: 'Verwijderen',
			danger: true
		});
		if (!ok) return;
		app.deleteItem(item);
		ui.closeSheet();
	}

	const input =
		'h-12 w-full rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
</script>

<Sheet {open} title={product?.name ?? 'Item'} onclose={() => ui.closeSheet()} testid="item-sheet">
	{#if item && product}
		{#if grocery && active}
			<div class="mb-5 flex flex-wrap gap-2" data-testid="item-actions">
				{#if item.quantity !== null && item.quantity > quantityStep(item.unit)}
					<button
						type="button"
						class="flex min-h-12 grow items-center justify-center gap-2 rounded-2xl bg-surface-2 px-3 font-semibold active:bg-surface-3 {partial
							? 'ring-2 ring-accent'
							: ''}"
						aria-expanded={partial}
						onclick={startPartial}
						data-testid="action-partial"
					>
						<Icon name="layers" size={20} /> Deels gehaald
					</button>
				{/if}
				<button
					type="button"
					class="flex min-h-12 grow items-center justify-center gap-2 rounded-2xl bg-surface-2 px-3 font-semibold active:bg-surface-3"
					onclick={unavailable}
					data-testid="action-unavailable"
				>
					<Icon name="ban" size={20} />
					{item.unavailableAt === null ? 'Niet verkrijgbaar' : 'Weer te halen'}
				</button>
				{#if canClaim}
					<button
						type="button"
						class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 px-3 font-semibold active:bg-surface-3"
						onclick={toggleClaim}
						data-testid="action-claim"
					>
						<Icon name="hand" size={20} />
						{#if claim && claim.deviceId !== app.deviceId}
							{claim.deviceName ?? 'Iemand anders'} pakt dit · toch ik
						{:else if claim}
							Niet meer pakken
						{:else}
							Ik pak dit
						{/if}
					</button>
				{/if}
			</div>
			{#if partial && item.quantity !== null}
				<form
					class="mb-6 rounded-2xl border border-accent/40 bg-accent-soft/40 p-3"
					onsubmit={(e) => {
						e.preventDefault();
						savePartial();
					}}
					data-testid="partial-form"
				>
					<p class="mb-2 font-semibold">
						Hoeveel heb je van {formatQuantity(item.quantity, item.unit)}?
					</p>
					<div class="flex items-center gap-2">
						<button
							type="button"
							class="grid h-12 w-12 place-items-center rounded-2xl bg-surface active:bg-surface-2"
							aria-label="Minder"
							onclick={() =>
								(partialQty = Math.max(
									quantityStep(item.unit),
									Math.round((partialQty - quantityStep(item.unit)) * 1000) / 1000
								))}><Icon name="minus" /></button
						>
						<input
							type="number"
							inputmode="decimal"
							min="0"
							step="any"
							bind:value={partialQty}
							aria-label="Gehaald aantal"
							class="h-12 w-0 min-w-0 flex-1 rounded-2xl border border-line bg-bg text-center text-lg font-semibold"
							data-testid="partial-qty"
						/>
						<button
							type="button"
							class="grid h-12 w-12 place-items-center rounded-2xl bg-surface active:bg-surface-2"
							aria-label="Meer"
							onclick={() =>
								(partialQty = Math.round((partialQty + quantityStep(item.unit)) * 1000) / 1000)}
							><Icon name="plus" /></button
						>
					</div>
					<p class="mt-2 text-sm text-muted">
						{#if partialQty > 0 && partialQty < item.quantity}
							{formatQuantity(partialQty, item.unit)} wordt als gekocht bewaard, {formatQuantity(
								Math.round((item.quantity - partialQty) * 1000) / 1000,
								item.unit
							)} blijft op de lijst.
						{:else if partialQty >= item.quantity}
							Alles gehaald: het item wordt afgevinkt.
						{/if}
					</p>
					<button
						type="submit"
						class="mt-3 min-h-12 w-full rounded-2xl bg-accent font-semibold text-on-accent active:bg-accent-strong disabled:opacity-50"
						disabled={!(partialQty > 0)}
						data-testid="partial-save">Opslaan</button
					>
				</form>
			{/if}
		{/if}

		<form
			class="space-y-6"
			onsubmit={(e) => {
				e.preventDefault();
				save();
			}}
		>
			<div>
				<label for="edit-name" class="mb-1.5 block text-sm font-semibold text-muted">Naam</label>
				<input
					id="edit-name"
					bind:value={name}
					maxlength="80"
					enterkeyhint="done"
					class="{input} h-13 text-lg"
					data-testid="edit-name"
				/>
			</div>

			<QuantityEditor bind:quantity bind:unit />

			<div>
				<label for="edit-note" class="mb-1.5 block text-sm font-semibold text-muted"
					>Notitie voor deze keer</label
				>
				<input
					id="edit-note"
					bind:value={note}
					maxlength={MAX_NOTE_LENGTH}
					placeholder="bijv. voor zaterdag"
					class={input}
					data-testid="edit-note"
				/>
				<p class="mt-1 text-sm text-faint">Verdwijnt als het product later opnieuw nodig is.</p>
			</div>

			{#if grocery}
				<div>
					<button
						type="button"
						role="switch"
						aria-checked={substituteOk}
						class="flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 text-left text-base font-semibold {substituteOk
							? 'border-accent/40 bg-accent-soft/50'
							: 'border-line'}"
						onclick={() => (substituteOk = !substituteOk)}
						data-testid="edit-substitute"
					>
						<Icon name="swap" class={substituteOk ? 'text-accent' : 'text-faint'} />
						<span class="flex-1">Ander merk of product mag</span>
						<span class="text-sm text-muted">{substituteOk ? 'Ja' : 'Nee'}</span>
					</button>
					{#if substituteOk}
						<input
							bind:value={substituteNote}
							maxlength={MAX_NOTE_LENGTH}
							placeholder="Toelichting (optioneel), bijv. liefst biologisch"
							aria-label="Toelichting bij ander merk"
							class="{input} mt-2"
							data-testid="edit-substitute-note"
						/>
					{/if}
				</div>
			{/if}

			<button
				type="button"
				class="flex min-h-12 w-full items-center gap-2 rounded-2xl px-1 text-left text-base font-semibold text-muted"
				aria-expanded={more}
				aria-controls="item-more"
				onclick={() => (more = !more)}
				data-testid="edit-more"
			>
				<span class="flex-1">Meer opties</span>
				<span class="text-sm font-normal">vaste notitie, foto, categorie, lijst</span>
				<Icon name={more ? 'chevronUp' : 'chevronDown'} class="text-faint" />
			</button>

			{#if more}
				<div id="item-more" class="space-y-6">
					<div>
						<label for="edit-product-note" class="mb-1.5 block text-sm font-semibold text-muted"
							>Vaste notitie bij product</label
						>
						<input
							id="edit-product-note"
							bind:value={productNote}
							maxlength={MAX_NOTE_LENGTH}
							placeholder="bijv. ongezouten"
							class={input}
							data-testid="edit-product-note"
						/>
						<p class="mt-1 text-sm text-faint">Blijft bewaard, ook bij volgende keren.</p>
					</div>

					<PhotoField {product} />

					<button
						type="button"
						class="flex min-h-12 w-full items-center gap-3 rounded-2xl border px-4 text-left text-base font-semibold {favorite
							? 'border-star/40 bg-star/10 text-ink'
							: 'border-line text-ink'}"
						aria-pressed={favorite}
						onclick={() => (favorite = !favorite)}
						data-testid="edit-favorite"
					>
						<Icon name="star" filled={favorite} class={favorite ? 'text-star' : 'text-faint'} />
						<span class="flex-1">{favorite ? 'Favoriet' : 'Markeer als favoriet'}</span>
					</button>

					<CategoryChips bind:value={categoryId} />

					{#if app.lists.length > 1}
						<fieldset>
							<legend class="mb-2 text-sm font-semibold text-muted">Lijst</legend>
							<div class="flex flex-wrap gap-2">
								{#each app.lists as l (l.id)}
									<button
										type="button"
										class="min-h-12 rounded-full border px-4 text-base font-medium {listId === l.id
											? 'border-accent bg-accent text-on-accent'
											: 'border-line bg-surface'}"
										aria-pressed={listId === l.id}
										onclick={() => (listId = l.id)}
										data-testid="move-list-option"
									>
										{l.name}
									</button>
								{/each}
							</div>
						</fieldset>
					{/if}

					<button
						type="button"
						class="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line px-4 text-base font-semibold"
						onclick={() => {
							const pid = product.id;
							ui.closeSheet();
							window.addEventListener(
								'popstate',
								() => setTimeout(() => ui.openSheet('product', { productId: pid })),
								{ once: true }
							);
						}}
						data-testid="edit-open-product"
					>
						<Icon name="info" size={20} class="text-faint" /> Product, geschiedenis en voorraad
					</button>
				</div>
			{/if}

			<button
				type="button"
				class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-danger/40 px-4 text-base font-semibold text-danger active:bg-danger-soft"
				onclick={remove}
				data-testid="edit-delete"
			>
				<Icon name="trash" size={20} /> Verwijderen van lijst
			</button>
		</form>
	{/if}
	{#snippet footer()}
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="min-h-12 rounded-2xl bg-surface-2 text-base font-semibold active:bg-surface-3"
				onclick={() => ui.closeSheet()}>Annuleren</button
			>
			<button
				type="button"
				class="min-h-12 rounded-2xl bg-accent text-base font-semibold text-on-accent active:bg-accent-strong"
				onclick={save}
				data-testid="edit-save">Opslaan</button
			>
		</div>
	{/snippet}
</Sheet>
