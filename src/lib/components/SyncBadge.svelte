<script lang="ts">
	import { app } from '$lib/client/app.svelte';

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
				? `Offline · ${s.pending}`
				: 'Offline'
			: state === 'syncing'
				? 'Sync…'
				: state === 'connecting'
					? 'Verbinden'
					: 'Live'
	);
	const title = $derived(
		state === 'offline'
			? `Geen verbinding met de server. ${s.pending} wijziging(en) wachten en worden automatisch verstuurd.`
			: state === 'online'
				? 'Verbonden: wijzigingen worden direct gedeeld.'
				: 'Bezig met synchroniseren.'
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
