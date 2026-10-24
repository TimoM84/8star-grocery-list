<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import OrderedEditor from '$lib/components/OrderedEditor.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { pwa } from '$lib/client/pwa.svelte';
	import { toasts } from '$lib/client/toast.svelte';
	import { formatDateTime, timeAgo } from '$lib/client/format';

	const lists = $derived(
		app.lists.map((l) => {
			const items = app.view?.items.filter((i) => i.listId === l.id) ?? [];
			const active = items.filter((i) => i.status === 'active').length;
			return {
				id: l.id,
				name: l.name,
				detail: `${active} te halen · ${items.length - active} afgevinkt`
			};
		})
	);
	const categories = $derived(
		(app.view?.categories ?? []).map((c) => ({
			id: c.id,
			name: c.name,
			detail: `${app.view?.products.filter((p) => p.categoryId === c.id).length ?? 0} producten`
		}))
	);

	let backupBusy = $state(false);

	async function deleteList(id: string) {
		const list = app.lists.find((l) => l.id === id);
		if (!list) return;
		const ok = await ui.confirm({
			title: `Lijst “${list.name}” verwijderen?`,
			message:
				'De items op deze lijst verdwijnen. Producten en aankoopgeschiedenis blijven bewaard.',
			confirmLabel: 'Verwijderen',
			danger: true
		});
		if (ok) app.deleteList(list);
	}

	async function deleteCategory(id: string) {
		const cat = app.view?.categories.find((c) => c.id === id);
		if (!cat) return;
		const ok = await ui.confirm({
			title: `Categorie “${cat.name}” verwijderen?`,
			message: 'Producten in deze categorie krijgen geen categorie meer.',
			confirmLabel: 'Verwijderen',
			danger: true
		});
		if (ok) app.deleteCategory(id);
	}

	async function backupNow() {
		backupBusy = true;
		try {
			const res = await fetch('/api/backup', { method: 'POST' });
			if (!res.ok) throw new Error(String(res.status));
			const data = (await res.json()) as { file: string };
			toasts.show(`Back-up gemaakt: ${data.file}`, { kind: 'success' });
		} catch {
			toasts.show('Back-up maken lukt alleen met verbinding naar de server.', { kind: 'error' });
		} finally {
			backupBusy = false;
		}
	}

	const connLabel = $derived(
		app.status.connection === 'online'
			? 'Verbonden (live)'
			: app.status.connection === 'offline'
				? 'Offline'
				: 'Verbinden…'
	);
</script>

<svelte:head><title>Beheer · 8star</title></svelte:head>

<header
	class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-2 backdrop-blur [@media(orientation:landscape)_and_(max-height:560px)]:static"
>
	<PageHeader title="Beheer" subtitle="Lijsten, categorieën en gegevens" />
</header>

