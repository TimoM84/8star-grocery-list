<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import ProductRow from '$lib/components/ProductRow.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { favorites, frequent } from '$lib/shared/selectors';
	import { formatInterval, relativeDay } from '$lib/client/format';
	import { MIN_HISTORY } from '$lib/shared/stats';

	const favs = $derived(favorites(app.products));
	const freq = $derived(frequent(app.products, 15));
</script>

<svelte:head><title>Suggesties · 8star</title></svelte:head>

<header
	class="pt-safe sticky top-0 z-20 border-b border-line/60 bg-bg/95 pb-2 backdrop-blur [@media(orientation:landscape)_and_(max-height:560px)]:static"
>
	<PageHeader title="Suggesties" subtitle="Toevoegen aan {app.currentList?.name ?? 'lijst'}">
		{#if app.lists.length > 1}
			<div class="mt-1 flex flex-wrap gap-2" role="radiogroup" aria-label="Lijst kiezen">
				{#each app.lists as l (l.id)}
					<button
						type="button"
						role="radio"
						aria-checked={l.id === app.listId}
						class="min-h-12 rounded-full border px-4 text-base font-semibold {l.id === app.listId
							? 'border-ink bg-ink text-bg'
							: 'border-line bg-surface'}"
						onclick={() => app.selectList(l.id)}>{l.name}</button
					>
				{/each}
			</div>
		{/if}
	</PageHeader>
</header>

<main class="px-safe mx-auto max-w-2xl space-y-7 pt-4">
	<section aria-labelledby="maybe" data-testid="suggestions-section">
		<h2 id="maybe" class="mb-1 flex items-center gap-2 text-lg font-bold">
			<Icon name="sparkles" size={20} class="text-accent" /> Misschien nodig
		</h2>
		<p class="mb-3 text-sm text-muted">
			Op basis van hoe vaak je iets koopt. Er wordt nooit automatisch iets toegevoegd.
		</p>
		{#if app.suggestions.length === 0}
			<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted" data-testid="no-suggestions">
				Nog geen suggesties. Na minstens {MIN_HISTORY} aankopen van een product voorspellen we wanneer
				je het weer nodig hebt.
			</p>
		{:else}
			<ul class="space-y-2">
				{#each app.suggestions as s (s.product.id)}
					<li>
						<ProductRow
							view={s}
							detail="{formatInterval(s.stats.avgIntervalDays)} · laatst {relativeDay(
								s.stats.lastPurchasedAt,
								app.now
							)} · verwacht {relativeDay(s.stats.nextEstimatedAt, app.now)}"
						>
							{#snippet extra()}
								<button
									type="button"
									class="grid w-12 shrink-0 place-items-center text-faint active:bg-surface-2"
									aria-label="{s.product.name} nu niet voorstellen"
									title="Niet nu"
									onclick={() => app.snooze(s)}
									data-testid="snooze"
								>
									<Icon name="x" size={20} />
								</button>
							{/snippet}
						</ProductRow>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="favs" data-testid="favorites-section">
		<h2 id="favs" class="mb-3 flex items-center gap-2 text-lg font-bold">
			<Icon name="star" size={20} filled class="text-star" /> Favorieten
		</h2>
		{#if favs.length === 0}
			<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted">
				Markeer producten met de ster om ze hier snel terug te vinden.
			</p>
		{:else}
			<ul class="space-y-2">
				{#each favs as f (f.product.id)}
					<li>
						<ProductRow
							view={f}
							detail={f.status === 'active'
								? 'Staat op de lijst'
								: f.stats.purchaseCount
									? `${f.stats.purchaseCount}× gekocht`
									: undefined}
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>

	<section aria-labelledby="freq" data-testid="frequent-section">
		<h2 id="freq" class="mb-3 flex items-center gap-2 text-lg font-bold">
			<Icon name="history" size={20} class="text-muted" /> Vaak gekocht
		</h2>
		{#if freq.length === 0}
			<p class="rounded-2xl bg-surface-2 px-4 py-4 text-muted">
				Hier verschijnen je meest gekochte producten.
			</p>
		{:else}
			<ul class="space-y-2">
				{#each freq as f (f.product.id)}
					<li>
						<ProductRow
							view={f}
							detail="{f.stats.purchaseCount}× gekocht · laatst {relativeDay(
								f.stats.lastPurchasedAt,
								app.now
							)}"
						/>
					</li>
				{/each}
			</ul>
		{/if}
	</section>
</main>
