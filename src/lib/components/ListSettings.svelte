<script lang="ts">
	import Icon from './Icon.svelte';
	import type { List, ListKind } from '$lib/shared/types';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { routeCategories } from '$lib/shared/planning';
	import { m } from '$lib/client/i18n';

	let { list }: { list: List } = $props();

	let routeOpen = $state(false);
	const route = $derived(routeCategories(app.view?.categories ?? [], list));

	async function setKind(kind: ListKind) {
		if (kind === list.kind) return;
		const ok = await ui.confirm({
			title:
				kind === 'checklist'
					? m.listSettings.toChecklistTitle(list.name)
					: m.listSettings.toGroceryTitle(list.name),
			message:
				kind === 'checklist' ? m.listSettings.toChecklistMessage : m.listSettings.toGroceryMessage,
			confirmLabel: kind === 'checklist' ? m.listSettings.toChecklist : m.listSettings.toGrocery
		});
		if (ok) app.setListKind(list, kind);
	}

	function move(index: number, delta: number) {
		const ids = route.map((c) => c.id);
		const j = index + delta;
		if (j < 0 || j >= ids.length) return;
		[ids[index], ids[j]] = [ids[j], ids[index]];
		app.setCategoryOrder(list, ids);
	}
</script>

<div
	class="rounded-2xl bg-surface p-3 shadow-card"
	data-testid="list-settings"
	data-name={list.name}
>
	<p class="px-1 pb-2 font-semibold [overflow-wrap:anywhere]">{list.name}</p>
	<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.listSettings.kind(list.name)}>
		{#each [{ id: 'grocery', label: m.listSettings.grocery }, { id: 'checklist', label: m.listSettings.checklist }] as k (k.id)}
			<button
				type="button"
				role="radio"
				aria-checked={list.kind === k.id}
				class="min-h-12 grow rounded-2xl border px-3 font-semibold {list.kind === k.id
					? 'border-ink bg-ink text-bg'
					: 'border-line bg-surface'}"
				onclick={() => setKind(k.id as ListKind)}
				data-testid="list-kind-{k.id}">{k.label}</button
			>
		{/each}
	</div>
	{#if list.kind === 'grocery'}
		<button
			type="button"
			class="mt-2 flex min-h-12 w-full items-center gap-2 rounded-2xl px-2 text-left font-semibold"
			aria-expanded={routeOpen}
			onclick={() => (routeOpen = !routeOpen)}
			data-testid="route-toggle"
		>
			<span class="flex-1">{m.listSettings.route}</span>
			<span class="text-sm font-normal text-muted"
				>{list.categoryOrder ? m.listSettings.customOrder : m.listSettings.defaultOrder}</span
			>
			<Icon name={routeOpen ? 'chevronUp' : 'chevronDown'} class="text-faint" />
		</button>
		{#if routeOpen}
			<p class="px-2 pb-2 text-sm text-muted">
				{m.listSettings.routeHelp}
			</p>
			<ol class="space-y-1" data-testid="route-list">
				{#each route as c, i (c.id)}
					<li class="flex items-center gap-1 rounded-xl bg-surface-2 pl-3">
						<span class="min-w-0 flex-1 py-2 [overflow-wrap:anywhere]">{c.name}</span>
						<button
							type="button"
							class="grid h-12 w-12 place-items-center disabled:opacity-30"
							aria-label={m.listSettings.earlier(c.name)}
							disabled={i === 0}
							onclick={() => move(i, -1)}
							data-testid="route-up"><Icon name="arrowUp" size={20} /></button
						>
						<button
							type="button"
							class="grid h-12 w-12 place-items-center disabled:opacity-30"
							aria-label={m.listSettings.later(c.name)}
							disabled={i === route.length - 1}
							onclick={() => move(i, 1)}
							data-testid="route-down"><Icon name="arrowDown" size={20} /></button
						>
					</li>
				{/each}
			</ol>
			{#if list.categoryOrder}
				<button
					type="button"
					class="mt-2 min-h-12 w-full rounded-2xl text-sm font-semibold text-muted active:bg-surface-2"
					onclick={() => app.setCategoryOrder(list, null)}
					data-testid="route-reset">{m.listSettings.useDefault}</button
				>
			{/if}
		{/if}
	{:else}
		<p class="mt-2 px-1 text-sm text-muted">
			{m.listSettings.checklistHelp}
		</p>
	{/if}
</div>
