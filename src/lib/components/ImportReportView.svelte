<script lang="ts">
	import Icon from './Icon.svelte';
	import type { ImportReport } from '$lib/shared/transfer';

	let { report, testid }: { report: ImportReport; testid?: string } = $props();
	let showAll = $state(false);
	const LIMIT = 8;
	const title = $derived(
		!report.ok
			? 'Import geweigerd'
			: report.preview
				? report.mode === 'replace'
					? 'Voorbeeld: alles vervangen'
					: 'Voorbeeld'
				: 'Import voltooid'
	);
</script>

<div
	class="space-y-2 rounded-2xl p-4 {!report.ok
		? 'bg-danger-soft'
		: report.preview
			? 'bg-surface shadow-card'
			: 'bg-accent-soft'}"
	data-testid={testid}
	data-ok={report.ok}
>
	<h3 class="flex items-center gap-2 font-bold {report.ok ? '' : 'text-danger'}">
		<Icon name={report.ok ? (report.preview ? 'search' : 'check') : 'x'} size={18} />
		{title}
	</h3>
	<ul class="list-disc space-y-0.5 pl-5" data-testid="{testid}-summary">
		{#each report.summary as line (line)}
			<li class="[overflow-wrap:anywhere]">{line}</li>
		{/each}
	</ul>
	{#if report.backupFile}
		<p class="text-sm text-muted">Back-up vooraf: {report.backupFile}</p>
	{/if}
	{#each [{ items: report.errors, label: 'Fouten', cls: 'text-danger' }, { items: report.warnings, label: 'Let op', cls: 'text-warn' }] as group (group.label)}
		{#if group.items.length}
			<div>
				<p class="text-sm font-semibold {group.cls}">{group.label} ({group.items.length})</p>
				<ul
					class="space-y-0.5 text-sm"
					data-testid="{testid}-{group.label === 'Fouten' ? 'errors' : 'warnings'}"
				>
					{#each showAll ? group.items : group.items.slice(0, LIMIT) as m, i (i)}
						<li class="[overflow-wrap:anywhere]">{m}</li>
					{/each}
				</ul>
				{#if group.items.length > LIMIT && !showAll}
					<button
						type="button"
						class="min-h-12 text-sm font-semibold underline"
						onclick={() => (showAll = true)}>Toon alle {group.items.length}</button
					>
				{/if}
			</div>
		{/if}
	{/each}
</div>
