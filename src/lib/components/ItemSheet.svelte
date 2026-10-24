<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	import QuantityEditor from './QuantityEditor.svelte';
	import CategoryChips from './CategoryChips.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';

	const open = $derived(ui.isOpen('item'));
	const itemId = $derived(ui.data<{ itemId: string }>('item')?.itemId ?? null);
	const item = $derived(itemId ? app.item(itemId) : undefined);
	const product = $derived(item ? app.product(item.productId) : undefined);

	let name = $state('');
	let quantity = $state<number | null>(null);
	let unit = $state<string | null>(null);
	let categoryId = $state<string | null>(null);
	let favorite = $state(false);
	let listId = $state('');
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
			categoryId = product.categoryId;
			favorite = product.favorite;
			listId = item.listId;
		}
	});

	// The item disappeared (deleted on another device) while the sheet was open.
	$effect(() => {
		if (open && loadedFor && !item) ui.closeSheet();
	});

	function save() {
		if (!item || !product) return;
		const ok = app.updateProduct(product, { name, categoryId, favorite });
		if (!ok) return;
		app.updateItem(item, { quantity, unit });
		if (listId !== item.listId) app.moveItem(item, listId);
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
</script>

<Sheet {open} title="Item bewerken" onclose={() => ui.closeSheet()} testid="item-sheet">
	{#if item && product}
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
					class="h-13 w-full rounded-2xl border border-line bg-bg px-4 text-lg outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
					data-testid="edit-name"
				/>
			</div>

			<QuantityEditor bind:quantity bind:unit />

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
