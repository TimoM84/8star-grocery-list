<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	import CategoryChips from './CategoryChips.svelte';
	import ProductMemory from './ProductMemory.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { computeStats, MIN_HISTORY } from '$lib/shared/stats';
	import {
		formatDate,
		formatDateTime,
		formatInterval,
		formatPerMonth,
		relativeDay
	} from '$lib/client/format';
	import { formatQuantity } from '$lib/shared/quantity';

	interface Cycle {
		cycleId: string;
		listName: string | null;
		activatedAt: number;
		completedAt: number | null;
		cancelledAt: number | null;
		quantity: number | null;
		unit: string | null;
	}

	const open = $derived(ui.isOpen('product'));
	const productId = $derived(ui.data<{ productId: string }>('product')?.productId ?? null);
	const product = $derived(productId ? app.product(productId) : undefined);
	const stats = $derived(
		product
			? computeStats(product.completions, product.purchaseCount, app.now, product.firstCompletedAt)
			: null
	);
	const item = $derived(product ? app.itemFor(product.id) : undefined);

	let cycles = $state<Cycle[] | null>(null);
	let cyclesError = $state(false);
	let renaming = $state(false);
	let name = $state('');

	$effect(() => {
		if (!open || !productId) return;
		cycles = null;
		cyclesError = false;
		renaming = false;
		const pid = productId;
		fetch(`/api/products/${encodeURIComponent(pid)}/history`)
			.then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
			.then((data: Cycle[]) => {
				if (productId === pid) cycles = data;
			})
			.catch(() => (cyclesError = true));
	});

	const offlineCycles = $derived<Cycle[]>(
		product
			? [...product.completions].reverse().map((t, i) => ({
					cycleId: String(i),
					listName: null,
					activatedAt: t,
					completedAt: t,
					cancelledAt: null,
					quantity: null,
					unit: null
				}))
			: []
	);

	const shownCycles = $derived(cycles ?? (cyclesError ? offlineCycles : null));

	function saveName() {
		if (!product) return;
		if (app.updateProduct(product, { name })) renaming = false;
	}

	async function remove() {
		if (!product) return;
		const ok = await ui.confirm({
			title: `“${product.name}” definitief verwijderen?`,
			message: 'Het product verdwijnt van alle lijsten, inclusief alle aankoopgeschiedenis.',
			confirmLabel: 'Verwijderen',
			danger: true
		});
		if (!ok) return;
		app.deleteProduct(product);
		ui.closeSheet();
	}
</script>

<Sheet
	{open}
	title={product?.name ?? 'Product'}
	onclose={() => ui.closeSheet()}
	testid="product-sheet"
