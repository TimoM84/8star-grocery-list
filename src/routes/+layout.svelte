<script lang="ts">
	import '../app.css';
	import { onMount, type Snippet } from 'svelte';
	import { page } from '$app/state';
	import { app } from '$lib/client/app.svelte';
	import { pwa } from '$lib/client/pwa.svelte';
	import BottomNav from '$lib/components/BottomNav.svelte';
	import ToastHost from '$lib/components/ToastHost.svelte';
	import ConfirmHost from '$lib/components/ConfirmHost.svelte';
	import ItemSheet from '$lib/components/ItemSheet.svelte';
	import ProductSheet from '$lib/components/ProductSheet.svelte';
	import AddPromptSheet from '$lib/components/AddPromptSheet.svelte';
	import BulkAddSheet from '$lib/components/BulkAddSheet.svelte';
	import PhotoSheet from '$lib/components/PhotoSheet.svelte';
	import BundleSheet from '$lib/components/BundleSheet.svelte';
	import BundleAddSheet from '$lib/components/BundleAddSheet.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { m } from '$lib/client/i18n';

	let { children }: { children: Snippet } = $props();

	// While a sheet or dialog is open the page behind it is inert (no focus, no taps, no AT).
	const modalOpen = $derived(!!page.state.sheet || !!page.state.confirm);

	// The document language follows the household language (screen readers, hyphenation).
	$effect(() => {
		document.documentElement.lang = app.language;
	});

	onMount(() => {
		app.start();
		pwa.init();

		// Hide the bottom navigation while the on-screen keyboard is open so content keeps room.
		// A focused input alone is not enough: Android can hide the keyboard (back gesture)
		// without blurring the field, so we also require the viewport to have shrunk.
		const isTextField = (el: Element | null) =>
			el instanceof HTMLInputElement &&
			!['button', 'checkbox', 'radio', 'submit'].includes(el.type);
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- intentionally non-reactive
		const maxHeight = new Map<string, number>();
		const update = () => {
			const vv = window.visualViewport;
			const height = vv ? vv.height : window.innerHeight;
			const key =
				window.innerWidth > window.screen.height ? 'landscape' : String(window.innerWidth);
			const max = Math.max(maxHeight.get(key) ?? 0, height);
			maxHeight.set(key, max);
			const keyboard = isTextField(document.activeElement) && height < max - 120;
			document.documentElement.classList.toggle('kb-open', keyboard);
		};
		const deferred = () => setTimeout(update, 60);
		window.visualViewport?.addEventListener('resize', update);
		window.addEventListener('resize', update);
		document.addEventListener('focusin', deferred);
		document.addEventListener('focusout', deferred);
		update();
		return () => {
			window.visualViewport?.removeEventListener('resize', update);
			window.removeEventListener('resize', update);
			document.removeEventListener('focusin', deferred);
			document.removeEventListener('focusout', deferred);
		};
	});
</script>

{#if pwa.updateReady}
	<div class="pt-safe fixed inset-x-0 top-0 z-50">
		<div
			class="mx-3 mt-2 flex max-w-xl items-center gap-2 rounded-2xl bg-ink py-1 pr-1 pl-4 text-bg shadow-card sm:mx-auto"
		>
			<Icon name="refresh" size={20} />
			<span class="min-w-0 flex-1 py-2">{m.shell.updateReady}</span>
			<button
				type="button"
				class="min-h-12 rounded-xl bg-accent px-4 font-semibold text-on-accent"
				onclick={() => pwa.applyUpdate()}
				data-testid="update-button">{m.shell.update}</button
			>
		</div>
	</div>
{/if}

<div class="page-bottom-space min-h-dvh" inert={modalOpen}>
	{#if app.status.ready}
		{@render children()}
	{:else}
		<div class="px-safe grid min-h-[70dvh] place-items-center text-center" data-testid="loading">
			<div>
				<div
					class="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-surface-3 border-t-accent"
				></div>
				<p class="mt-4 text-muted">
					{app.status.connection === 'offline' ? m.shell.offlineNoData : m.shell.loading}
				</p>
			</div>
		</div>
	{/if}
</div>

<div inert={modalOpen}>
	<BottomNav />
</div>
<ToastHost />
<ItemSheet />
<ProductSheet />
<AddPromptSheet />
<BulkAddSheet />
<BundleSheet />
<BundleAddSheet />
<PhotoSheet />
<ConfirmHost />
