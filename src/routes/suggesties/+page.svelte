<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProductRow from '$lib/components/ProductRow.svelte';
	import AiSuggestions from '$lib/components/AiSuggestions.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { favorites, frequent } from '$lib/shared/selectors';
	import { formatInterval, relativeDay } from '$lib/client/format';
	import { MIN_HISTORY } from '$lib/shared/stats';

	import StockControl from '$lib/components/StockControl.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { stockIsStale } from '$lib/shared/planning';
	import { m } from '$lib/client/i18n';

	const favs = $derived(favorites(app.products));
	const freq = $derived(frequent(app.products, 15));
	const STOCK_ORDER = { out: 0, low: 1, enough: 2, unknown: 3 } as const;
	const stock = $derived(
		app.products
			.filter((v) => v.product.stockStatus === 'low' || v.product.stockStatus === 'out')
			.sort((a, b) => STOCK_ORDER[a.product.stockStatus] - STOCK_ORDER[b.product.stockStatus])
	);
	let stockEditing = $state<string | null>(null);
	/** Same label as the tab: without suggestions the page holds bundles, stock and favourites. */
	const title = $derived(app.suggestionsEnabled ? m.nav.suggestions : m.nav.shortcuts);
</script>

<svelte:head><title>{title} · 8star</title></svelte:head>

<header
	class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-2 backdrop-blur [@media(orientation:landscape)_and_(max-height:560px)]:static"
