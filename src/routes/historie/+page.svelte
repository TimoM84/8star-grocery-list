<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProductRow from '$lib/components/ProductRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { searchProducts, frequent } from '$lib/shared/selectors';
	import { searchKey } from '$lib/shared/text';
	import { formatDayHeading, relativeDay } from '$lib/client/format';
	import { formatQuantity } from '$lib/shared/quantity';

	interface Purchase {
		cycleId: string;
		productId: string;
		productName: string;
		listName: string | null;
		completedAt: number;
		quantity: number | null;
		unit: string | null;
	}

	type Tab = 'products' | 'purchases';
	type Filter = 'all' | 'favorites' | 'frequent';

	let tab = $state<Tab>('products');
	let filter = $state<Filter>('all');
	let query = $state('');

	const productList = $derived.by(() => {
		const base =
			filter === 'favorites'
				? app.products.filter((p) => p.product.favorite)
				: filter === 'frequent'
					? frequent(app.products, 100)
					: app.products;
		return searchProducts(base, query);
	});

	// Purchases: server history when online, local recent completions as offline fallback.
	let remote = $state<Purchase[] | null>(null);
	let remoteFor = $state<string | null>(null);
	let loadingMore = $state(false);
	let exhausted = $state(false);
	let offline = $state(false);

	const local = $derived.by(() => {
		const q = searchKey(query);
		const out: Purchase[] = [];
		for (const p of app.view?.products ?? []) {
			if (q && !searchKey(p.name).includes(q)) continue;
			for (const t of p.completions)
				out.push({
					cycleId: `${p.id}-${t}`,
					productId: p.id,
					productName: p.name,
					listName: null,
					completedAt: t,
					quantity: null,
					unit: null
				});
		}
		return out.sort((a, b) => b.completedAt - a.completedAt).slice(0, 300);
	});

	async function load(reset: boolean) {
		const q = query;
		const before = !reset && remote?.length ? remote[remote.length - 1].completedAt : undefined;
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive
		const params = new URLSearchParams({ limit: '60' });
		if (q.trim()) params.set('q', q.trim());
		if (before) params.set('before', String(before));
		loadingMore = true;
		try {
			const res = await fetch('/api/history?' + params);
			if (!res.ok) throw new Error(String(res.status));
			const rows = (await res.json()) as Purchase[];
			if (q !== query) return;
			remote = reset ? rows : [...(remote ?? []), ...rows];
			remoteFor = q;
			exhausted = rows.length < 60;
			offline = false;
		} catch {
			offline = true;
		} finally {
			loadingMore = false;
		}
	}

	$effect(() => {
		if (tab !== 'purchases') return;
		void query;
		void app.view?.seq;
		const t = setTimeout(() => load(true), 200);
		return () => clearTimeout(t);
	});

	const purchases = $derived(offline || remote === null || remoteFor !== query ? local : remote);
	const grouped = $derived.by(() => {
		const groups: { day: string; items: Purchase[] }[] = [];
		for (const p of purchases) {
			const day = formatDayHeading(p.completedAt, app.now);
			const last = groups[groups.length - 1];
			if (last && last.day === day) last.items.push(p);
			else groups.push({ day, items: [p] });
		}
		return groups;
	});

	const filters: { id: Filter; label: string }[] = [
		{ id: 'all', label: 'Alles' },
		{ id: 'favorites', label: 'Favorieten' },
		{ id: 'frequent', label: 'Vaak gekocht' }
	];
</script>

<svelte:head><title>Historie · 8star</title></svelte:head>

<header
	class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-3 backdrop-blur [@media(orientation:landscape)_and_(max-height:560px)]:static"
