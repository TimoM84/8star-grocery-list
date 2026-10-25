<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ImportPanel from '$lib/components/ImportPanel.svelte';
	import Icon, { type IconName } from '$lib/components/Icon.svelte';

	const exports: { href: string; label: string; detail: string; icon: IconName; testid: string }[] =
		[
			{
				href: '/api/export?format=backup',
				label: 'Volledige back-up met foto’s (ZIP)',
				detail:
					'Alle gegevens plus productfoto’s. Het beste bestand om alles terug te zetten via Importeren.',
				icon: 'database',
				testid: 'export-backup'
			},
			{
				href: '/api/export?format=json',
				label: 'Volledige export (JSON)',
				detail:
					'Alle gegevens met geschiedenis, id’s en tijden, maar zonder de foto’s zelf. Terug te zetten via Importeren.',
				icon: 'database',
				testid: 'export-json'
			},
			{
				href: '/api/export?format=zip',
				label: 'Alles als CSV (ZIP)',
				detail:
					'Aankopen, producten, statistieken, lijsten en categorieën als losse CSV-bestanden.',
				icon: 'download',
				testid: 'export-zip'
			},
			{
				href: '/api/export?format=csv&type=purchases',
				label: 'Aankopen (CSV)',
				detail: 'Elke aankoop met product, lijst, tijden en hoeveelheid.',
				icon: 'download',
				testid: 'export-csv'
			},
			{
				href: '/api/export?format=csv&type=products',
				label: 'Producten (CSV)',
				detail: 'Alle producten met categorie en favoriet.',
				icon: 'download',
				testid: 'export-products-csv'
			},
			{
				href: '/api/export?format=csv&type=statistics',
				label: 'Statistieken (CSV)',
				detail: 'Aantal keer gekocht, gemiddeld interval en verwachte volgende aankoop.',
				icon: 'download',
				testid: 'export-statistics-csv'
			}
		];

	const kinds = [
		{
			id: 'json' as const,
			label: 'Volledige export of back-up',
			accept: '.json,application/json,.zip,application/zip',
			hint: 'Een JSON-export of back-up-ZIP van 8star (ook van v1.0 en v1.1). Samenvoegen of alles vervangen. Foto’s komen alleen mee uit de back-up-ZIP.'
		},
		{
			id: 'products-csv' as const,
			label: 'Producten (CSV)',
			accept: '.csv,text/csv,text/plain',
			hint: 'Kolommen: product (verplicht), categorie, favoriet (ja/nee), product_id. Scheidingsteken ; of ,'
		},
		{
			id: 'purchases-csv' as const,
			label: 'Aankopen (CSV)',
			accept: '.csv,text/csv,text/plain',
			hint: 'Kolommen: product en gekocht (verplicht), aantal, eenheid, lijst, categorie, purchase_id. Datums als 2026-10-24T18:30:00Z of 24-10-2026 18:30.'
		}
	];
</script>

<svelte:head><title>Gegevens · 8star</title></svelte:head>

<header
	class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-2 backdrop-blur [@media(orientation:landscape)_and_(max-height:560px)]:static"
>
	<PageHeader title="Gegevens" subtitle="Importeren en exporteren">
		<a
			href="/beheer"
			class="-ml-2 inline-flex min-h-12 items-center gap-1 px-2 font-semibold text-accent"
			data-testid="back-to-beheer"
		>
			<Icon name="arrowRight" size={18} class="rotate-180" /> Beheer
		</a>
	</PageHeader>
</header>

<main class="px-safe mx-auto max-w-2xl space-y-8 pt-4">
	<section aria-labelledby="export-title">
		<h2 id="export-title" class="mb-3 text-lg font-bold">Exporteren</h2>
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

	<section aria-labelledby="ai-title" class="rounded-2xl bg-accent-soft/60 p-4">
		<h2 id="ai-title" class="mb-2 flex items-center gap-2 text-lg font-bold">
			<Icon name="brain" size={20} class="text-accent" /> Analyseren met AI
		</h2>
		<ol class="list-decimal space-y-1 pl-5 text-base">
			<li>Download de <strong>volledige export (JSON)</strong> hierboven.</li>
			<li>
				Geef die samen met de <strong>AI-opdracht</strong> aan ChatGPT, Claude of je eigen Python-script.
			</li>
			<li>Importeer het antwoord bij <strong>Suggesties → AI-suggesties</strong>.</li>
		</ol>
		<a
			href="/api/export?format=ai-prompt"
			download
			class="mt-3 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-surface px-4 font-semibold shadow-card active:bg-surface-2"
			data-testid="export-ai-prompt"
		>
			<Icon name="download" size={20} class="text-accent" /> AI-opdracht downloaden
		</a>
	</section>

	<section aria-labelledby="import-title" class="pb-4">
		<h2 id="import-title" class="mb-3 text-lg font-bold">Importeren</h2>
		<ImportPanel {kinds} testid="import" />
	</section>
</main>
