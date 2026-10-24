<script lang="ts">
	import { ms } from '$lib/client/motion';
	import { flip } from 'svelte/animate';
	import { fade, slide } from 'svelte/transition';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import AddBar from '$lib/components/AddBar.svelte';
	import SortControl from '$lib/components/SortControl.svelte';
	import ItemRow from '$lib/components/ItemRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import {
		groupByCategory,
		itemViews,
		sortActive,
		sortCompleted,
		type ItemView
	} from '$lib/shared/selectors';

	const views = $derived(app.view ? itemViews(app.view, app.listId) : []);
	const active = $derived(
		sortActive(
			views.filter((v) => v.item.status === 'active'),
			app.sort
		)
	);
	const completed = $derived(sortCompleted(views.filter((v) => v.item.status === 'completed')));
	const groups = $derived(
		app.groupByCategory ? groupByCategory(active, app.view?.categories ?? []) : null
	);
	const categoryNames = $derived(new Map((app.view?.categories ?? []).map((c) => [c.id, c.name])));
	const maybe = $derived(app.suggestions.slice(0, 4));

	function edit(v: ItemView) {
		ui.openSheet('item', { itemId: v.item.id });
	}

	async function clearCompleted() {
		const ok = await ui.confirm({
			title: 'Afgevinkte items wissen?',
			message: `${completed.length === 1 ? '1 item verdwijnt' : `${completed.length} items verdwijnen`} van deze lijst. De aankoopgeschiedenis blijft bewaard.`,
			confirmLabel: 'Wissen',
			danger: true
		});
		if (ok) app.clearCompleted();
	}

	// Keep the add bar pinned only while the header is compact (large system fonts or
	// landscape would otherwise leave too little room for the list).
	let headerHeight = $state(0);
	let innerHeight = $state(800);
	let innerWidth = $state(400);
	// Largest height seen at this width: ignores the on-screen keyboard shrinking the viewport.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive
	const fullHeights = new Map<number, number>();
	const fullHeight = $derived.by(() => {
		const h = Math.max(fullHeights.get(innerWidth) ?? 0, innerHeight);
		fullHeights.set(innerWidth, h);
		return h;
	});
	const sticky = $derived(headerHeight < fullHeight * 0.4);

	const subtitle = $derived(
		app.activeCount === 0
			? 'Niets te halen'
			: app.activeCount === 1
				? '1 item te halen'
				: `${app.activeCount} items te halen`
	);
</script>

<svelte:head><title>{app.currentList?.name ?? 'Boodschappen'} · 8star</title></svelte:head>

<svelte:window bind:innerHeight bind:innerWidth />

<header
	bind:clientHeight={headerHeight}
	class="{sticky
		? 'sticky'
		: 'relative'} pt-safe top-0 z-20 border-b border-line/60 bg-bg/95 pb-3 backdrop-blur"
	data-sticky={sticky}
