<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	import { app, type AddPromptData } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { planEntry } from '$lib/shared/planning';
	import { formatQuantity } from '$lib/shared/quantity';

	const open = $derived(ui.isOpen('add-prompt'));
	const data = $derived(ui.data<AddPromptData>('add-prompt'));
	// Recomputed live, so a change from another device is reflected while the sheet is open.
	const plan = $derived(
		open && data && app.view ? planEntry(app.view, data.listId, data.entry) : null
	);
	const listName = $derived(data ? (app.list(data.listId)?.name ?? 'deze lijst') : '');
	const item = $derived(plan?.item);
	const dup = $derived(plan?.duplicate ?? null);
	const elsewhere = $derived(plan?.elsewhere ?? []);

	const title = $derived(
		!plan
			? ''
			: plan.state === 'active'
				? `“${plan.name}” staat er al op`
				: `“${plan.name}” staat op ${elsewhere.map((e) => e.list.name).join(' en ')}`
	);

	function done() {
		ui.closeSheet();
	}

	function extra() {
		if (!item || !dup?.extra) return;
		app.addExtra(item, dup.extra.quantity, dup.extra.unit);
		done();
	}

	function setTo() {
		if (!item || !dup?.set) return;
		app.setQuantity(item, dup.set.quantity, dup.set.unit);
		done();
	}

	function chooseQuantity() {
		if (!item) return;
		const id = item.id;
		ui.closeSheet();
		window.addEventListener(
			'popstate',
			() => setTimeout(() => ui.openSheet('item', { itemId: id })),
			{
				once: true
			}
		);
	}

	function alsoHere() {
		if (!plan || !data) return;
		app.commitAdd(plan, data.listId);
		done();
	}

	function moveHere() {
		if (!plan || !data || !elsewhere[0]) return;
		const moving = elsewhere[0].item;
		app.moveItem(moving, data.listId);
		if (plan.explicit && (plan.quantity !== moving.quantity || plan.unit !== moving.unit))
			app.updateItem(moving, { quantity: plan.quantity, unit: plan.unit });
		done();
	}

	// The situation resolved itself (e.g. ticked off elsewhere): nothing left to decide.
	$effect(() => {
		if (open && data && app.view && plan && plan.state !== 'active' && !plan.elsewhere.length)
			done();
	});
</script>

<Sheet {open} {title} onclose={done} testid="add-prompt">
	{#if plan && data}
		{#if plan.state === 'active' && item}
			<p class="text-lg" data-testid="add-prompt-existing">
				{#if item.quantity !== null}
					Staat er al op: <strong>{formatQuantity(item.quantity, item.unit)}</strong>
				{:else}
					Staat er al op, zonder aantal.
				{/if}
			</p>
			{#if dup?.block === 'incompatible'}
				<p class="mt-2 text-muted">
					Je typte {formatQuantity(data.entry.quantity, data.entry.unit)}. Dat is een andere
					eenheid, dus optellen kan niet.
				</p>
			{:else if dup?.block === 'unknown_existing' && data.entry.quantity === null}
				<p class="mt-2 text-muted">
					Het aantal op de lijst is onbekend, dus er wordt niets opgeteld.
				</p>
			{:else if dup?.block === 'not_countable'}
				<p class="mt-2 text-muted">Typ een hoeveelheid om iets bij te zetten (bijv. “500 g”).</p>
			{/if}
			<div class="mt-5 grid gap-2">
				{#if dup?.extra}
					<button
						type="button"
						class="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-base font-semibold text-on-accent active:bg-accent-strong"
						onclick={extra}
						data-testid="add-prompt-extra"
					>
						<Icon name="plus" size={20} />
						{data.entry.quantity === null
							? 'Eén extra'
							: `${formatQuantity(dup.extra.quantity, dup.extra.unit)} extra`}
					</button>
				{/if}
				{#if dup?.set}
					<button
						type="button"
						class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-base font-semibold active:bg-surface-2"
						onclick={setTo}
						data-testid="add-prompt-set"
					>
						<Icon name="pencil" size={20} /> Wijzigen naar {formatQuantity(
							dup.set.quantity,
							dup.set.unit
						)}
					</button>
				{:else if dup?.block === 'unknown_existing'}
					<button
						type="button"
						class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-base font-semibold active:bg-surface-2"
						onclick={chooseQuantity}
						data-testid="add-prompt-choose"
					>
						<Icon name="pencil" size={20} /> Aantal kiezen
					</button>
				{/if}
				<button
					type="button"
					class="min-h-12 rounded-2xl bg-surface-2 px-4 text-base font-semibold active:bg-surface-3"
					onclick={done}
					data-testid="add-prompt-cancel">Laat zo</button
				>
			</div>
		{:else}
			<p class="text-lg" data-testid="add-prompt-elsewhere">
				{#each elsewhere as e, i (e.item.id)}
					{i ? ' en ' : ''}Op <strong>{e.list.name}</strong>{#if e.item.quantity !== null}
						({formatQuantity(e.item.quantity, e.item.unit)}){/if}
				{/each}. Wat wil je doen?
			</p>
			<div class="mt-5 grid gap-2">
				<button
					type="button"
					class="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-base font-semibold text-on-accent active:bg-accent-strong"
					onclick={alsoHere}
					data-testid="add-prompt-also"
				>
					<Icon name="plus" size={20} /> Ook op {listName} zetten
				</button>
				{#if plan.state === 'new' && elsewhere.length === 1}
					<button
						type="button"
						class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-base font-semibold active:bg-surface-2"
						onclick={moveHere}
						data-testid="add-prompt-move"
					>
						<Icon name="arrowRight" size={20} /> Verplaatsen naar {listName}
					</button>
				{/if}
				<button
					type="button"
					class="min-h-12 rounded-2xl bg-surface-2 px-4 text-base font-semibold active:bg-surface-3"
					onclick={done}
					data-testid="add-prompt-cancel">Annuleren</button
				>
			</div>
		{/if}
	{/if}
</Sheet>
