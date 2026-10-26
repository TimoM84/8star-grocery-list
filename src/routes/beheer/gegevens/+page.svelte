<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ImportPanel from '$lib/components/ImportPanel.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { m } from '$lib/client/i18n';

	const exports = $derived<
		{ href: string; label: string; detail: string; icon: IconName; testid: string }[]
	>([
		{
			href: '/api/export?format=backup',
			label: m.data.backupLabel,
			detail: m.data.backupDetail,
			icon: 'database',
			testid: 'export-backup'
		},
		{
			href: '/api/export?format=json',
			label: m.data.jsonLabel,
			detail: m.data.jsonDetail,
			icon: 'database',
			testid: 'export-json'
		},
		{
			href: '/api/export?format=zip',
			label: m.data.zipLabel,
			detail: m.data.zipDetail,
			icon: 'download',
			testid: 'export-zip'
		},
		{
			href: '/api/export?format=csv&type=purchases',
			label: m.data.purchasesLabel,
			detail: m.data.purchasesDetail,
			icon: 'download',
			testid: 'export-csv'
		},
		{
			href: '/api/export?format=csv&type=products',
			label: m.data.productsLabel,
			detail: m.data.productsDetail,
			icon: 'download',
			testid: 'export-products-csv'
		},
		{
			href: '/api/export?format=csv&type=statistics',
			label: m.data.statisticsLabel,
			detail: m.data.statisticsDetail,
			icon: 'download',
			testid: 'export-statistics-csv'
		}
	]);

	const kinds = $derived([
		{
			id: 'json' as const,
			label: m.data.importJsonLabel,
			accept: '.json,application/json,.zip,application/zip',
			hint: m.data.importJsonHint
		},
		{
			id: 'products-csv' as const,
			label: m.data.productsLabel,
			accept: '.csv,text/csv,text/plain',
			hint: m.data.importProductsHint
		},
		{
			id: 'purchases-csv' as const,
			label: m.data.purchasesLabel,
			accept: '.csv,text/csv,text/plain',
			hint: m.data.importPurchasesHint
		}
	]);
</script>

<svelte:head><title>{m.settings.data} · 8star</title></svelte:head>

<header
	class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-2 backdrop-blur [@media(orientation:landscape)_and_(max-height:560px)]:static"
>
	<PageHeader title={m.settings.data} subtitle={m.data.subtitle}>
		<a
			href="/beheer"
			class="-ml-2 inline-flex min-h-12 items-center gap-1 px-2 font-semibold text-accent"
			data-testid="back-to-beheer"
		>
			<Icon name="arrowRight" size={18} class="rotate-180" />
			{m.nav.settings}
		</a>
	</PageHeader>
</header>

<main class="px-safe mx-auto max-w-2xl space-y-8 pt-4">
	<section aria-labelledby="export-title">
		<h2 id="export-title" class="mb-3 text-lg font-bold">{m.data.export}</h2>
		<ul class="space-y-2">
			{#each exports as e (e.href)}
				<li>
					<a
						href={e.href}
						download
						class="flex min-h-14 items-center gap-3 rounded-2xl bg-surface px-4 py-3 shadow-card active:bg-surface-2"
						data-testid={e.testid}
					>
						<Icon name={e.icon} size={22} class="shrink-0 text-accent" />
						<span class="min-w-0 flex-1">
							<span class="block font-semibold">{e.label}</span>
							<span class="block text-sm text-muted">{e.detail}</span>
						</span>
					</a>
				</li>
			{/each}
		</ul>
	</section>

	{#if app.suggestionsEnabled}
		<section aria-labelledby="ai-title" class="rounded-2xl bg-accent-soft/60 p-4">
			<h2 id="ai-title" class="mb-2 flex items-center gap-2 text-lg font-bold">
				<Icon name="brain" size={20} class="text-accent" />
				{m.data.aiTitle}
			</h2>
			<ol class="list-decimal space-y-1 pl-5 text-base">
				<li>{m.data.aiStep1[0]}<strong>{m.data.aiStep1[1]}</strong>{m.data.aiStep1[2]}</li>
				<li>{m.data.aiStep2[0]}<strong>{m.data.aiStep2[1]}</strong>{m.data.aiStep2[2]}</li>
				<li>{m.data.aiStep3[0]}<strong>{m.data.aiStep3[1]}</strong>{m.data.aiStep3[2]}</li>
			</ol>
			<a
				href="/api/export?format=ai-prompt"
				download
				class="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-4 font-semibold shadow-card active:bg-surface-2"
				data-testid="export-ai-prompt"
			>
				<Icon name="download" size={20} class="text-accent" />
				{m.data.aiDownload}
			</a>
		</section>
	{/if}

	<section aria-labelledby="import-title" class="pb-4">
		<h2 id="import-title" class="mb-3 text-lg font-bold">{m.data.import}</h2>
		<ImportPanel {kinds} testid="import" />
	</section>
</main>
