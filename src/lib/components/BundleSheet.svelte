<script lang="ts">
	import Sheet from './Sheet.svelte';
	import Icon from './Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { formatQuantity, parseEntry } from '$lib/shared/quantity';
	import { stripBullet } from '$lib/shared/planning';

	interface Line {
		key: number;
		text: string;
		note: string | null;
	}

	const open = $derived(ui.isOpen('bundle'));
	const bundleId = $derived(ui.data<{ bundleId?: string }>('bundle')?.bundleId ?? null);
	const bundle = $derived(bundleId ? app.bundles.find((b) => b.id === bundleId) : undefined);

	let name = $state('');
	let servings = $state<number | null>(null);
	let lines = $state<Line[]>([]);
	let loadedFor = $state<string | null>(null);
	let counter = 0;

	$effect(() => {
		if (!open) {
			loadedFor = null;
			return;
		}
		const key = bundleId ?? 'new';
		if (loadedFor === key) return;
		loadedFor = key;
		name = bundle?.name ?? '';
		servings = bundle?.servings ?? null;
		lines = (bundle?.lines ?? []).map((l) => ({
			key: ++counter,
			text: `${l.quantity !== null ? formatQuantity(l.quantity, l.unit) + ' ' : ''}${app.product(l.productId)?.name ?? ''}`.trim(),
			note: l.note
		}));
		if (!lines.length) lines = [{ key: ++counter, text: '', note: null }];
	});

	function addLine() {
		lines = [...lines, { key: ++counter, text: '', note: null }];
	}

	function onpaste(e: ClipboardEvent, index: number) {
		const pasted = e.clipboardData?.getData('text') ?? '';
		if (!pasted.includes('\n')) return;
		e.preventDefault();
		const extra = pasted
			.split(/\r?\n/)
			.map(stripBullet)
			.filter(Boolean)
			.map((text) => ({ key: ++counter, text, note: null }));
		lines = [...lines.slice(0, index), ...extra, ...lines.slice(index + 1)].slice(0, 100);
	}

	function save() {
		const id = app.saveBundle(
			bundleId,
			name,
			servings && servings > 0 ? Math.round(servings) : null,
			lines.map((l) => {
				const p = parseEntry(l.text);
				return { name: p.name, quantity: p.quantity, unit: p.unit, note: l.note };
			})
		);
		if (id) ui.closeSheet();
	}

	async function remove() {
		if (!bundle) return;
		const ok = await ui.confirm({
			title: `Bundel “${bundle.name}” verwijderen?`,
			message: 'Alleen de bundel verdwijnt. Producten, lijsten en geschiedenis blijven bewaard.',
			confirmLabel: 'Verwijderen',
			danger: true
		});
		if (!ok) return;
		app.deleteBundle(bundle);
		ui.closeSheet();
	}

	function copy() {
		if (!bundle) return;
		app.copyBundle(bundle);
		ui.closeSheet();
	}

	const input =
		'h-12 w-full rounded-2xl border border-line bg-bg px-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30';
</script>

<Sheet
	{open}
	title={bundle ? 'Bundel bewerken' : 'Nieuwe bundel'}
	onclose={() => ui.closeSheet()}
	testid="bundle-sheet"
>
	<form
		class="space-y-5"
		onsubmit={(e) => {
			e.preventDefault();
			save();
		}}
	>
		<div>
			<label for="bundle-name" class="mb-1.5 block text-sm font-semibold text-muted">Naam</label>
			<input
				id="bundle-name"
				bind:value={name}
				maxlength="80"
				placeholder="bijv. Lasagne of Weekbasis"
				class={input}
				data-testid="bundle-name"
			/>
		</div>
		<div>
			<label for="bundle-servings" class="mb-1.5 block text-sm font-semibold text-muted"
				>Voor hoeveel personen (optioneel)</label
			>
			<input
				id="bundle-servings"
				type="number"
				inputmode="numeric"
				min="1"
				max="50"
				bind:value={servings}
				placeholder="—"
				class="{input} max-w-32"
				data-testid="bundle-servings"
			/>
			<p class="mt-1 text-sm text-faint">
				Dan kun je bij het toevoegen het aantal personen kiezen.
			</p>
		</div>
		<fieldset>
			<legend class="mb-2 text-sm font-semibold text-muted">Producten (één per regel)</legend>
			<ul class="space-y-2">
				{#each lines as line, i (line.key)}
					<li class="flex items-center gap-2">
						<input
							bind:value={lines[i].text}
							maxlength="100"
							placeholder="bijv. 500 g gehakt"
							aria-label="Product {i + 1}"
							class={input}
							onpaste={(e) => onpaste(e, i)}
							data-testid="bundle-line"
						/>
						<button
							type="button"
							class="grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-faint active:bg-surface-2"
							aria-label="Regel {i + 1} verwijderen"
							onclick={() => (lines = lines.filter((l) => l !== line))}><Icon name="x" /></button
						>
					</li>
				{/each}
			</ul>
			<button
				type="button"
				class="mt-2 flex min-h-12 items-center gap-2 px-1 font-semibold text-accent"
				onclick={addLine}
				data-testid="bundle-add-line"
			>
				<Icon name="plus" size={20} /> Regel toevoegen
			</button>
		</fieldset>
		{#if bundle}
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="flex min-h-12 grow items-center justify-center gap-2 rounded-2xl border border-line font-semibold"
					onclick={copy}
					data-testid="bundle-copy"><Icon name="layers" size={20} /> Kopiëren</button
				>
				<button
					type="button"
					class="flex min-h-12 grow items-center justify-center gap-2 rounded-2xl border border-danger/40 font-semibold text-danger active:bg-danger-soft"
					onclick={remove}
					data-testid="bundle-delete"><Icon name="trash" size={20} /> Verwijderen</button
				>
			</div>
		{/if}
	</form>
	{#snippet footer()}
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="min-h-12 rounded-2xl bg-surface-2 text-base font-semibold active:bg-surface-3"
				onclick={() => ui.closeSheet()}>Annuleren</button
			>
			<button
				type="button"
				class="min-h-12 rounded-2xl bg-accent text-base font-semibold text-on-accent active:bg-accent-strong disabled:opacity-50"
				disabled={!name.trim()}
				onclick={save}
				data-testid="bundle-save">Opslaan</button
			>
		</div>
	{/snippet}
</Sheet>
