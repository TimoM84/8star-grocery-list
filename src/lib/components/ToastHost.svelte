<script lang="ts">
	import { ms } from '$lib/client/motion';
	import { fly } from 'svelte/transition';
	import { toasts } from '$lib/client/toast.svelte';
	import Icon from './Icon.svelte';
	import { m } from '$lib/client/i18n';

	const toast = $derived(toasts.current);
</script>

<div
	class="px-safe pointer-events-none fixed inset-x-0 bottom-[calc(var(--nav-h)+env(safe-area-inset-bottom,0px)+0.75rem)] z-30 flex justify-center [html.kb-open_&]:bottom-3"
	aria-live="polite"
>
	{#key toast?.id}
		{#if toast}
			<div
				class="pointer-events-auto flex w-full max-w-xl flex-wrap items-center gap-x-2 rounded-2xl py-1 pr-1 pl-4 text-base shadow-card {toast.kind ===
				'error'
					? 'bg-danger text-white dark:text-black'
					: toast.kind === 'warn'
						? 'bg-warn text-white dark:text-black'
						: 'bg-ink text-bg'}"
				role="status"
				data-testid="toast"
				in:fly={{ y: 24, duration: ms(180) }}
				out:fly={{ y: 24, duration: ms(140) }}
			>
				<span class="min-w-0 flex-1 py-2.5 [overflow-wrap:anywhere]">{toast.message}</span>
				{#if toast.secondary}
					<button
						type="button"
						class="min-h-12 max-w-full shrink-0 rounded-xl px-3 font-semibold underline-offset-2 active:bg-white/15"
						data-testid="toast-secondary"
						onclick={() => {
							toast.secondary?.run();
							toasts.dismiss();
						}}
					>
						{toast.secondary.label}
					</button>
				{/if}
				{#if toast.action}
					<button
						type="button"
						class="min-h-12 max-w-full shrink-0 rounded-xl px-3 font-semibold underline-offset-2 active:bg-white/15"
						data-testid="toast-action"
						onclick={() => toast.action?.run()}
					>
						{toast.action.label}
					</button>
				{:else}
					<button
						type="button"
						class="grid h-12 w-12 shrink-0 place-items-center rounded-xl opacity-80 active:bg-white/15"
						aria-label={m.common.dismissNotice}
						onclick={() => toasts.dismiss()}
					>
						<Icon name="x" size={20} />
					</button>
				{/if}
			</div>
		{/if}
	{/key}
</div>
