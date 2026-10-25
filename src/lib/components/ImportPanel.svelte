<script lang="ts">
	import Icon from './Icon.svelte';
	import ImportReportView from './ImportReportView.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { uploadImport } from '$lib/client/transfer';
	import { m } from '$lib/client/i18n';
	import type { ImportKind, ImportReport } from '$lib/shared/transfer';

	interface KindOption {
		id: ImportKind;
		label: string;
		accept: string;
		hint: string;
	}

	let {
		kinds,
		testid = 'import'
	}: {
		kinds: KindOption[];
		testid?: string;
	} = $props();

	let selected = $state<ImportKind | null>(null);
	const kind = $derived(selected ?? kinds[0].id);
	let file = $state<File | null>(null);
	let preview = $state<ImportReport | null>(null);
	let result = $state<ImportReport | null>(null);
	let failure = $state<string | null>(null);
	let busy = $state(false);
	let input: HTMLInputElement | undefined = $state();

	const option = $derived(kinds.find((k) => k.id === kind) ?? kinds[0]);
	const offline = $derived(app.status.connection === 'offline');
	const canReplace = $derived(kind === 'json');

	function reset() {
		file = null;
		preview = null;
		result = null;
		failure = null;
		if (input) input.value = '';
	}

	function chooseKind(k: ImportKind) {
		if (k === kind) return;
		selected = k;
		reset();
	}

	async function onFile(e: Event & { currentTarget: HTMLInputElement }) {
		const f = e.currentTarget.files?.[0];
		if (!f) return;
		reset();
		file = f;
		busy = true;
		const r = await uploadImport(kind, 'merge', f, true);
		busy = false;
		if ('failure' in r) failure = r.failure;
		else preview = r.report;
	}

	/** Queued changes of this device go to the server before any import. */
	async function ensureFlushed(): Promise<boolean> {
		if (await app.flushPending()) return true;
		failure = m.importPanel.pending(app.status.pending);
		return false;
	}

	async function merge() {
		if (!file) return;
		busy = true;
		failure = null;
		if (await ensureFlushed()) {
			const r = await uploadImport(kind, 'merge', file, false);
			if ('failure' in r) failure = r.failure;
			else {
				result = r.report;
				if (r.report.ok) preview = null;
			}
			app.syncNow();
		}
		busy = false;
	}

	async function replace() {
		if (!file) return;
		busy = true;
		failure = null;
		const p = await uploadImport(kind, 'replace', file, true);
		busy = false;
		if ('failure' in p) {
			failure = p.failure;
			return;
		}
		if (!p.report.ok) {
			preview = p.report;
			return;
		}
		const ok = await ui.confirm({
			title: m.importPanel.replaceTitle,
			message: m.importPanel.replaceMessage(p.report.summary.join('. ')),
			confirmLabel: m.importPanel.replaceAll,
			danger: true
		});
		if (!ok) return;
		busy = true;
		if (await ensureFlushed()) {
			const r = await uploadImport(kind, 'replace', file, false);
			if ('failure' in r) failure = r.failure;
			else {
				result = r.report;
				if (r.report.ok) preview = null;
			}
			app.syncNow();
		}
		busy = false;
	}
</script>

<div class="space-y-4" data-testid={testid}>
	{#if kinds.length > 1}
		<div class="flex flex-wrap gap-2" role="radiogroup" aria-label={m.importPanel.kind}>
			{#each kinds as k (k.id)}
				<button
					type="button"
					role="radio"
					aria-checked={kind === k.id}
					class="min-h-12 rounded-full border px-4 text-base font-medium {kind === k.id
						? 'border-ink bg-ink text-bg'
						: 'border-line bg-surface'}"
					onclick={() => chooseKind(k.id)}
					data-testid="{testid}-kind-{k.id}">{k.label}</button
				>
			{/each}
		</div>
	{/if}
	<p class="text-sm text-muted">{option.hint}</p>

	{#if offline}
		<p class="flex items-center gap-2 rounded-2xl bg-warn-soft px-4 py-3 text-sm text-warn">
			<Icon name="cloudOff" size={18} class="shrink-0" />
			{m.importPanel.offlineHint}
		</p>
	{/if}

	<label
		class="flex min-h-13 cursor-pointer items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-surface px-4 text-base font-semibold active:bg-surface-2 {offline
			? 'pointer-events-none opacity-50'
			: ''}"
	>
		<Icon name="upload" size={20} class="text-accent" />
		<span class="[overflow-wrap:anywhere]">{file ? file.name : m.importPanel.choose}</span>
		<input
			bind:this={input}
			type="file"
			accept={option.accept}
			class="sr-only"
			disabled={offline || busy}
			onchange={onFile}
			data-testid="{testid}-file"
		/>
	</label>

	{#if busy}
		<p class="text-muted" role="status">{m.importPanel.busy}</p>
	{/if}
	{#if failure}
		<p
			class="rounded-2xl bg-danger-soft px-4 py-3 text-danger"
			role="alert"
			data-testid="{testid}-failure"
		>
			{failure}
		</p>
	{/if}

	{#if preview}
		<ImportReportView report={preview} testid="{testid}-preview" />
		{#if preview.ok}
			<div class="grid gap-2 {canReplace ? 'sm:grid-cols-2' : ''}">
				<button
					type="button"
					class="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-accent px-4 text-base font-semibold text-on-accent active:bg-accent-strong disabled:opacity-50"
					disabled={busy || offline}
					onclick={merge}
					data-testid="{testid}-merge"
				>
					<Icon name="plus" size={20} />
					{kind === 'ai' ? m.importPanel.import : m.importPanel.merge}
				</button>
				{#if canReplace}
					<button
						type="button"
						class="flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-danger/50 px-4 text-base font-semibold text-danger active:bg-danger-soft disabled:opacity-50"
						disabled={busy || offline}
						onclick={replace}
						data-testid="{testid}-replace"
					>
						<Icon name="refresh" size={20} />
						{m.importPanel.replaceAll}
					</button>
				{/if}
			</div>
			{#if kind !== 'ai'}
				<p class="text-sm text-muted">
					<strong>{m.importPanel.merge}</strong>
					{m.importPanel.mergeHelp}{#if canReplace}
						<strong> {m.importPanel.replaceAll}</strong> {m.importPanel.replaceHelp}{/if}
				</p>
			{/if}
		{/if}
	{/if}

	{#if result}
		<ImportReportView report={result} testid="{testid}-result" />
		<button
			type="button"
			class="min-h-12 w-full rounded-2xl bg-surface-2 font-semibold active:bg-surface-3"
			onclick={reset}>{m.importPanel.another}</button
		>
	{/if}
</div>
