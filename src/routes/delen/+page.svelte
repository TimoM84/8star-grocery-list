<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { ui } from '$lib/client/ui.svelte';
	import { m } from '$lib/client/i18n';

	/**
	 * Web Share Target (see manifest): text shared from another app opens the "Meerdere
	 * toevoegen" preview. Nothing is added without confirmation and links are never fetched.
	 */
	onMount(async () => {
		const params = page.url.searchParams;
		const title = (params.get('title') ?? '').trim();
		const body = (params.get('text') ?? '').trim();
		const url = (params.get('url') ?? '').trim();
		// Some apps put the shared text in "title", others put a link in "text".
		const text = [title && !body.includes(title) ? title : '', body]
			.filter(Boolean)
			.join('\n')
			.split('\n')
			.filter((l) => !/^https?:\/\/\S+$/i.test(l.trim()))
			.join('\n');
		await goto('/', { replaceState: true });
		ui.openSheet('bulk', { text, source: 'share', url: url || undefined });
	});
</script>

<svelte:head><title>{m.share.title} · 8star</title></svelte:head>

<p class="px-safe pt-10 text-center text-muted">{m.share.opening}</p>
