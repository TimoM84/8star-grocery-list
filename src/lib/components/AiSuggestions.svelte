<script lang="ts">
	import { flip } from 'svelte/animate';
	import { slide } from 'svelte/transition';
	import Icon from './Icon.svelte';
	import ImportPanel from './ImportPanel.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ms } from '$lib/client/motion';
	import { formatQuantity } from '$lib/shared/quantity';
	import { formatDate, relativeDay } from '$lib/client/format';

	let importing = $state(false);
	const recs = $derived(app.aiRecommendations);

	const kinds = [
		{
			id: 'ai' as const,
			label: 'AI-suggesties (JSON)',
			accept: '.json,application/json',
			hint: 'Een bestand in het formaat "8star-ai-recommendations" (zie Beheer → Gegevens → AI-opdracht).'
		}
	];
</script>

<section id="ai" aria-labelledby="ai-title" class="scroll-mt-28" data-testid="ai-section">
	<h2 id="ai-title" class="mb-1 flex items-center gap-2 text-lg font-bold">
		<Icon name="brain" size={20} class="text-accent" /> AI-suggesties
	</h2>
	<p class="mb-3 text-sm text-muted">
		Uit een extern AI-bestand (bijv. ChatGPT of Claude). Los van de eigen voorspellingen; er wordt
		nooit automatisch iets op de lijst gezet.
	</p>

	{#if recs.length}
		<ul class="mb-3 space-y-2" data-testid="ai-list">
			{#each recs as rec (rec.id)}
				{@const product = app.product(rec.productId)}
				{@const onList = product ? app.itemFor(product.id)?.status === 'active' : false}
				<li
					animate:flip={{ duration: ms(180) }}
					transition:slide={{ duration: ms(180) }}
					class="rounded-2xl bg-surface p-4 shadow-card"
					data-testid="ai-card"
					data-name={product?.name}
				>
					<div class="flex flex-wrap items-baseline gap-x-2 gap-y-1">
						<h3 class="text-[1.0625rem] font-semibold [overflow-wrap:anywhere]">
							{product?.name ?? 'Onbekend product'}
						</h3>
						{#if onList}<span class="text-sm font-medium text-accent">staat op de lijst</span>{/if}
					</div>
					<div class="mt-1.5 flex flex-wrap gap-1.5 text-sm" data-testid="ai-meta">
						{#if rec.suggestedQuantity !== null}
							<span class="rounded-full bg-accent-soft px-2.5 py-0.5 font-semibold text-accent"
								>{formatQuantity(rec.suggestedQuantity, rec.suggestedUnit)}</span
							>
						{/if}
						{#if rec.nextPurchaseAt !== null}
							<span class="rounded-full bg-surface-2 px-2.5 py-0.5"
								>nodig {relativeDay(rec.nextPurchaseAt, app.now)}</span
							>
						{/if}
						<span class="rounded-full bg-surface-2 px-2.5 py-0.5"
							>{Math.round(rec.confidence * 100)}% zeker</span
						>
						{#if rec.source}<span class="rounded-full bg-surface-2 px-2.5 py-0.5">{rec.source}</span
							>{/if}
					</div>
					<p class="mt-2 text-base [overflow-wrap:anywhere] text-muted" data-testid="ai-reasoning">
						{rec.reasoning}
					</p>
					<p class="mt-1 text-xs text-faint">Geïmporteerd {formatDate(rec.importedAt, app.now)}</p>
					<div class="mt-3 grid grid-cols-2 gap-2">
						<button
							type="button"
							class="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl bg-accent px-3 font-semibold text-on-accent active:bg-accent-strong"
							onclick={() => app.acceptRecommendation(rec)}
							data-testid="ai-accept"
						>
							<Icon name={onList ? 'check' : 'plus'} size={20} />
							{onList ? 'Afronden' : 'Toevoegen'}
						</button>
						<button
							type="button"
							class="flex min-h-12 items-center justify-center gap-1.5 rounded-2xl bg-surface-2 px-3 font-semibold active:bg-surface-3"
							onclick={() => app.dismissRecommendation(rec)}
							data-testid="ai-dismiss"
						>
							<Icon name="x" size={20} /> Negeren
						</button>
					</div>
				</li>
			{/each}
		</ul>
	{:else}
		<p class="mb-3 rounded-2xl bg-surface-2 px-4 py-4 text-muted" data-testid="ai-empty">
			Geen openstaande AI-suggesties.
		</p>
	{/if}

	{#if importing}
		<div class="rounded-2xl border border-line p-4">
			<ImportPanel {kinds} testid="ai-import" />
			<button
				type="button"
				class="mt-3 min-h-12 w-full rounded-2xl font-semibold text-muted active:bg-surface-2"
				onclick={() => (importing = false)}>Sluiten</button
			>
		</div>
	{:else}
		<button
			type="button"
			class="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-line bg-surface font-semibold active:bg-surface-2"
			onclick={() => (importing = true)}
			data-testid="ai-import-open"
		>
			<Icon name="upload" size={20} class="text-accent" /> AI-bestand importeren
		</button>
		<a
			href="/beheer/gegevens"
			class="mt-1 flex min-h-12 items-center justify-center text-sm font-semibold text-accent"
			>Hoe maak ik zo’n bestand?</a
		>
	{/if}
</section>
