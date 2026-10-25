<script lang="ts">
	import Icon from './Icon.svelte';
	import type { Product } from '$lib/shared/types';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';

	let { product }: { product: Product } = $props();

	const url = $derived(app.photoUrl(product.photoId));
	const pending = $derived(app.photoPending(product.photoId));
	let busy = $state(false);
	let camera: HTMLInputElement | undefined = $state();
	let picker: HTMLInputElement | undefined = $state();

	async function onfile(e: Event & { currentTarget: HTMLInputElement }) {
		const file = e.currentTarget.files?.[0];
		e.currentTarget.value = '';
		if (!file) return;
		busy = true;
		try {
			await app.setPhoto(product, file);
		} finally {
			busy = false;
		}
	}

	async function remove() {
		const ok = await ui.confirm({
			title: 'Foto verwijderen?',
			message: 'De foto verdwijnt bij dit product. Je kunt dit direct ongedaan maken.',
			confirmLabel: 'Verwijderen',
			danger: true
		});
		if (ok) app.removePhoto(product);
	}
</script>

<fieldset data-testid="photo-field">
	<legend class="mb-2 text-sm font-semibold text-muted">Foto (één per product)</legend>
	<input
		bind:this={camera}
		type="file"
		accept="image/*"
		capture="environment"
		class="sr-only"
		tabindex="-1"
		aria-hidden="true"
		onchange={onfile}
	/>
	<input
		bind:this={picker}
		type="file"
		accept="image/jpeg,image/png,image/webp"
		class="sr-only"
		tabindex="-1"
		aria-hidden="true"
		onchange={onfile}
		data-testid="photo-input"
	/>
	<div class="flex items-center gap-3">
		{#if url}
			<button
				type="button"
				class="shrink-0 overflow-hidden rounded-xl"
				aria-label="Foto vergroten"
				onclick={() => ui.openSheet('photo', { productId: product.id })}
			>
				<img src={url} alt="" class="h-16 w-16 object-cover" data-testid="photo-thumb" />
			</button>
		{/if}
		<div class="flex min-w-0 flex-1 flex-wrap gap-2">
			<button
				type="button"
				class="flex min-h-12 items-center gap-2 rounded-2xl border border-line px-3.5 font-semibold active:bg-surface-2 disabled:opacity-50"
				disabled={busy}
				onclick={() => camera?.click()}
			>
				<Icon name="camera" size={20} class="text-accent" />
				{url ? 'Nieuwe foto' : 'Foto maken'}
			</button>
			<button
				type="button"
				class="flex min-h-12 items-center gap-2 rounded-2xl border border-line px-3.5 font-semibold active:bg-surface-2 disabled:opacity-50"
				disabled={busy}
				onclick={() => picker?.click()}
				data-testid="photo-pick"
			>
				<Icon name="upload" size={20} class="text-accent" />
				{url ? 'Vervangen' : 'Kies bestand'}
			</button>
			{#if url}
				<button
					type="button"
					class="flex min-h-12 items-center gap-2 rounded-2xl px-3.5 font-semibold text-danger active:bg-danger-soft"
					onclick={remove}
					data-testid="photo-remove"
				>
					<Icon name="trash" size={20} /> Verwijderen
				</button>
			{/if}
		</div>
	</div>
	{#if busy}
		<p class="mt-2 text-sm text-muted">Foto verkleinen…</p>
	{:else if pending === 'waiting'}
		<p class="mt-2 text-sm text-muted" data-testid="photo-pending">
			Nog niet gedeeld: wordt verstuurd zodra er verbinding is.
		</p>
	{:else if pending === 'failed'}
		<p class="mt-2 text-sm text-danger">Deze foto werd geweigerd. Kies een andere foto.</p>
	{/if}
</fieldset>
