<script lang="ts">
	import Sheet from './Sheet.svelte';
	import CheckToggle from './CheckToggle.svelte';
	import Icon from './Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { planEntry, scaleBundle } from '$lib/shared/planning';
	import { formatQuantity } from '$lib/shared/quantity';

	const open = $derived(ui.isOpen('bundle-add'));
	const bundleId = $derived(ui.data<{ bundleId: string }>('bundle-add')?.bundleId ?? null);
	const bundle = $derived(bundleId ? app.bundles.find((b) => b.id === bundleId) : undefined);

	let servings = $state<number | null>(null);
	let listId = $state('');
	/** Lines unchecked because they are in the house already. */
	let skipped = $state<Record<string, boolean>>({});
	let choices = $state<Record<string, 'skip' | 'extra' | 'set'>>({});
	let busy = $state(false);
	let loadedFor = $state<string | null>(null);

	$effect(() => {
		if (!open) {
			loadedFor = null;
			return;
		}
		if (!bundle || loadedFor === bundle.id) return;
		loadedFor = bundle.id;
		servings = bundle.servings;
		listId =
			app.currentList?.kind === 'checklist' ? (app.groceryLists[0]?.id ?? app.listId) : app.listId;
		skipped = {};
		choices = {};
		busy = false;
	});

	const factor = $derived(
		bundle?.servings && servings ? Math.round((servings / bundle.servings) * 100) / 100 : 1
	);
	const rows = $derived(
		bundle && app.view
			? scaleBundle(bundle, servings).map((l) => {
					const product = app.product(l.productId);
					const name = product?.name ?? 'Onbekend product';
					const plan = planEntry(app.view!, listId, { name, quantity: l.quantity, unit: l.unit });
					return { line: l, name, plan };
				})
			: []
	);
	const chosen = $derived(
		rows.filter(
			(r) =>
				!skipped[r.line.lineId] &&
				(r.plan?.state !== 'active' || (choices[r.line.lineId] ?? 'skip') !== 'skip')
		)
	);

	function submit() {
		if (busy || !chosen.length) return;
		busy = true;
		const ok = app.addMany(
			listId,
			chosen.map((r) => {
				const active = r.plan?.state === 'active';
				const choice = choices[r.line.lineId] ?? 'skip';
				const extra = active && choice === 'extra' ? r.plan?.duplicate?.extra : null;
				return {
					name: r.name,
					quantity: extra ? extra.quantity : r.line.quantity,
					unit: extra ? extra.unit : r.line.unit,
					categoryId: null,
					note: r.line.note,
					action: active ? (choice as 'extra' | 'set') : 'add'
				};
			})
		);
		if (ok) {
			if (listId !== app.listId) app.selectList(listId);
			ui.closeSheet();
		} else busy = false;
	}
</script>

<Sheet
	{open}
	title={bundle ? `${bundle.name} toevoegen` : 'Bundel'}
	onclose={() => ui.closeSheet()}
	testid="bundle-add-sheet"
