<script lang="ts">
	import { app } from '$lib/client/app.svelte';
	import { m } from '$lib/client/i18n';

	const s = $derived(app.status);
	const state = $derived(
		s.connection === 'offline'
			? 'offline'
			: s.syncing || (s.pending > 0 && s.connection === 'online')
				? 'syncing'
				: s.connection === 'connecting'
					? 'connecting'
					: 'online'
	);
	const label = $derived(
		state === 'offline'
			? s.pending > 0
				? `${m.syncBadge.offline} · ${s.pending}`
				: m.syncBadge.offline
			: state === 'syncing'
				? m.syncBadge.syncing
				: state === 'connecting'
					? m.syncBadge.connecting
					: m.syncBadge.live
	);
	const title = $derived(
		state === 'offline'
			? m.syncBadge.offlineTitle(s.pending)
			: state === 'online'
				? m.syncBadge.onlineTitle
				: m.syncBadge.syncingTitle
	);
</script>

<a
	href="/beheer#sync"
	class="flex min-h-12 shrink-0 items-center"
	{title}
	aria-label={title}
	data-testid="sync-badge"
	data-state={state}
>
	<span
		class="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[min(0.875rem,4vw)] font-semibold whitespace-nowrap {state ===
		'offline'
			? 'bg-warn-soft text-warn'
			: state === 'online'
				? 'bg-accent-soft text-accent'
				: 'bg-surface-2 text-muted'}"
	>
		<span
			class="h-2 w-2 rounded-full {state === 'offline'
				? 'bg-warn'
				: state === 'online'
					? 'bg-accent'
					: 'animate-pulse bg-faint'}"
		></span>
		{label}
	</span>
</a>