<main class="px-safe mx-auto max-w-2xl space-y-8 pt-4">
	<section id="sync" aria-labelledby="sync-title" class="scroll-mt-24">
		<h2 id="sync-title" class="mb-3 text-lg font-bold">Synchronisatie</h2>
		<div class="space-y-3 rounded-2xl bg-surface p-4 shadow-card" data-testid="sync-card">
			<div class="flex items-center gap-3">
				<span
					class="h-3 w-3 shrink-0 rounded-full {app.status.connection === 'online'
						? 'bg-accent'
						: app.status.connection === 'offline'
							? 'bg-warn'
							: 'bg-faint'}"
				></span>
				<span class="flex-1 text-lg font-semibold" data-testid="sync-connection">{connLabel}</span>
			</div>
			<dl class="grid grid-cols-2 gap-2 text-base">
				<div class="rounded-xl bg-surface-2 px-3 py-2">
					<dt class="text-sm text-muted">Wachtende wijzigingen</dt>
					<dd class="text-lg font-semibold" data-testid="sync-pending">{app.status.pending}</dd>
				</div>
				<div class="rounded-xl bg-surface-2 px-3 py-2">
					<dt class="text-sm text-muted">Laatst gesynchroniseerd</dt>
					<dd class="text-lg font-semibold">{timeAgo(app.status.lastSyncAt, app.now)}</dd>
				</div>
			</dl>
			<p class="text-sm text-muted">
				Wijzigingen worden eerst op dit apparaat bewaard en automatisch verstuurd zodra de server
				weer bereikbaar is (thuisnetwerk of VPN).
			</p>
			<button
				type="button"
				class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-surface-2 font-semibold active:bg-surface-3"
				onclick={() => app.syncNow()}
				data-testid="sync-now"
			>
				<Icon name="refresh" size={20} /> Nu synchroniseren
			</button>
			{#if app.issues.length}
				<div class="border-t border-line pt-3" data-testid="sync-issues">
					<div class="mb-2 flex items-center">
						<h3 class="flex-1 font-semibold">Meldingen ({app.issues.length})</h3>
						<button
							type="button"
							class="min-h-12 px-2 text-sm font-semibold text-muted"
							onclick={() => app.engine?.clearIssues()}>Alles wissen</button
						>
					</div>
					<ul class="space-y-2">
						{#each app.issues as issue (issue.id)}
							<li
								class="flex items-start gap-2 rounded-xl px-3 py-2 {issue.kind === 'rejected'
									? 'bg-danger-soft'
									: 'bg-warn-soft'}"
							>
								<span class="min-w-0 flex-1 text-sm">
									<span class="block">{issue.message}</span>
									<span class="text-faint">{formatDateTime(issue.at, app.now)}</span>
								</span>
								<button
									type="button"
									class="-my-1 -mr-2 grid h-12 w-12 shrink-0 place-items-center text-muted"
									aria-label="Melding verbergen"
									onclick={() => app.engine?.dismissIssue(issue.id)}
									><Icon name="x" size={18} /></button
								>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
	</section>

	<section aria-labelledby="lists-title">
		<h2 id="lists-title" class="mb-1 text-lg font-bold">Lijsten</h2>
		<p class="mb-3 text-sm text-muted">
			Elke lijst is onafhankelijk. Tik op een naam om te hernoemen.
		</p>
		<OrderedEditor
			entries={lists}
			addLabel="Lijst"
			addPlaceholder="Nieuwe lijst"
			canDelete={() => app.lists.length > 1}
			onadd={(name) => {
				const id = app.createList(name);
				if (id) toasts.show(`Lijst “${name.trim()}” aangemaakt`, { kind: 'success' });
			}}
			onrename={(id, name) => {
				const l = app.lists.find((x) => x.id === id);
				if (l) app.renameList(l, name);
			}}
			onmove={(id, d) => {
				const l = app.lists.find((x) => x.id === id);
				if (l) app.moveListBy(l, d);
			}}
			ondelete={deleteList}
			testid="lists"
		/>
	</section>

	<section aria-labelledby="cats-title">
		<h2 id="cats-title" class="mb-1 text-lg font-bold">Categorieën</h2>
		<p class="mb-3 text-sm text-muted">
			De volgorde bepaalt de indeling bij “Per categorie” — zet ze in de looproute van je winkel.
		</p>
		<OrderedEditor
			entries={categories}
			addLabel="Categorie"
			addPlaceholder="Nieuwe categorie"
			onadd={(name) => app.createCategory(name)}
			onrename={(id, name) => app.renameCategory(id, name)}
			onmove={(id, d) => app.moveCategoryBy(id, d)}
			ondelete={deleteCategory}
			testid="categories"
		/>
	</section>

	<section aria-labelledby="data-title">
		<h2 id="data-title" class="mb-3 text-lg font-bold">Gegevens</h2>
		<div class="grid gap-2 sm:grid-cols-2">
			<a
				href="/api/export?format=csv&type=purchases"
				download
				class="flex min-h-13 items-center gap-3 rounded-2xl bg-surface px-4 font-semibold shadow-card active:bg-surface-2"
				data-testid="export-csv"
			>
				<Icon name="download" size={20} class="text-accent" /> Aankopen (CSV)
			</a>
			<a
				href="/api/export?format=csv&type=products"
				download
				class="flex min-h-13 items-center gap-3 rounded-2xl bg-surface px-4 font-semibold shadow-card active:bg-surface-2"
				data-testid="export-products-csv"
			>
				<Icon name="download" size={20} class="text-accent" /> Producten (CSV)
			</a>
			<a
				href="/api/export?format=json"
				download
				class="flex min-h-13 items-center gap-3 rounded-2xl bg-surface px-4 font-semibold shadow-card active:bg-surface-2"
				data-testid="export-json"
			>
				<Icon name="download" size={20} class="text-accent" /> Alles (JSON)
			</a>
			<button
				type="button"
				class="flex min-h-13 items-center gap-3 rounded-2xl bg-surface px-4 text-left font-semibold shadow-card active:bg-surface-2"
				disabled={backupBusy}
				onclick={backupNow}
				data-testid="backup-now"
			>
				<Icon name="database" size={20} class="text-accent" />
				{backupBusy ? 'Bezig…' : 'Back-up op server maken'}
			</button>
		</div>
		<p class="mt-2 text-sm text-muted">
			De server maakt ook automatisch dagelijks een back-up. Zie de README voor herstellen.
		</p>
	</section>

	<section aria-labelledby="app-title" class="pb-4">
		<h2 id="app-title" class="mb-3 text-lg font-bold">App</h2>
		<div class="space-y-3 rounded-2xl bg-surface p-4 shadow-card">
			{#if pwa.canInstall}
				<button
					type="button"
					class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-accent font-semibold text-on-accent"
					onclick={() => pwa.install()}
					data-testid="install-button"
				>
					<Icon name="download" size={20} /> Installeren op startscherm
				</button>
			{:else if pwa.installed}
				<p class="flex items-center gap-2 font-medium">
					<Icon name="check" size={20} class="text-accent" /> Geïnstalleerd als app
				</p>
			{:else}
				<p class="text-sm text-muted">
					Installeren: open het browsermenu en kies “Toevoegen aan startscherm” of “App
					installeren”.
				</p>
			{/if}
			{#if !pwa.secure}
				<p
					class="flex gap-2 rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn"
					data-testid="https-warning"
				>
					<Icon name="info" size={18} class="mt-0.5 shrink-0" />
					Deze verbinding is geen HTTPS. De lijst werkt, maar installeren en offline opstarten vereisen
					HTTPS (zie README).
				</p>
			{/if}
			<p class="text-sm text-muted">
				8star Boodschappen v{__APP_VERSION__}{pwa.swActive ? ' · offline beschikbaar' : ''}
			</p>
		</div>
	</section>
</main>