>
	{#if product && stats}
		<div class="space-y-6">
			<div class="grid grid-cols-2 gap-2">
				<button
					type="button"
					class="flex min-h-12 items-center justify-center gap-2 rounded-2xl px-3 text-base font-semibold {item?.status ===
					'active'
						? 'bg-surface-2 text-muted'
						: 'bg-accent text-on-accent active:bg-accent-strong'}"
					disabled={item?.status === 'active'}
					onclick={() => app.addProduct(product)}
					data-testid="product-add"
				>
					{#if item?.status === 'active'}
						<Icon name="check" size={20} /> Op de lijst
					{:else}
						<Icon name="plus" size={20} /> Op de lijst
					{/if}
				</button>
				<button
					type="button"
					class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border px-3 text-base font-semibold {product.favorite
						? 'border-star/40 bg-star/10'
						: 'border-line'}"
					aria-pressed={product.favorite}
					onclick={() => app.toggleFavorite(product)}
					data-testid="product-favorite"
				>
					<Icon
						name="star"
						size={20}
						filled={product.favorite}
						class={product.favorite ? 'text-star' : 'text-faint'}
					/>
					Favoriet
				</button>
			</div>

			<ProductMemory {product} />

			<dl class="grid grid-cols-2 gap-2" data-testid="product-stats">
				{#each [['Keer gekocht', String(stats.purchaseCount)], ['Laatst gekocht', relativeDay(stats.lastPurchasedAt, app.now)], ['Gem. interval', formatInterval(stats.avgIntervalDays)], ['Frequentie', formatPerMonth(stats.perMonth)], ['Volgende keer', stats.nextEstimatedAt ? relativeDay(stats.nextEstimatedAt, app.now) : '—'], ['Eerst toegevoegd', formatDate(product.createdAt, app.now)]] as [label, value] (label)}
					<div class="rounded-2xl bg-surface-2 px-3.5 py-3">
						<dt class="text-sm text-muted">{label}</dt>
						<dd class="text-lg font-semibold [overflow-wrap:anywhere]">{value}</dd>
					</div>
				{/each}
			</dl>
			{#if !stats.hasEnoughHistory}
				<p class="flex gap-2 text-sm text-muted">
					<Icon name="info" size={18} class="mt-0.5 shrink-0" />
					Na {MIN_HISTORY} aankopen schatten we wanneer je dit weer nodig hebt.
				</p>
			{/if}

			{#if renaming}
				<form
					class="flex gap-2"
					onsubmit={(e) => {
						e.preventDefault();
						saveName();
					}}
				>
					<input
						bind:value={name}
						maxlength="80"
						aria-label="Nieuwe naam"
						class="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-4 text-lg outline-none focus:border-accent"
						data-testid="product-name-input"
					/>
					<button
						type="submit"
						class="min-h-12 rounded-2xl bg-accent px-4 font-semibold text-on-accent">Opslaan</button
					>
				</form>
			{:else}
				<button
					type="button"
					class="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-line px-4 text-base font-semibold"
					onclick={() => {
						name = product.name;
						renaming = true;
					}}
					data-testid="product-rename"
				>
					<Icon name="pencil" size={20} class="text-faint" /> Naam wijzigen
				</button>
			{/if}

			<CategoryChips
				value={product.categoryId}
				onchange={(id) => app.updateProduct(product, { categoryId: id })}
			/>

			<section>
				<h3 class="mb-2 text-sm font-semibold text-muted">Geschiedenis</h3>
				{#if shownCycles === null}
					<p class="text-muted">Laden…</p>
				{:else if shownCycles.length === 0}
					<p class="text-muted">Nog geen geschiedenis.</p>
				{:else}
					{#if cyclesError}
						<p class="mb-2 text-sm text-warn">Offline: alleen recente aankopen zichtbaar.</p>
					{/if}
					<ol class="divide-y divide-line rounded-2xl bg-surface-2" data-testid="product-cycles">
						{#each shownCycles.slice(0, 60) as c (c.cycleId)}
							<li class="flex items-start gap-3 px-3.5 py-2.5">
								<span
									class="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full {c.completedAt
										? 'bg-accent'
										: c.cancelledAt
											? 'bg-faint'
											: 'bg-warn'}"
								></span>
								<span class="min-w-0 flex-1">
									<span class="block font-medium">
										{c.completedAt
											? 'Gekocht'
											: c.cancelledAt
												? 'Verwijderd van lijst'
												: 'Op de lijst'}
										{#if formatQuantity(c.quantity, c.unit)}<span class="text-muted">
												· {formatQuantity(c.quantity, c.unit)}</span
											>{/if}
									</span>
									<span class="block text-sm text-muted">
										{formatDateTime(
											c.completedAt ?? c.cancelledAt ?? c.activatedAt,
											app.now
										)}{c.listName ? ` · ${c.listName}` : ''}
										{#if c.completedAt && c.activatedAt !== c.completedAt}
											· toegevoegd {formatDate(c.activatedAt, app.now)}
										{/if}
									</span>
								</span>
							</li>
						{/each}
					</ol>
				{/if}
			</section>

			<button
				type="button"
				class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-danger/40 px-4 text-base font-semibold text-danger active:bg-danger-soft"
				onclick={remove}
				data-testid="product-delete"
			>
				<Icon name="trash" size={20} /> Product en geschiedenis verwijderen
			</button>
		</div>
	{/if}
</Sheet>