>
	<PageHeader {title} subtitle={m.suggestions.addTo(app.currentList?.name ?? m.common.list)}>
		{#if app.lists.length > 1}
			<div class="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label={m.list.chooseList}>
				{#each app.lists as l (l.id)}
					<button
						type="button"
						role="radio"
						aria-checked={l.id === app.listId}
						class="min-h-12 rounded-full border px-4 text-base font-semibold {l.id === app.listId
							? 'border-ink bg-ink text-bg'
							: 'border-line bg-surface'}"
						onclick={() => app.selectList(l.id)}>{l.name}</button
					>
				{/each}
			</div>
		{/if}
	</PageHeader>
</header>

<main class="px-safe mx-auto max-w-2xl space-y-7 pt-4">
	{#if app.suggestionsEnabled}
		<section aria-labelledby="maybe" data-testid="suggestions-section">
			<h2 id="maybe" class="mb-1 flex items-center gap-2 text-lg font-bold">
				<Icon name="sparkles" size={20} class="text-accent" />
				{m.list.maybe}
			</h2>
			<p class="mb-3 text-sm text-muted">
				{m.suggestions.maybeHelp}
			</p>
			{#if app.suggestions.length === 0}
				<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted" data-testid="no-suggestions">
					{m.suggestions.none(MIN_HISTORY)}
				</p>
			{:else}
				<ul class="space-y-2">
					{#each app.suggestions as s (s.product.id)}
						<li>
							<ProductRow
								view={s}
								detail="{formatInterval(s.stats.avgIntervalDays)} · {m.suggestions.last(
									relativeDay(s.stats.lastPurchasedAt, app.now)
								)} · {m.suggestions.expected(relativeDay(s.stats.nextEstimatedAt, app.now))}"
							>
								{#snippet extra()}
									<button
										type="button"
										class="grid w-12 shrink-0 place-items-center text-faint active:bg-surface-2"
										aria-label={m.suggestions.snooze(s.product.name)}
										title={m.suggestions.notNow}
										onclick={() => app.snooze(s)}
										data-testid="snooze"
									>
										<Icon name="x" size={20} />
									</button>
								{/snippet}
							</ProductRow>
						</li>
					{/each}
				</ul>
			{/if}
		</section>

		<AiSuggestions />
	{/if}

	<section aria-labelledby="bundles" data-testid="bundles-section">
		<h2 id="bundles" class="mb-1 flex items-center gap-2 text-lg font-bold">
			<Icon name="layers" size={20} class="text-accent" />
			{m.suggestions.bundles}
		</h2>
		<p class="mb-3 text-sm text-muted">
			{m.suggestions.bundlesHelp}
		</p>
		{#if app.bundles.length}
			<ul class="mb-3 space-y-2">
				{#each app.bundles as b (b.id)}
					<li
						class="flex items-stretch overflow-hidden rounded-2xl bg-surface shadow-card"
						data-testid="bundle-row"
						data-name={b.name}
					>
						<button
							type="button"
							class="flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 pl-4 text-left active:bg-surface-2"
							onclick={() => ui.openSheet('bundle', { bundleId: b.id })}
							aria-label={m.suggestions.editBundle(b.name)}
							data-testid="bundle-edit"
						>
							<span class="font-medium [overflow-wrap:anywhere]">{b.name}</span>
							<span class="text-sm text-muted"
								>{m.suggestions.bundleProducts(b.lines.length)}{b.servings
									? ` · ${m.suggestions.forServings(b.servings)}`
									: ''}</span
							>
						</button>
						<button
							type="button"
							class="flex min-h-14 shrink-0 items-center gap-1.5 bg-accent-soft px-4 font-semibold text-accent active:bg-accent/20"
							onclick={() => ui.openSheet('bundle-add', { bundleId: b.id })}
							data-testid="bundle-use"
						>
							<Icon name="plus" size={20} stroke={2.5} />
							{m.common.add}
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		<button
			type="button"
			class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold active:bg-surface-2"
			onclick={() => ui.openSheet('bundle', {})}
			data-testid="bundle-new"
		>
			<Icon name="plus" size={20} class="text-accent" />
			{m.bundle.newTitle}
		</button>
	</section>

	<section aria-labelledby="stock" data-testid="stock-section">
		<h2 id="stock" class="mb-1 flex items-center gap-2 text-lg font-bold">
			<Icon name="box" size={20} class="text-accent" />
			{m.memory.stock}
		</h2>
		<p class="mb-3 text-sm text-muted">
			{m.suggestions.stockHelp}
		</p>
		{#if stock.length === 0}
			<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted" data-testid="stock-empty">
				{m.suggestions.stockEmpty}
			</p>
		{:else}
			<ul class="space-y-2">
				{#each stock as s (s.product.id)}
					{@const stale = stockIsStale(s.product, app.now)}
					<li>
						<ProductRow
							view={s}
							listId={app.targetList(s.product)}
							detail="{s.product.stockStatus === 'out' ? m.stock.out : m.stock.low}{stale
								? m.stock.stale
								: ''} · {m.suggestions.to(
								app.list(app.targetList(s.product))?.name ?? m.common.list
							)}"
						>
							{#snippet extra()}
								<button
									type="button"
									class="grid w-12 shrink-0 place-items-center text-faint active:bg-surface-2"
									aria-label={m.suggestions.editStock(s.product.name)}
									aria-expanded={stockEditing === s.product.id}
									onclick={() =>
										(stockEditing = stockEditing === s.product.id ? null : s.product.id)}
									data-testid="stock-edit"
								>
									<Icon name="pencil" size={20} />
								</button>
							{/snippet}
						</ProductRow>
						{#if stockEditing === s.product.id}
							<div class="mt-2 px-1"><StockControl product={s.product} compact /></div>
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="favs" data-testid="favorites-section">
		<h2 id="favs" class="mb-3 flex items-center gap-2 text-lg font-bold">
			<Icon name="star" size={20} filled class="text-star" />
			{m.suggestions.favorites}
		</h2>
		{#if favs.length === 0}
			<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted">
				{m.suggestions.favoritesEmpty}
			</p>
		{:else}
			<ul class="space-y-2">
				{#each favs as f (f.product.id)}
					<li>
						<ProductRow
							view={f}
							detail={f.status === 'active'
								? m.suggestions.onList
								: f.stats.purchaseCount
									? m.suggestions.bought(f.stats.purchaseCount)
									: undefined}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="freq" data-testid="frequent-section">
		<h2 id="freq" class="mb-3 flex items-center gap-2 text-lg font-bold">
			<Icon name="history" size={20} class="text-muted" />
			{m.suggestions.frequent}
		</h2>
		{#if freq.length === 0}
			<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted">
				{m.suggestions.frequentEmpty}
			</p>
		{:else}
			<ul class="space-y-2">
				{#each freq as f (f.product.id)}
					<li>
						<ProductRow
							view={f}
							detail="{m.suggestions.bought(f.stats.purchaseCount)} · {m.suggestions.last(
								relativeDay(f.stats.lastPurchasedAt, app.now)
							)}"
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
