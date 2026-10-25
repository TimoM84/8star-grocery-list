<script lang="ts">
	import { ms } from '$lib/client/motion';
	import type { Snippet } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import Icon from './Icon.svelte';
	import { m } from '$lib/client/i18n';

	let {
		open,
		title,
		onclose,
		children,
		footer,
		testid
	}: {
		open: boolean;
		title: string;
		onclose: () => void;
		children: Snippet;
		footer?: Snippet;
		testid?: string;
	} = $props();

	const titleId = `sheet-${Math.random().toString(36).slice(2, 8)}`;
	let panel: HTMLDivElement | undefined = $state();

	$effect(() => {
		if (open && panel) panel.focus({ preventScroll: true });
	});

	function onkeydown(e: KeyboardEvent) {
		if (open && e.key === 'Escape') onclose();
	}
</script>

<svelte:window {onkeydown} />

{#if open}
	<div
		class="fixed inset-0 z-40 flex items-end justify-center sm:items-center"
		data-testid={testid}
	>
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-black/45"
			aria-label={m.common.close}
			tabindex="-1"
			onclick={onclose}
			transition:fade={{ duration: ms(160) }}
		></button>
		<div
			bind:this={panel}
			role="dialog"
			aria-modal="true"
			aria-labelledby={titleId}
			tabindex="-1"
			class="relative flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface shadow-card outline-none sm:rounded-3xl"
			transition:fly={{ y: 320, duration: ms(220), easing: cubicOut, opacity: 1 }}
		>
			<div class="px-safe flex items-center gap-2 pt-2">
				<div
					class="pointer-events-none absolute top-2 left-1/2 h-1.5 w-10 -translate-x-1/2 rounded-full bg-surface-3"
				></div>
				<h2 id={titleId} class="min-w-0 flex-1 pt-3 text-xl font-semibold [overflow-wrap:anywhere]">
					{title}
				</h2>
				<button
					type="button"
					class="mt-2 -mr-2 grid h-12 w-12 shrink-0 place-items-center rounded-full text-muted active:bg-surface-2"
					aria-label={m.common.close}
					onclick={onclose}
				>
					<Icon name="x" />
				</button>
			</div>
			<div class="px-safe min-h-0 flex-1 overflow-y-auto overscroll-contain pt-2 pb-4">
				{@render children()}
			</div>
			{#if footer}
				<div
					class="px-safe border-t border-line pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
				>
					{@render footer()}
				</div>
			{:else}
				<div class="pb-safe"></div>
			{/if}
		</div>
	</div>
{/if}
