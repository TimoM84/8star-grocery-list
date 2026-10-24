<script lang="ts">
	import { ms } from '$lib/client/motion';
	import { page } from '$app/state';
	import { fade, scale } from 'svelte/transition';
	import { ui } from '$lib/client/ui.svelte';

	const req = $derived(ui.confirmRequest);
	const open = $derived(req !== null && page.state.confirm === true);

	$effect(() => {
		// Back gesture while the dialog is open counts as "cancel".
		void page.state.confirm;
		ui.syncWithHistory();
	});
</script>

<svelte:window onkeydown={(e) => open && e.key === 'Escape' && ui.answerConfirm(false)} />

{#if open && req}
	<div class="fixed inset-0 z-50 grid place-items-center p-4" data-testid="confirm-dialog">
		<button
			type="button"
			class="absolute inset-0 h-full w-full cursor-default bg-black/50"
			aria-label="Annuleren"
			tabindex="-1"
			onclick={() => ui.answerConfirm(false)}
			transition:fade={{ duration: ms(140) }}
		></button>
		<div
			role="alertdialog"
			aria-modal="true"
			aria-labelledby="confirm-title"
			class="relative w-full max-w-sm rounded-3xl bg-surface p-5 shadow-card"
			transition:scale={{ start: 0.96, duration: ms(160) }}
		>
			<h2 id="confirm-title" class="text-xl font-semibold [overflow-wrap:anywhere]">{req.title}</h2>
			{#if req.message}
				<p class="mt-2 text-base text-muted">{req.message}</p>
			{/if}
			<div class="mt-5 grid grid-cols-2 gap-3">
				<button
					type="button"
					class="min-h-12 rounded-2xl bg-surface-2 px-4 text-base font-semibold active:bg-surface-3"
					onclick={() => ui.answerConfirm(false)}>Annuleren</button
				>
				<button
					type="button"
					class="min-h-12 rounded-2xl px-4 text-base font-semibold {req.danger
						? 'bg-danger text-white dark:text-black'
						: 'bg-accent text-on-accent'}"
					data-testid="confirm-ok"
					onclick={() => ui.answerConfirm(true)}>{req.confirmLabel}</button
				>
			</div>
		</div>
	</div>
{/if}
