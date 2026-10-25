<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import OrderedEditor from '$lib/components/OrderedEditor.svelte';
	import ListSettings from '$lib/components/ListSettings.svelte';
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
			detail: plural(
				app.view?.products.filter((p) => p.categoryId === c.id).length ?? 0,
				'product',
				'producten'
			)
		}))
	);

	function plural(n: number, one: string, many: string) {
		return `${n} ${n === 1 ? one : many}`;
	}

	let backupBusy = $state(false);
	let deviceName = $state(app.deviceName ?? '');

	const pendingText = $derived(
		app.status.pending === 0
			? 'Alles gedeeld'
			: app.status.pending === 1
				? '1 wijziging nog niet gedeeld'
				: `${app.status.pending} wijzigingen nog niet gedeeld`
	);

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
			{#if app.status.serverNewer}
				<p class="rounded-xl bg-warn-soft px-3 py-2 text-sm text-warn" data-testid="server-newer">
					De server draait een nieuwere versie. Vernieuw de app om alles te kunnen gebruiken.
				</p>
			{/if}
			<p class="text-base font-semibold" data-testid="sync-pending-text">
				{pendingText}{app.status.pendingMedia
					? ` · ${app.status.pendingMedia === 1 ? '1 foto wacht' : `${app.status.pendingMedia} foto’s wachten`}`
					: ''}
			</p>
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

	<section aria-labelledby="device-title">
		<h2 id="device-title" class="mb-3 text-lg font-bold">Dit apparaat</h2>
		<div class="space-y-4 rounded-2xl bg-surface p-4 shadow-card" data-testid="device-card">
			<form
				onsubmit={(e) => {
					e.preventDefault();
					app.setDeviceName(deviceName);
					toasts.show(app.deviceName ? `Apparaatnaam: ${app.deviceName}` : 'Apparaatnaam gewist');
				}}
			>
				<label for="device-name" class="mb-1.5 block text-sm font-semibold text-muted"
					>Naam in de winkelronde (optioneel)</label
				>
				<div class="flex gap-2">
					<input
						id="device-name"
						bind:value={deviceName}
						maxlength="40"
						placeholder="bijv. Timo"
						class="h-12 min-w-0 flex-1 rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent"
						data-testid="device-name"
					/>
					<button
						type="submit"
						class="min-h-12 rounded-2xl bg-surface-2 px-4 font-semibold active:bg-surface-3"
						data-testid="device-name-save">Opslaan</button
					>
				</div>
				<p class="mt-1 text-sm text-faint">
					Anderen zien dan “{app.deviceName ?? 'Timo'} doet boodschappen”. Geen account, geen locatie:
					alleen deze naam en een willekeurige apparaat-id.
				</p>
			</form>
			{#each [{ id: 'share', label: 'Winkelronde delen', hint: 'Bij “Ik ga winkelen” zien anderen dat je boodschappen doet en kun je samen afvinken.', on: app.shareRound, set: (v: boolean) => app.setShareRound(v) }, { id: 'wake', label: 'Scherm aan houden in winkelstand', hint: 'Alleen terwijl de winkelstand open en zichtbaar is.', on: app.wakeLockEnabled, set: (v: boolean) => app.setWakeLock(v) }] as t (t.id)}
				<button
					type="button"
					role="switch"
					aria-checked={t.on}
					class="flex min-h-12 w-full items-center gap-3 text-left"
					onclick={() => t.set(!t.on)}
					data-testid="setting-{t.id}"
				>
					<span class="min-w-0 flex-1">
						<span class="block font-semibold">{t.label}</span>
						<span class="block text-sm text-muted">{t.hint}</span>
					</span>
					<span
						class="relative h-8 w-14 shrink-0 rounded-full transition-colors {t.on
							? 'bg-accent'
							: 'bg-surface-3'}"
						><span
							class="absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all {t.on
								? 'left-7'
								: 'left-1'}"
						></span></span
					>
				</button>
			{/each}
		</div>
	</section>

	<section aria-labelledby="features-title">
		<h2 id="features-title" class="mb-3 text-lg font-bold">Functies</h2>
		<div class="rounded-2xl bg-surface p-4 shadow-card" data-testid="features-card">
			<button
				type="button"
				role="switch"
				aria-checked={app.aiEnabled}
				class="flex min-h-12 w-full items-center gap-3 text-left"
				onclick={() => app.setAiEnabled(!app.aiEnabled)}
				data-testid="setting-ai"
			>
				<span class="min-w-0 flex-1">
					<span class="block font-semibold">AI-functies tonen</span>
					<span class="block text-sm text-muted"
						>AI-suggesties, AI-bestand importeren en de AI-opdracht. Geldt voor alle apparaten;
						uitzetten verbergt ze alleen, er wordt niets verwijderd.</span
					>
				</span>
				<span
					class="relative h-8 w-14 shrink-0 rounded-full transition-colors {app.aiEnabled
						? 'bg-accent'
						: 'bg-surface-3'}"
					><span
						class="absolute top-1 h-6 w-6 rounded-full bg-surface shadow transition-all {app.aiEnabled
							? 'left-7'
							: 'left-1'}"
					></span></span
				>
			</button>
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
		<h3 class="mt-5 mb-2 font-semibold">Soort lijst en looproute</h3>
		<div class="space-y-2">
			{#each app.lists as l (l.id)}
				<ListSettings list={l} />
			{/each}
		</div>
	</section>

	<section aria-labelledby="cats-title">
		<h2 id="cats-title" class="mb-1 text-lg font-bold">Categorieën</h2>
		<p class="mb-3 text-sm text-muted">
			De standaardvolgorde bij “Per categorie”. Per lijst kun je hierboven een eigen looproute
			instellen.
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
				href="/beheer/gegevens"
				class="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 py-3 font-semibold shadow-card active:bg-surface-2"
				data-testid="open-gegevens"
			>
				<Icon name="upload" size={20} class="shrink-0 text-accent" />
				<span class="min-w-0 flex-1">
					<span class="block">Importeren &amp; exporteren</span>
					<span class="block text-sm font-normal text-muted"
						>{app.aiEnabled ? 'JSON, CSV, ZIP en AI-analyse' : 'JSON, CSV en ZIP'}</span
					>
				</span>
				<Icon name="arrowRight" size={18} class="shrink-0 text-faint" />
			</a>
			<button
				type="button"
				class="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 text-left font-semibold shadow-card active:bg-surface-2"
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
