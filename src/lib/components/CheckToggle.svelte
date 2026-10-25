<script lang="ts">
	import Icon from './Icon.svelte';

	/** A 48×48 checkbox: a native checkbox would be a too small touch target. */
	let {
		checked,
		label,
		onchange,
		testid
	}: { checked: boolean; label: string; onchange: (checked: boolean) => void; testid?: string } =
		$props();
</script>

<button
	type="button"
	role="checkbox"
	aria-checked={checked}
	aria-label={label}
	class="grid h-12 w-12 shrink-0 place-items-center rounded-xl active:bg-surface-2"
	onclick={() => onchange(!checked)}
	data-testid={testid}
>
	<span
		class="grid h-6 w-6 place-items-center rounded-md border-2 {checked
			? 'border-accent bg-accent text-on-accent'
			: 'border-faint'}"
	>
		{#if checked}<Icon name="check" size={16} stroke={3} />{/if}
	</span>
</button>
