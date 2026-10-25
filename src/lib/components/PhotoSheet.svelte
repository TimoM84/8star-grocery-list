<script lang="ts">
	import Sheet from './Sheet.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';

	const open = $derived(ui.isOpen('photo'));
	const productId = $derived(ui.data<{ productId: string }>('photo')?.productId ?? null);
	const product = $derived(productId ? app.product(productId) : undefined);
	const url = $derived(product ? app.photoUrl(product.photoId) : null);
	const pending = $derived(product ? app.photoPending(product.photoId) : null);
	let failed = $state(false);

	$effect(() => {
		void url;
		failed = false;
	});
</script>

<Sheet {open} title={product?.name ?? 'Foto'} onclose={() => ui.closeSheet()} testid="photo-sheet">
	{#if url && !failed}
		<img
			src={url}
			alt="Foto van {product?.name}"
			class="mx-auto max-h-[70dvh] w-auto rounded-2xl object-contain"
			onerror={() => (failed = true)}
			data-testid="photo-large"
		/>
	{:else}
		<p class="rounded-2xl bg-surface-2 px-4 py-6 text-center text-muted">
			Foto niet beschikbaar. Zonder verbinding zijn alleen eerder bekeken foto’s te zien.
		</p>
	{/if}
	{#if pending === 'waiting'}
		<p class="mt-2 text-sm text-muted">Nog niet gedeeld: wordt verstuurd zodra er verbinding is.</p>
	{:else if pending === 'failed'}
		<p class="mt-2 text-sm text-danger">
			De server weigerde deze foto. Zie Beheer → Synchronisatie.
		</p>
	{/if}
</Sheet>
