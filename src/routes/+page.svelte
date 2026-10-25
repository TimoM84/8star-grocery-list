<script lang="ts">
	import { ms } from '$lib/client/motion';
	import { flip } from 'svelte/animate';
	import { fade, slide } from 'svelte/transition';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import AddBar from '$lib/components/AddBar.svelte';
	import SortControl from '$lib/components/SortControl.svelte';
	import ItemRow from '$lib/components/ItemRow.svelte';
	import SyncBadge from '$lib/components/SyncBadge.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { app, type AddOutcome } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { holdWakeLock } from '$lib/client/wakelock';
	import {
		groupByCategory,
		itemViews,
		sortActive,
		sortCompleted,
		type ItemView
	} from '$lib/shared/selectors';
	import { routeCategories, sortManual } from '$lib/shared/planning';

	/** Participants count as present for this long after their last heartbeat. */
	const PRESENCE_MS = 10 * 60_000;

	const views = $derived(app.view ? itemViews(app.view, app.listId) : []);
	const checklist = $derived(app.isChecklist);
	const shopping = $derived(app.inShopping);
	const activeAll = $derived(views.filter((v) => v.item.status === 'active'));
	const available = $derived(
		checklist ? activeAll : activeAll.filter((v) => v.item.unavailableAt === null)
	);
	const unavailable = $derived(
		checklist ? [] : activeAll.filter((v) => v.item.unavailableAt !== null)
	);
	const sorted = $derived(checklist ? sortManual(available) : sortActive(available, app.sort));
	const completedAll = $derived(views.filter((v) => v.item.status === 'completed'));
	const categories = $derived(
		routeCategories(app.view?.categories ?? [], app.currentList).map((c, i) => ({
			...c,
			position: i
		}))
	);
	const categoryNames = $derived(new Map((app.view?.categories ?? []).map((c) => [c.id, c.name])));
	const maybe = $derived(checklist ? [] : app.suggestions.slice(0, 4));

	// ---------------------------------------------------------------- winkelstand

	/**
	 * Order frozen when entering winkelstand: rows never jump while shopping. Ticked rows stay in
	 * place (checked) until "opruimen"; items added on other devices wait behind a banner.
	 */
	let frozen = $state<string[] | null>(null);
	let frozenFor = $state<string | null>(null);
	let showTools = $state(false);
	let showAdd = $state(false);
	let shoppingCompletedOpen = $state(false);

	const session = $derived(app.shopping);
	const since = $derived(
		shopping && session
			? app.round && session.roundId === app.round.id
				? app.round.startedAt
				: session.enteredAt
			: null
	);

	$effect(() => {
		const key = shopping && session ? `${session.listId}:${session.enteredAt}` : null;
		if (key !== frozenFor) {
			frozenFor = key;
			frozen = key ? sorted.map((v) => v.item.id) : null;
			showTools = false;
			showAdd = false;
			shoppingCompletedOpen = false;
		}
	});

	/** Inserts ids at the position the current sort would give them. */
	function insertSorted(ids: string[]) {
		if (!frozen) return;
		const order = sorted.map((v) => v.item.id);
		const next = [...frozen];
		for (const id of ids) {
			if (next.includes(id)) continue;
			const idx = order.indexOf(id);
			let at = next.length;
			for (let k = idx - 1; k >= 0; k--) {
				const pos = next.indexOf(order[k]);
				if (pos >= 0) {
					at = pos + 1;
					break;
				}
			}
			next.splice(at, 0, id);
		}
		frozen = next;
	}

	function onadded(outcome: AddOutcome) {
		if (shopping && (outcome.kind === 'added' || outcome.kind === 'reactivated'))
			insertSorted([outcome.itemId]);
	}

	const byId = $derived(new Map(views.map((v) => [v.item.id, v])));
	/** Rows shown in winkelstand: frozen order, active or ticked during this session. */
	const shoppingRows = $derived(
		frozen
			? frozen
					.map((id) => byId.get(id))
					.filter(
						(v): v is ItemView =>
							!!v &&
							((v.item.status === 'active' && v.item.unavailableAt === null) ||
								(v.item.status === 'completed' && (v.item.completedAt ?? 0) >= (since ?? 0)))
					)
			: []
	);
	const waitingNew = $derived(
		frozen ? available.filter((v) => !frozen!.includes(v.item.id)).map((v) => v.item.id) : []
	);
	const tickedInPlace = $derived(shoppingRows.filter((v) => v.item.status === 'completed'));

	const active = $derived(shopping ? shoppingRows : sorted);
	const completed = $derived(
		sortCompleted(shopping ? completedAll.filter((v) => !shoppingRows.includes(v)) : completedAll)
	);
	const groups = $derived(app.groupByCategory ? groupByCategory(active, categories) : null);
	const remaining = $derived(available.length);

	function isNew(v: ItemView) {
		return since !== null && v.item.activatedAt > since;
	}

	$effect(() => {
		if (!shopping || !app.wakeLockEnabled) return;
		return holdWakeLock();
	});

	// ---------------------------------------------------------------- rounds

	const presentOthers = $derived(
		(app.round?.participants ?? []).filter(
			(p) => p.deviceId !== app.deviceId && p.lastSeenAt > app.now - PRESENCE_MS
		)
	);
	const roundLabel = $derived(
		presentOthers.length === 0
			? 'Er loopt een winkelronde'
			: `${presentOthers.map((p) => p.deviceName ?? 'Iemand').join(' en ')} ${presentOthers.length === 1 ? 'doet' : 'doen'} boodschappen`
	);
	const roundUnshared = $derived(
		shopping &&
			!!session?.roundId &&
			app.status.connection !== 'online' &&
			!app.view?.rounds.some((r) => r.id === session.roundId && r.participants.length)
	);

	async function endRound() {
		const round = app.round;
		if (!round) return;
		const ok = await ui.confirm({
			title: 'Winkelronde beëindigen?',
			message:
				'De ronde stopt voor iedereen. Er wordt niets afgevinkt of geboekt; de lijst blijft zoals hij is.',
			confirmLabel: 'Beëindigen'
		});
		if (ok) app.endRound(round);
	}

	// ---------------------------------------------------------------- actions

	function edit(v: ItemView) {
		ui.openSheet('item', { itemId: v.item.id });
	}

	async function clearCompleted() {
		const ok = await ui.confirm({
			title: checklist ? 'Afgeronde taken wissen?' : 'Afgevinkte items wissen?',
			message: `${completed.length === 1 ? '1 item verdwijnt' : `${completed.length} items verdwijnen`} van deze lijst.${checklist ? '' : ' De aankoopgeschiedenis blijft bewaard.'}`,
			confirmLabel: 'Wissen',
			danger: true
		});
		if (ok) app.clearCompleted();
	}

	async function resetChecklist() {
		const list = app.currentList;
		if (!list || !completedAll.length) return;
		const names = completedAll.map((v) => v.product.name);
		const ok = await ui.confirm({
			title: 'Opnieuw klaarzetten?',
			message: `Deze ${names.length === 1 ? 'taak gaat' : `${names.length} taken gaan`} terug naar ‘Nog te doen’: ${names.slice(0, 12).join(', ')}${names.length > 12 ? ` en ${names.length - 12} meer` : ''}. Je kunt dit ongedaan maken.`,
			confirmLabel: 'Klaarzetten'
		});
		if (ok)
			app.resetChecklist(
				list,
				completedAll.map((v) => v.item.id)
			);
	}

	let reordering = $state(false);
	function moveBy(v: ItemView, delta: number) {
		const ids = sorted.map((x) => x.item.id);
		const i = ids.indexOf(v.item.id);
		const j = i + delta;
		if (i < 0 || j < 0 || j >= ids.length) return;
		[ids[i], ids[j]] = [ids[j], ids[i]];
		app.reorderItems(app.listId, ids);
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
		checklist
			? app.activeCount === 0
				? 'Alles afgerond'
				: `${app.activeCount} nog te doen`
			: app.activeCount === 0
				? 'Niets te halen'
				: app.activeCount === 1
					? '1 item te halen'
					: `${app.activeCount} items te halen`
	);
	const activeTitle = $derived(checklist ? 'Nog te doen' : 'Te halen');
	const doneTitle = $derived(checklist ? 'Afgerond' : 'Afgevinkt');
	const completedOpen = $derived(shopping ? shoppingCompletedOpen : app.completedOpen);
	function setCompletedOpen(open: boolean) {
		if (shopping) shoppingCompletedOpen = open;
		else app.setCompletedOpen(open);
	}