>
	<PageHeader title="Historie" subtitle="{app.view?.products.length ?? 0} producten">
		<div
			class="mt-2 grid grid-cols-2 gap-1 rounded-2xl bg-surface-2 p-1"
			role="tablist"
			aria-label="Weergave"
		>
			{#each [['products', 'Producten'], ['purchases', 'Aankopen']] as [id, label] (id)}
				<button
					type="button"
					role="tab"
					aria-selected={tab === id}
					class="min-h-12 rounded-xl text-base font-semibold {tab === id
						? 'bg-surface shadow-card'
						: 'text-muted'}"
					onclick={() => (tab = id as Tab)}
					data-testid="history-tab-{id}">{label}</button
				>
			{/each}
		</div>
		<div class="relative mt-3">
			<Icon
				name="search"
				size={20}
				class="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-faint"
			/>
			<input
				type="search"
				bind:value={query}
				placeholder="Zoek in alle producten"
				aria-label="Zoeken"
				enterkeyhint="search"
				class="h-13 w-full rounded-2xl border border-line bg-surface pr-12 pl-12 text-lg outline-none focus:border-accent"
				data-testid="history-search"
			/>
			{#if query}
				<button
					type="button"
					class="absolute top-1/2 right-1 grid h-12 w-12 -translate-y-1/2 place-items-center text-faint"
					aria-label="Zoekopdracht wissen"
					onclick={() => (query = '')}><Icon name="x" size={20} /></button
				>
			{/if}
		</div>
	</PageHeader>
</header>

<main class="px-safe mx-auto max-w-2xl pt-4">
	{#if tab === 'products'}
		<div class="mb-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Filter">
			{#each filters as f (f.id)}
				<button
					type="button"
					role="radio"
					aria-checked={filter === f.id}
					class="min-h-12 rounded-full border px-4 text-base font-medium {filter === f.id
						? 'border-ink bg-ink text-bg'
						: 'border-line bg-surface'}"
					onclick={() => (filter = f.id)}
					data-testid="history-filter-{f.id}">{f.label}</button
				>
			{/each}
		</div>
		{#if productList.length === 0}
			<p
				class="rounded-2xl bg-surface-2 px-4 py-6 text-center text-muted"
				data-testid="history-empty"
			>
				{query ? `Niets gevonden voor “${query}”.` : 'Nog geen producten.'}
			</p>
		{:else}
			<ul class="space-y-2" data-testid="history-products">
				{#each productList.slice(0, 300) as v (v.product.id)}
					<li>
						<ProductRow
							view={v}
							detail={v.stats.purchaseCount
								? `${v.stats.purchaseCount}× gekocht · laatst ${relativeDay(v.stats.lastPurchasedAt, app.now)}`
								: 'Nog niet gekocht'}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	{:else}
		{#if offline}
			<p class="mb-3 flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
				<Icon name="cloudOff" size={18} /> Offline: recente aankopen van dit apparaat.
			</p>
		{/if}
		{#if grouped.length === 0}
			<p
				class="rounded-2xl bg-surface-2 px-4 py-6 text-center text-muted"
				data-testid="history-empty"
			>
				{query
					? `Geen aankopen gevonden voor “${query}”.`
					: 'Nog geen aankopen. Vink items af om ze hier te zien.'}
			</p>
		{:else}
			<div class="space-y-5" data-testid="history-purchases">
				{#each grouped as g (g.day)}
					<section>
						<h2 class="mb-1.5 px-1 text-sm font-bold tracking-wide text-faint uppercase">
							{g.day}
						</h2>
						<ul class="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
							{#each g.items as p (p.cycleId)}
								<li>
									<button
										type="button"
										class="flex min-h-13 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-surface-2"
										onclick={() => ui.openSheet('product', { productId: p.productId })}
										data-testid="purchase-row"
									>
										<Icon name="check" size={18} class="shrink-0 text-accent" />
										<span class="min-w-0 flex-1">
											<span class="block font-medium [overflow-wrap:anywhere]">{p.productName}</span
											>
											<span class="block text-sm text-muted">
												{new Date(p.completedAt).toLocaleTimeString('nl-NL', {
													hour: '2-digit',
													minute: '2-digit'
												})}{p.listName ? ` · ${p.listName}` : ''}{formatQuantity(p.quantity, p.unit)
													? ` · ${formatQuantity(p.quantity, p.unit)}`
													: ''}
											</span>
										</span>
									</button>
								</li>
							{/each}
						</ul>
					</section>
				{/each}
				{#if !offline && remote && !exhausted}
					<button
						type="button"
						class="min-h-12 w-full rounded-2xl bg-surface-2 font-semibold active:bg-surface-3"
						disabled={loadingMore}
						onclick={() => load(false)}>{loadingMore ? 'Laden…' : 'Meer laden'}</button
					>
				{/if}
			</div>
		{/if}
	{/if}
</main>