>
	<PageHeader title={app.currentList?.name ?? 'Boodschappen'} {subtitle}>
		{#if app.lists.length > 1}
			<div
				class="mt-1 flex flex-wrap gap-2"
				role="radiogroup"
				aria-label="Lijst kiezen"
				data-testid="list-chips"
			>
				{#each app.lists as l (l.id)}
					{@const count =
						app.view?.items.filter((i) => i.listId === l.id && i.status === 'active').length ?? 0}
					<button
						type="button"
						role="radio"
						aria-checked={l.id === app.listId}
						class="flex min-h-12 items-center gap-2 rounded-full border px-4 text-base font-semibold transition-colors {l.id ===
						app.listId
							? 'border-ink bg-ink text-bg'
							: 'border-line bg-surface text-ink'}"
						onclick={() => app.selectList(l.id)}
						data-testid="list-chip"
					>
						<span class="break-words">{l.name}</span>
						{#if count}<span class="text-sm opacity-70">{count}</span>{/if}
					</button>
				{/each}
			</div>
		{/if}
		<div class="mt-3">
			<AddBar />
		</div>
	</PageHeader>
</header>

<main class="px-safe mx-auto max-w-2xl space-y-4 pt-4">
	<SortControl value={app.sort} onchange={(m) => app.setSort(m)} />

	{#if maybe.length}
		<section
			aria-labelledby="maybe-title"
			class="rounded-2xl bg-accent-soft/60 p-3"
			data-testid="maybe-strip"
		>
			<div class="mb-2 flex items-center gap-2">
				<Icon name="sparkles" size={18} class="text-accent" />
				<h2 id="maybe-title" class="flex-1 text-sm font-semibold text-accent">Misschien nodig</h2>
				<a
					href="/suggesties"
					class="-my-2 flex min-h-12 items-center px-2 text-sm font-semibold text-accent">Alles</a
				>
			</div>
			<div class="flex flex-wrap gap-2">
				{#each maybe as s (s.product.id)}
					<button
						type="button"
						class="flex min-h-12 items-center gap-1.5 rounded-full border border-accent/30 bg-surface px-3.5 text-base font-medium active:bg-surface-2"
						onclick={() => app.addProduct(s.product)}
						data-testid="maybe-chip"
					>
						<Icon name="plus" size={18} class="text-accent" />
						<span class="break-words">{s.product.name}</span>
					</button>
				{/each}
			</div>
		</section>
	{/if}

	<section aria-labelledby="active-title">
		<div class="mb-2 flex items-center gap-2">
			<h2 id="active-title" class="flex-1 text-base font-semibold text-muted">
				Te halen <span class="text-faint">· {active.length}</span>
			</h2>
			<button
				type="button"
				class="flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-semibold {app.groupByCategory
					? 'bg-ink text-bg'
					: 'bg-surface-2 text-muted'}"
				aria-pressed={app.groupByCategory}
				onclick={() => app.setGroupByCategory(!app.groupByCategory)}
				data-testid="group-toggle"
			>
				<Icon name="tag" size={16} /> Per categorie
			</button>
		</div>

		{#if active.length === 0}
			<div
				class="rounded-2xl border-2 border-dashed border-line px-5 py-8 text-center"
				in:fade={{ duration: ms(200) }}
				data-testid="empty-state"
			>
				<p class="text-lg font-semibold">Alles in huis!</p>
				<p class="mt-1 text-muted">Typ hierboven wat er op de lijst moet.</p>
			</div>
		{:else if groups}
			<div class="space-y-4">
				{#each groups as g (g.category?.id ?? 'none')}
					<div data-testid="category-group">
						<h3 class="mb-1.5 px-1 text-sm font-bold tracking-wide text-faint uppercase">
							{g.category?.name ?? 'Overig'}
						</h3>
						<ul class="space-y-2">
							{#each g.items as v (v.item.id)}
								<li animate:flip={{ duration: ms(200) }} transition:slide={{ duration: ms(180) }}>
									<ItemRow
										view={v}
										highlight={app.highlightId === v.item.id}
										ontoggle={() => app.toggle(v.item)}
										onedit={() => edit(v)}
									/>
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{:else}
			<ul class="space-y-2" data-testid="active-list">
				{#each active as v (v.item.id)}
					<li animate:flip={{ duration: ms(200) }} transition:slide={{ duration: ms(180) }}>
						<ItemRow
							view={v}
							categoryName={v.product.categoryId ? categoryNames.get(v.product.categoryId) : null}
							highlight={app.highlightId === v.item.id}
							ontoggle={() => app.toggle(v.item)}
							onedit={() => edit(v)}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	{#if completed.length}
		<section aria-labelledby="done-title" class="pt-2">
			<button
				type="button"
				class="flex min-h-12 w-full items-center gap-2 rounded-2xl px-1 text-left"
				aria-expanded={app.completedOpen}
				aria-controls="completed-list"
				onclick={() => app.setCompletedOpen(!app.completedOpen)}
				data-testid="completed-toggle"
			>
				<h2 id="done-title" class="flex-1 text-base font-semibold text-muted">
					Afgevinkt <span class="text-faint">· {completed.length}</span>
				</h2>
				<Icon name={app.completedOpen ? 'chevronUp' : 'chevronDown'} class="text-faint" />
			</button>
			{#if app.completedOpen}
				<div id="completed-list" transition:slide={{ duration: ms(200) }}>
					<ul class="space-y-2" data-testid="completed-list">
						{#each completed as v (v.item.id)}
							<li animate:flip={{ duration: ms(200) }} transition:slide={{ duration: ms(180) }}>
								<ItemRow view={v} ontoggle={() => app.toggle(v.item)} onedit={() => edit(v)} />
							</li>
						{/each}
					</ul>
					<button
						type="button"
						class="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold text-muted active:bg-surface-2"
						onclick={clearCompleted}
						data-testid="clear-completed"
					>
						<Icon name="trash" size={18} /> Afgevinkte items wissen
					</button>
				</div>
			{/if}
		</section>
	{/if}
</main>
