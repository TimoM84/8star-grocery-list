<script lang="ts">
	import Sheet from './Sheet.svelte';
	import CheckToggle from './CheckToggle.svelte';
	import { app } from '$lib/client/app.svelte';
	import { ui } from '$lib/client/ui.svelte';
	import { MAX_BULK_LINES, parseBulk, planEntry, type EntryPlan } from '$lib/shared/planning';
	import { parseEntry } from '$lib/shared/quantity';
	import { m, qty } from '$lib/client/i18n';
	import { cleanName, MAX_NAME_LENGTH, nameKey } from '$lib/shared/text';

	interface Data {
		listId?: string;
		/** Prefilled text (Web Share Target, paste). */
		text?: string;
		source?: 'share';
		/** A shared link; never fetched, only mentioned. */
		url?: string;
	}

	interface Line {
		key: number;
		text: string;
		include: boolean;
		/** For a product already on the list: what to do with it. */
		choice: 'skip' | 'extra' | 'set';
	}

	const open = $derived(ui.isOpen('bulk'));
	const data = $derived(ui.data<Data>('bulk') ?? {});

	let stage = $state<'input' | 'preview'>('input');
	let text = $state('');
	let listId = $state('');
	let lines = $state<Line[]>([]);
	let truncated = $state(0);
	let busy = $state(false);
	let loaded = $state(false);
	let counter = 0;

	$effect(() => {
		if (!open) {
			loaded = false;
			return;
		}
		if (loaded) return;
		loaded = true;
		busy = false;
		listId = data.listId && app.list(data.listId) ? data.listId : app.listId;
		text = data.text ?? '';
		stage = 'input';
		if (text.trim()) preview();
	});

	function preview() {
		const parsed = parseBulk(text, app.view ?? undefined);
		truncated = parsed.truncated;
		lines = parsed.lines.map((l) => ({
			key: ++counter,
			text: l.raw,
			include: l.duplicateOf === null,
			choice: 'skip'
		}));
		stage = 'preview';
	}

	interface Row {
		line: Line;
		name: string;
		quantity: number | null;
		unit: string | null;
		error: string | null;
		plan: EntryPlan | null;
		duplicateOf: number | null;
	}

	const rows = $derived.by<Row[]>(() => {
		// eslint-disable-next-line svelte/prefer-svelte-reactivity -- local to this derivation
		const seen = new Map<string, number>();
		return lines.map((line, index) => {
			const parsed = parseEntry(line.text);
			const name = cleanName(parsed.name);
			let error: string | null = null;
			if (!name) error = m.bulk.noName;
			else if (name.length > MAX_NAME_LENGTH) error = m.bulk.tooLong(MAX_NAME_LENGTH);
			const plan =
				!error && app.view
					? planEntry(app.view, listId, { name, quantity: parsed.quantity, unit: parsed.unit })
					: null;
			const key = plan?.product ? `p:${plan.product.id}` : `n:${nameKey(name)}`;
			let duplicateOf: number | null = null;
			if (!error && line.include) {
				if (seen.has(key)) duplicateOf = seen.get(key)!;
				else seen.set(key, index);
			}
			return {
				line,
				name: plan?.name ?? name,
				quantity: parsed.quantity,
				unit: parsed.unit,
				error,
				plan,
				duplicateOf
			};
		});
	});

	const included = $derived(rows.filter((r) => r.line.include));
	const blocking = $derived(included.filter((r) => r.error || r.duplicateOf !== null));
	const actionable = $derived(
		included.filter(
			(r) =>
				!r.error &&
				r.duplicateOf === null &&
				(r.plan?.state !== 'active' || r.line.choice !== 'skip')
		)
	);

	function submit() {
		if (busy || blocking.length || !actionable.length) return;
		busy = true; // guards against a double tap; the op itself is idempotent too
		const ok = app.addMany(
			listId,
			actionable.map((r) => {
				const active = r.plan?.state === 'active';
				const extra = active && r.line.choice === 'extra' ? r.plan?.duplicate?.extra : null;
				return {
					name: r.name,
					quantity: extra
						? extra.quantity
						: r.quantity !== null
							? r.quantity
							: (r.plan?.quantity ?? null),
					unit: extra ? extra.unit : r.quantity !== null ? r.unit : (r.plan?.unit ?? null),
					categoryId: null,
					note: null,
					action: active ? (r.line.choice as 'extra' | 'set') : 'add'
				};
			})
		);
		if (ok) {
			if (listId !== app.listId) app.selectList(listId);
			ui.closeSheet();
		} else busy = false;
	}

	function status(r: Row): string {
		if (r.error) return r.error;
		if (r.duplicateOf !== null) return m.bulk.duplicate(r.duplicateOf + 1);
		const p = r.plan;
		if (!p) return '';
		const other = p.elsewhere.length
			? ` · ${m.bulk.alsoOn(p.elsewhere.map((e) => e.list.name).join(', '))}`
			: '';
		if (p.state === 'active')
			return (
				(p.item?.quantity != null
					? m.bulk.onListQty(qty(p.item.quantity, p.item.unit))
					: m.bulk.onList) + other
			);
		if (p.state === 'reactivate') return m.bulk.backOnList + other;
		return (p.product ? m.bulk.known : m.bulk.new) + other;
	}

	const listName = $derived(app.list(listId)?.name ?? m.common.list);
</script>

<Sheet
	{open}
	title={stage === 'input' ? m.bulk.title : `${m.bulk.check} · ${listName}`}
	onclose={() => ui.closeSheet()}
	testid="bulk-sheet"
