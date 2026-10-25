<script lang="ts">
	import { ms } from '$lib/client/motion';
	import { flip } from 'svelte/animate';
	import Icon from './Icon.svelte';
	import { m } from '$lib/client/i18n';

	interface Entry {
		id: string;
		name: string;
		detail?: string;
	}

	let {
		entries,
		addLabel,
		addPlaceholder,
		canDelete = () => true,
		onadd,
		onrename,
		onmove,
		ondelete,
		testid
	}: {
		entries: Entry[];
		addLabel: string;
		addPlaceholder: string;
		canDelete?: (e: Entry) => boolean;
		onadd: (name: string) => void;
		onrename: (id: string, name: string) => void;
		onmove: (id: string, delta: number) => void;
		ondelete: (id: string) => void;
		testid: string;
	} = $props();

	let editing = $state<string | null>(null);
	let draft = $state('');
	let newName = $state('');

	function startEdit(e: Entry) {
		editing = e.id;
		draft = e.name;
	}

	function commit() {
		if (editing && draft.trim()) onrename(editing, draft);
		editing = null;
	}
</script>

<ul class="space-y-2" data-testid={testid}>
	{#each entries as e, i (e.id)}
		<li
			animate:flip={{ duration: ms(180) }}
			class="flex items-stretch overflow-hidden rounded-2xl bg-surface shadow-card"
			data-testid="{testid}-row"
		>
			{#if editing === e.id}
				<form
					class="flex min-w-0 flex-1 items-center gap-2 p-1.5"
					onsubmit={(ev) => {
						ev.preventDefault();
						commit();
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={draft}
						maxlength="80"
						autofocus
						aria-label={m.ordered.newName}
						enterkeyhint="done"
						onblur={commit}
						class="h-12 min-w-0 flex-1 rounded-xl border border-accent bg-bg px-3 text-lg outline-none"
						data-testid="{testid}-rename-input"
					/>
				</form>
			{:else}
				<button
					type="button"
					class="flex min-h-14 min-w-0 flex-1 items-center gap-2 py-2 pl-4 text-left active:bg-surface-2"
					onclick={() => startEdit(e)}
					aria-label={m.ordered.rename(e.name)}
					data-testid="{testid}-name"
				>
					<span class="min-w-0 flex-1">
						<span class="block text-[1.0625rem] font-medium [overflow-wrap:anywhere]">{e.name}</span
						>
						{#if e.detail}<span class="block text-sm text-muted">{e.detail}</span>{/if}
					</span>
					<Icon name="pencil" size={16} class="shrink-0 text-faint" />
				</button>
				<button
					type="button"
					class="grid w-12 shrink-0 place-items-center text-muted active:bg-surface-2 disabled:opacity-25"
					aria-label={m.ordered.up(e.name)}
					disabled={i === 0}
					onclick={() => onmove(e.id, -1)}
					data-testid="{testid}-up"><Icon name="arrowUp" size={20} /></button
				>
				<button
					type="button"
					class="grid w-12 shrink-0 place-items-center text-muted active:bg-surface-2 disabled:opacity-25"
					aria-label={m.ordered.down(e.name)}
					disabled={i === entries.length - 1}
					onclick={() => onmove(e.id, 1)}
					data-testid="{testid}-down"><Icon name="arrowDown" size={20} /></button
				>
				<button
					type="button"
					class="grid w-12 shrink-0 place-items-center text-danger active:bg-danger-soft disabled:opacity-25"
					aria-label={m.ordered.remove(e.name)}
					disabled={!canDelete(e)}
					onclick={() => ondelete(e.id)}
					data-testid="{testid}-delete"><Icon name="trash" size={20} /></button
				>
			{/if}
		</li>
	{/each}
</ul>
<form
	class="mt-3 flex gap-2"
	onsubmit={(ev) => {
		ev.preventDefault();
		if (newName.trim()) {
			onadd(newName);
			newName = '';
		}
	}}
>
	<input
		bind:value={newName}
		maxlength="80"
		placeholder={addPlaceholder}
		aria-label={addPlaceholder}
		enterkeyhint="done"
		class="h-13 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-lg outline-none focus:border-accent"
		data-testid="{testid}-new"
	/>
	<button
		type="submit"
		class="flex min-h-13 shrink-0 items-center gap-1 rounded-2xl bg-accent px-4 font-semibold text-on-accent"
		data-testid="{testid}-add"
	>
		<Icon name="plus" size={20} stroke={2.5} />{addLabel}
	</button>
</form>
