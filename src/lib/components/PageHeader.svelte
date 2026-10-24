<script lang="ts">
	import type { Snippet } from 'svelte';
	import Logo from './Logo.svelte';
	import SyncBadge from './SyncBadge.svelte';

	let { title, subtitle, children }: { title: string; subtitle?: string; children?: Snippet } =
		$props();
</script>

<div class="px-safe mx-auto flex min-h-14 max-w-2xl items-center gap-3 pt-1">
	<Logo size={34} />
	<div class="min-w-0 flex-1">
		<h1
			class="text-[min(1.25rem,5.4vw)] leading-tight font-bold tracking-tight [overflow-wrap:anywhere]"
			data-testid="page-title"
		>
			{title}
		</h1>
		{#if subtitle}
			<p class="text-[min(0.875rem,4.2vw)] leading-tight text-muted" data-testid="page-subtitle">
				{subtitle}
			</p>
		{/if}
	</div>
	<SyncBadge />
</div>
{#if children}
	<div class="px-safe mx-auto max-w-2xl">{@render children()}</div>
{/if}