</script>

<svelte:head><title>{app.currentList?.name ?? 'Boodschappen'} · 8star</title></svelte:head>

<svelte:window bind:innerHeight bind:innerWidth />

{#if shopping}
	<header
		bind:clientHeight={headerHeight}
		class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-2 backdrop-blur"
		data-testid="shopping-bar"
	>
		<div class="px-safe mx-auto flex max-w-2xl items-center gap-2 pt-1">
			<div class="min-w-0 flex-1">
				<h1
					class="text-[min(1.25rem,5.4vw)] leading-tight font-bold [overflow-wrap:anywhere]"
					data-testid="page-title"
				>
					{app.currentList?.name}
				</h1>
				<p
					class="text-base leading-tight font-semibold text-accent"
					data-testid="shopping-remaining"
				>
					{remaining === 0
						? 'Alles gehaald'
						: remaining === 1
							? 'Nog 1 product'
							: `Nog ${remaining} producten`}
				</p>
			</div>
			<SyncBadge />
			<button
				type="button"
				class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent active:bg-accent-strong"
				aria-label="Toevoegen"
				aria-expanded={showAdd}
				onclick={() => (showAdd = !showAdd)}
				data-testid="shopping-add"
			>
				<Icon name={showAdd ? 'x' : 'plus'} size={26} stroke={2.5} />
			</button>
			<button
				type="button"
				class="min-h-12 shrink-0 rounded-2xl bg-ink px-4 text-base font-semibold text-bg"
				onclick={() => app.exitShopping()}
				data-testid="shopping-exit">Klaar</button
			>
		</div>
		<div class="px-safe mx-auto max-w-2xl">
			{#if presentOthers.length || roundUnshared}
				<p class="mt-1 flex items-center gap-1.5 text-sm text-muted" data-testid="round-status">
					<Icon name="users" size={16} />
					{#if roundUnshared}
						Offline gestart: de ronde wordt gedeeld zodra er verbinding is.
					{:else}
						Samen met {presentOthers.map((p) => p.deviceName ?? 'iemand').join(', ')}
					{/if}
				</p>
			{/if}
			{#if showAdd}
				<div class="mt-2" transition:slide={{ duration: ms(160) }}>
					<AddBar {onadded} autofocus />
					<button
						type="button"
						class="mt-1 flex min-h-12 items-center gap-2 px-1 text-sm font-semibold text-accent"
						onclick={() => ui.openSheet('bulk', { listId: app.listId })}
						data-testid="bulk-open"
					>
						<Icon name="paste" size={18} /> Meerdere toevoegen
					</button>
				</div>
			{/if}
		</div>
	</header>
{:else}
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
{/if}

{#snippet row(v: ItemView, showCategory: boolean)}
	<ItemRow
		view={v}
		categoryName={showCategory && v.product.categoryId
			? categoryNames.get(v.product.categoryId)
			: null}
		highlight={app.highlightId === v.item.id}
		isNew={shopping && isNew(v)}
		claim={app.claims.get(v.item.id) ?? null}
		{shopping}
		ontoggle={() => app.toggle(v.item)}
		onedit={() => edit(v)}
	/>
{/snippet}

<main class="px-safe mx-auto max-w-2xl space-y-4 pt-4">
	{#if !shopping}
		{#if app.round && !checklist}
			<div
				class="flex flex-wrap items-center gap-2 rounded-2xl bg-accent-soft/70 py-1 pr-1 pl-4"
				data-testid="round-banner"
			>
				<Icon name="cart" size={20} class="text-accent" />
				<span class="min-w-0 flex-1 py-2 font-semibold">{roundLabel}</span>
				<button
					type="button"
					class="min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-accent"
					onclick={() => app.enterShopping()}
					data-testid="round-join">Meedoen</button
				>
			</div>
		{/if}
		<div class="flex flex-wrap gap-2">
			{#if !checklist}
				<button
					type="button"
					class="flex min-h-12 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink px-4 text-base font-semibold text-bg active:opacity-90"
					onclick={() => app.enterShopping()}
					data-testid="shopping-enter"
				>
					<Icon name="cart" size={20} /> Ik ga winkelen
				</button>
			{/if}
			<button
				type="button"
				class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-line bg-surface px-4 text-base font-semibold active:bg-surface-2 {checklist
					? 'flex-1'
					: ''}"
				onclick={() => ui.openSheet('bulk', { listId: app.listId })}
				data-testid="bulk-open"
			>
				<Icon name="paste" size={20} class="text-accent" /> Meerdere
			</button>
		</div>
		{#if !checklist}
			<SortControl value={app.sort} onchange={(m) => app.setSort(m)} />
		{/if}
	{:else}
		{#if showTools}
			<div class="space-y-3 rounded-2xl bg-surface-2 p-3" transition:slide={{ duration: ms(160) }}>
				<SortControl value={app.sort} onchange={(m) => app.setSort(m)} />
				<p class="text-sm text-muted">
					De volgorde in de winkelstand blijft staan; een nieuwe sortering geldt vanaf de volgende
					keer.
				</p>
				{#if app.round}
					<button
						type="button"
						class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-surface font-semibold text-danger"
						onclick={endRound}
						data-testid="round-end"
					>
						<Icon name="x" size={20} /> Winkelronde voor iedereen beëindigen
					</button>
				{/if}
			</div>
		{/if}
		{#if waitingNew.length}
			<button
				type="button"
				class="flex min-h-12 w-full items-center gap-2 rounded-2xl bg-accent px-4 text-left font-semibold text-on-accent"
				onclick={() => insertSorted(waitingNew)}
				data-testid="new-items-banner"
			>
				<Icon name="plus" size={20} />
				<span class="flex-1"
					>{waitingNew.length === 1 ? '1 nieuw product' : `${waitingNew.length} nieuwe producten`} op
					de lijst</span
				>
				<span class="underline">Bekijken</span>
			</button>
		{/if}
	{/if}

	{#if maybe.length && !shopping}
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
				{activeTitle} <span class="text-faint">· {available.length}</span>
			</h2>
			{#if checklist}
				<button
					type="button"
					class="flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-semibold {reordering
						? 'bg-ink text-bg'
						: 'bg-surface-2 text-muted'}"
					aria-pressed={reordering}
					onclick={() => (reordering = !reordering)}
					data-testid="reorder-toggle"
				>
					<Icon name="arrowDown" size={16} /> Volgorde
				</button>
			{:else}
				{#if shopping}
					<button
						type="button"
						class="flex min-h-12 items-center gap-1.5 rounded-full px-3 text-sm font-semibold {showTools
							? 'bg-ink text-bg'
							: 'bg-surface-2 text-muted'}"
						aria-expanded={showTools}
						onclick={() => (showTools = !showTools)}
						data-testid="shopping-tools"
					>
						<Icon name="settings" size={16} /> Weergave
					</button>
				{/if}
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
			{/if}
		</div>

		{#if active.length === 0}
			<div
				class="rounded-2xl border-2 border-dashed border-line px-5 py-8 text-center"
				in:fade={{ duration: ms(200) }}
				data-testid="empty-state"
			>
				{#if checklist}
					<p class="text-lg font-semibold">Alles afgerond!</p>
					<p class="mt-1 text-muted">
						Zet de lijst opnieuw klaar of typ hierboven een nieuwe taak.
					</p>
				{:else if shopping}
					<p class="text-lg font-semibold">Alles gehaald!</p>
					<p class="mt-1 text-muted">Tik op Klaar om de winkelstand te verlaten.</p>
				{:else}
					<p class="text-lg font-semibold">Alles in huis!</p>
					<p class="mt-1 text-muted">Typ hierboven wat er op de lijst moet.</p>
				{/if}
			</div>
		{:else if groups && !checklist}
			<div class="space-y-4">
				{#each groups as g (g.category?.id ?? 'none')}
					<div data-testid="category-group">
						<h3 class="mb-1.5 px-1 text-sm font-bold tracking-wide text-faint uppercase">
							{g.category?.name ?? 'Overig'}
						</h3>
						<ul class="space-y-2">
							{#each g.items as v (v.item.id)}
								<li
									animate:flip={{ duration: shopping ? 0 : ms(200) }}
									transition:slide={{ duration: ms(180) }}
								>
									{@render row(v, false)}
								</li>
							{/each}
						</ul>
					</div>
				{/each}
			</div>
		{:else}
			<ul class="space-y-2" data-testid="active-list">
				{#each active as v, i (v.item.id)}
					<li
						animate:flip={{ duration: shopping ? 0 : ms(200) }}
						transition:slide={{ duration: ms(180) }}
						class={reordering ? 'flex items-center gap-1' : ''}
					>
						{#if reordering}
							<div class="min-w-0 flex-1">{@render row(v, false)}</div>
							<button
								type="button"
								class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 disabled:opacity-30"
								aria-label="{v.product.name} omhoog"
								disabled={i === 0}
								onclick={() => moveBy(v, -1)}
								data-testid="move-up"><Icon name="arrowUp" size={20} /></button
							>
							<button
								type="button"
								class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-surface-2 disabled:opacity-30"
								aria-label="{v.product.name} omlaag"
								disabled={i === active.length - 1}
								onclick={() => moveBy(v, 1)}
								data-testid="move-down"><Icon name="arrowDown" size={20} /></button
							>
						{:else}
							{@render row(v, !checklist)}
						{/if}
					</li>
				{/each}
			</ul>
		{/if}
		{#if shopping && tickedInPlace.length}
			<button
				type="button"
				class="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold text-muted active:bg-surface-2"
				onclick={() =>
					(frozen = frozen?.filter((id) => byId.get(id)?.item.status !== 'completed') ?? null)}
				data-testid="tidy-ticked"
			>
				<Icon name="check" size={18} /> Afgevinkte inklappen ({tickedInPlace.length})
			</button>
		{/if}
	</section>

	{#if unavailable.length}
		<section aria-labelledby="unavailable-title" data-testid="unavailable-section">
			<div class="mb-2 flex items-center gap-2">
				<h2 id="unavailable-title" class="flex-1 text-base font-semibold text-warn">
					Niet verkrijgbaar <span class="text-faint">· {unavailable.length}</span>
				</h2>
				<button
					type="button"
					class="min-h-12 rounded-full px-3 text-sm font-semibold text-accent active:bg-surface-2"
					onclick={() => app.retryUnavailable()}
					data-testid="retry-unavailable">Opnieuw proberen</button
				>
			</div>
			<p class="mb-2 text-sm text-muted">Nog nodig, niet gekocht. Blijft op de lijst.</p>
			<ul class="space-y-2">
				{#each unavailable as v (v.item.id)}
					<li transition:slide={{ duration: ms(180) }}>{@render row(v, false)}</li>
				{/each}
			</ul>
		</section>
	{/if}

	{#if completed.length}
		<section aria-labelledby="done-title" class="pt-2">
			<button
				type="button"
				class="flex min-h-12 w-full items-center gap-2 rounded-2xl px-1 text-left"
				aria-expanded={completedOpen}
				aria-controls="completed-list"
				onclick={() => setCompletedOpen(!completedOpen)}
				data-testid="completed-toggle"
			>
				<h2 id="done-title" class="flex-1 text-base font-semibold text-muted">
					{doneTitle} <span class="text-faint">· {completed.length}</span>
				</h2>
				<Icon name={completedOpen ? 'chevronUp' : 'chevronDown'} class="text-faint" />
			</button>
			{#if completedOpen}
				<div id="completed-list" transition:slide={{ duration: ms(200) }}>
					<ul class="space-y-2" data-testid="completed-list">
						{#each completed as v (v.item.id)}
							<li animate:flip={{ duration: ms(200) }} transition:slide={{ duration: ms(180) }}>
								<ItemRow view={v} ontoggle={() => app.toggle(v.item)} onedit={() => edit(v)} />
							</li>
						{/each}
					</ul>
					{#if !shopping}
						{#if checklist}
							<button
								type="button"
								class="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 text-base font-semibold active:bg-surface-3"
								onclick={resetChecklist}
								data-testid="reset-checklist"
							>
								<Icon name="refresh" size={18} /> Opnieuw klaarzetten
							</button>
						{/if}
						<button
							type="button"
							class="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-semibold text-muted active:bg-surface-2"
							onclick={clearCompleted}
							data-testid="clear-completed"
						>
							<Icon name="trash" size={18} />
							{checklist ? 'Afgeronde taken wissen' : 'Afgevinkte items wissen'}
						</button>
					{/if}
				</div>
			{/if}
		</section>
	{/if}
</main>
