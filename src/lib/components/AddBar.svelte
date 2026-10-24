<script lang="ts">
	import Icon from './Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { autocomplete, type ProductView } from '$lib/shared/selectors';
	import { formatQuantity, parseEntry } from '$lib/shared/quantity';

	let text = $state('');
	let focused = $state(false);
	let active = $state(-1);
	let input: HTMLInputElement | undefined = $state();

	const parsed = $derived(parseEntry(text));
	const matches = $derived(
		focused && text.trim() ? autocomplete(app.products, parsed.name, 6) : []
	);

	$effect(() => {
		void matches;
		active = -1;
	});

	function withQuantity(name: string): string {
		if (parsed.quantity === null) return name;
		return `${parsed.quantity} ${parsed.unit ?? ''} ${name}`.replace(/\s+/g, ' ');
	}

	function submit(e?: Event) {
		e?.preventDefault();
		if (active >= 0 && matches[active]) return pick(matches[active]);
		if (!text.trim()) {
			input?.focus();
			return;
		}
		const outcome = app.add(text);
		if (outcome.kind !== 'empty') text = '';
		input?.focus();
	}

	function pick(v: ProductView) {
		// Same path as typing the full name: duplicates are highlighted, completed items reactivated.
		app.add(withQuantity(v.product.name));
		text = '';
		input?.focus();
	}

	function onkeydown(e: KeyboardEvent) {
		if (!matches.length) return;
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			active = (active + 1) % matches.length;
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			active = active <= 0 ? matches.length - 1 : active - 1;
		} else if (e.key === 'Escape') {
			text = '';
		}
	}

	function statusLabel(v: ProductView): string {
		if (v.status === 'active') return 'op de lijst';
		if (v.status === 'completed') return 'afgevinkt · terugzetten';
		if (v.stats.purchaseCount > 0) return `${v.stats.purchaseCount}× gekocht`;
		return '';
	}
</script>

<form class="relative" onsubmit={submit} autocomplete="off" data-testid="add-form">
	<div class="flex items-center gap-2">
		<label class="sr-only" for="add-input">Wat hebben we nodig?</label>
		<input
			bind:this={input}
			bind:value={text}
			id="add-input"
			name="item"
			type="text"
			inputmode="text"
			enterkeyhint="go"
			autocapitalize="sentences"
			autocorrect="on"
			spellcheck="true"
			maxlength="90"
			placeholder="Wat hebben we nodig?"
			class="h-14 min-w-0 flex-1 rounded-2xl border border-line bg-surface px-4 text-[min(1.125rem,5.4vw)] text-ink shadow-card outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
			role="combobox"
			aria-expanded={matches.length > 0}
			aria-controls="add-suggestions"
			aria-autocomplete="list"
			aria-activedescendant={active >= 0 ? `sugg-${active}` : undefined}
			onfocus={() => (focused = true)}
			onblur={() => setTimeout(() => (focused = false), 120)}
			{onkeydown}
			data-testid="add-input"
		/>
		<button
			type="submit"
			class="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent shadow-card transition-transform active:scale-95 disabled:opacity-60"
			aria-label="Toevoegen"
			onpointerdown={(e) => e.preventDefault()}
			data-testid="add-button"
		>
			<Icon name="plus" size={28} stroke={2.5} />
		</button>
	</div>

	{#if matches.length}
		<ul
			id="add-suggestions"
			role="listbox"
			aria-label="Eerdere producten"
			class="absolute inset-x-0 top-full z-30 mt-2 max-h-[min(22rem,calc(100dvh-12rem))] overflow-y-auto overscroll-contain rounded-2xl border border-line bg-surface py-1 shadow-card"
			data-testid="autocomplete"
		>
			{#each matches as v, i (v.product.id)}
				<li role="option" id="sugg-{i}" aria-selected={i === active}>
					<button
						type="button"
						class="flex min-h-13 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2 {i ===
						active
							? 'bg-surface-2'
							: ''}"
						onpointerdown={(e) => e.preventDefault()}
						onclick={() => pick(v)}
						data-testid="autocomplete-option"
					>
						<Icon
							name={v.status === 'active' ? 'check' : v.product.favorite ? 'star' : 'history'}
							size={20}
							filled={v.status !== 'active' && v.product.favorite}
							class={v.status === 'active'
								? 'text-accent'
								: v.product.favorite
									? 'text-star'
									: 'text-faint'}
						/>
						<span class="min-w-0 flex-1">
							<span class="block text-[1.0625rem] font-medium [overflow-wrap:anywhere]"
								>{v.product.name}</span
							>
							{#if statusLabel(v)}
								<span class="block text-sm text-muted">{statusLabel(v)}</span>
							{/if}
						</span>
						{#if parsed.quantity !== null}
							<span
								class="shrink-0 rounded-full bg-accent-soft px-2 py-0.5 text-sm font-semibold text-accent"
								>{formatQuantity(parsed.quantity, parsed.unit)}</span
							>
						{/if}
					</button>
				</li>
			{/each}
		</ul>
	{/if}
</form>