>
	{#if stage === 'input'}
		<label for="bulk-text" class="mb-1.5 block text-sm font-semibold text-muted"
			>{m.bulk.onePerLine}</label
		>
		<textarea
			id="bulk-text"
			bind:value={text}
			rows="8"
			maxlength="10000"
			placeholder={m.bulk.placeholder}
			class="w-full rounded-2xl border border-line bg-bg p-4 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30"
			data-testid="bulk-text"></textarea>
		<p class="mt-2 text-sm text-muted">
			{m.bulk.help(MAX_BULK_LINES)}
		</p>
	{:else}
		{#if data.source === 'share'}
			<p
				class="mb-3 rounded-2xl bg-surface-2 px-4 py-3 text-sm text-muted"
				data-testid="share-note"
			>
				{m.bulk.shared}
				{#if data.url}{m.bulk.linksIgnored}{/if}
			</p>
		{/if}
		{#if app.lists.length > 1}
			<fieldset class="mb-4">
				<legend class="mb-2 text-sm font-semibold text-muted">{m.bulk.addTo}</legend>
				<div class="flex flex-wrap gap-2">
					{#each app.lists as l (l.id)}
						<button
							type="button"
							class="min-h-12 rounded-full border px-4 text-base font-medium {listId === l.id
								? 'border-accent bg-accent text-on-accent'
								: 'border-line bg-surface'}"
							aria-pressed={listId === l.id}
							onclick={() => (listId = l.id)}
							data-testid="bulk-list-option">{l.name}</button
						>
					{/each}
				</div>
			</fieldset>
		{/if}
		{#if truncated}
			<p class="mb-3 text-sm text-warn">
				{m.bulk.truncated(MAX_BULK_LINES, truncated)}
			</p>
		{/if}
		{#if rows.length === 0}
			<p class="text-muted">{m.bulk.noLines}</p>
		{/if}
		<ul class="space-y-2" data-testid="bulk-lines">
			{#each rows as r, i (r.line.key)}
				<li
					class="rounded-2xl border p-2 {r.line.include && (r.error || r.duplicateOf !== null)
						? 'border-danger/50'
						: 'border-line'} {r.line.include ? '' : 'opacity-60'}"
					data-testid="bulk-line"
				>
					<div class="flex items-center gap-2">
						<CheckToggle
							checked={lines[i].include}
							label={m.bulk.include(i + 1)}
							onchange={(v) => (lines[i].include = v)}
							testid="bulk-include"
						/>
						<input
							bind:value={lines[i].text}
							maxlength="120"
							aria-label={m.bulk.line(i + 1)}
							class="h-12 min-w-0 flex-1 rounded-xl border border-line bg-bg px-3 text-base outline-none focus:border-accent"
							data-testid="bulk-line-text"
						/>
					</div>
					<p
						class="mt-1 pl-14 text-sm {r.error || r.duplicateOf !== null
							? 'text-danger'
							: 'text-muted'}"
						data-testid="bulk-line-status"
					>
						{status(r)}
					</p>
					{#if r.line.include && r.plan?.state === 'active' && !r.error && r.duplicateOf === null}
						{@const dup = r.plan.duplicate}
						<div
							class="mt-1 flex flex-wrap gap-2 pl-14"
							role="radiogroup"
							aria-label={m.bulk.whatToDo(r.name)}
						>
							{#each [{ id: 'skip', label: m.addPrompt.keep, show: true }, { id: 'extra', label: dup?.extra ? m.addPrompt.extra(qty(dup.extra.quantity, dup.extra.unit)) : '', show: !!dup?.extra }, { id: 'set', label: dup?.set ? m.addPrompt.setTo(qty(dup.set.quantity, dup.set.unit)) : '', show: !!dup?.set }] as opt (opt.id)}
								{#if opt.show}
									<button
										type="button"
										role="radio"
										aria-checked={r.line.choice === opt.id}
										class="min-h-12 rounded-full border px-3 text-sm font-semibold {r.line
											.choice === opt.id
											? 'border-accent bg-accent text-on-accent'
											: 'border-line bg-surface'}"
										onclick={() => (lines[i].choice = opt.id as Line['choice'])}
										data-testid="bulk-choice-{opt.id}">{opt.label}</button
									>
								{/if}
							{/each}
						</div>
					{/if}
				</li>
			{/each}
		</ul>
		{#if blocking.length}
			<p class="mt-3 text-sm text-danger" data-testid="bulk-blocking">
				{m.bulk.blocking(blocking.length)}
			</p>
		{/if}
	{/if}
	{#snippet footer()}
		{#if stage === 'input'}
			<button
				type="button"
				class="min-h-12 w-full rounded-2xl bg-accent text-base font-semibold text-on-accent active:bg-accent-strong disabled:opacity-50"
				disabled={!text.trim()}
				onclick={preview}
				data-testid="bulk-preview">{m.bulk.check}</button
			>
		{:else}
			<div class="grid grid-cols-[auto_1fr] gap-3">
				<button
					type="button"
					class="min-h-12 rounded-2xl bg-surface-2 px-4 text-base font-semibold active:bg-surface-3"
					onclick={() => {
						text = lines.map((l) => l.text).join('\n');
						stage = 'input';
					}}>{m.common.back}</button
				>
				<button
					type="button"
					class="min-h-12 rounded-2xl bg-accent px-3 text-base font-semibold text-on-accent active:bg-accent-strong disabled:opacity-50"
					disabled={busy || !!blocking.length || !actionable.length}
					onclick={submit}
					data-testid="bulk-submit"
				>
					{m.bulk.submit(actionable.length)}
				</button>
			</div>
		{/if}
	{/snippet}
</Sheet>