>
	{#if bundle}
		{#if bundle.servings}
			<div class="mb-4 flex items-center gap-3">
				<span class="flex-1 font-semibold">Personen</span>
				<button
					type="button"
					class="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2 disabled:opacity-40"
					aria-label="Minder personen"
					disabled={(servings ?? 1) <= 1}
					onclick={() => (servings = Math.max(1, (servings ?? 1) - 1))}
					><Icon name="minus" /></button
				>
				<span class="w-10 text-center text-xl font-bold" data-testid="bundle-servings-value"
					>{servings}</span
				>
				<button
					type="button"
					class="grid h-12 w-12 place-items-center rounded-2xl bg-surface-2"
					aria-label="Meer personen"
					onclick={() => (servings = Math.min(50, (servings ?? 1) + 1))}
					data-testid="bundle-servings-plus"><Icon name="plus" /></button
				>
			</div>
			{#if factor !== 1}
				<p class="-mt-2 mb-4 text-sm text-muted">
					Hoeveelheden × {String(factor).replace('.', ',')} (recept voor {bundle.servings}).
				</p>
			{/if}
		{/if}

		{#if app.groceryLists.length > 1}
			<fieldset class="mb-4">
				<legend class="mb-2 text-sm font-semibold text-muted">Toevoegen aan</legend>
				<div class="flex flex-wrap gap-2">
					{#each app.lists as l (l.id)}
						<button
							type="button"
							class="min-h-12 rounded-full border px-4 text-base font-medium {listId === l.id
								? 'border-accent bg-accent text-on-accent'
								: 'border-line bg-surface'}"
							aria-pressed={listId === l.id}
							onclick={() => (listId = l.id)}>{l.name}</button
						>
					{/each}
				</div>
			</fieldset>
		{/if}

		<p class="mb-2 text-sm text-muted">Vink uit wat je al in huis hebt.</p>
		<ul class="space-y-2" data-testid="bundle-add-lines">
			{#each rows as r (r.line.lineId)}
				{@const id = r.line.lineId}
				{@const dup = r.plan?.duplicate}
				<li
					class="rounded-2xl border border-line p-2 {skipped[id] ? 'opacity-60' : ''}"
					data-testid="bundle-add-line"
				>
					<div class="flex min-h-12 items-center gap-2">
						<CheckToggle
							checked={!skipped[id]}
							label="{r.name} toevoegen"
							onchange={(v) => (skipped = { ...skipped, [id]: !v })}
							testid="bundle-add-include"
						/>
						<span class="min-w-0 flex-1 font-medium [overflow-wrap:anywhere]">{r.name}</span>
						{#if r.line.quantity !== null}
							<span
								class="shrink-0 rounded-full bg-accent-soft px-2.5 py-0.5 text-sm font-semibold text-accent"
								>{formatQuantity(r.line.quantity, r.line.unit)}</span
							>
						{/if}
					</div>
					{#if r.line.exact !== null && !skipped[id]}
						<p class="pl-14 text-sm text-warn" data-testid="bundle-rounded">
							Precies {String(r.line.exact).replace('.', ',')}: afgerond naar boven, controleer
							even.
						</p>
					{/if}
					{#if r.plan?.state === 'active' && !skipped[id]}
						<p class="pl-14 text-sm text-muted">
							Staat er al op{r.plan.item?.quantity != null
								? `: ${formatQuantity(r.plan.item.quantity, r.plan.item.unit)}`
								: ''}
						</p>
						<div class="mt-1 flex flex-wrap gap-2 pl-14">
							{#each [{ id: 'skip', label: 'Laat zo', show: true }, { id: 'extra', label: dup?.extra ? `${formatQuantity(dup.extra.quantity, dup.extra.unit)} extra` : '', show: !!dup?.extra }, { id: 'set', label: dup?.set ? `Wijzigen naar ${formatQuantity(dup.set.quantity, dup.set.unit)}` : '', show: !!dup?.set }] as opt (opt.id)}
								{#if opt.show}
									<button
										type="button"
										aria-pressed={(choices[id] ?? 'skip') === opt.id}
										class="min-h-12 rounded-full border px-3 text-sm font-semibold {(choices[id] ??
											'skip') === opt.id
											? 'border-accent bg-accent text-on-accent'
											: 'border-line bg-surface'}"
										onclick={() =>
											(choices = { ...choices, [id]: opt.id as 'skip' | 'extra' | 'set' })}
										data-testid="bundle-choice-{opt.id}">{opt.label}</button
									>
								{/if}
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	{/if}
	{#snippet footer()}
		<button
			type="button"
			class="min-h-12 w-full rounded-2xl bg-accent text-base font-semibold text-on-accent active:bg-accent-strong disabled:opacity-50"
			disabled={busy || !chosen.length}
			onclick={submit}
			data-testid="bundle-add-submit"
		>
			{chosen.length === 1 ? '1 product verwerken' : `${chosen.length} producten verwerken`}
		</button>
	{/snippet}
</Sheet>
