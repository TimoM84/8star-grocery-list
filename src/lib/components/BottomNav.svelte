<script lang="ts">
	import { page } from '$app/state';
	import Icon, { type IconName } from './Icon.svelte';
	import { app } from '$lib/client/app.svelte';

	const tabs: { href: string; label: string; icon: IconName }[] = [
		{ href: '/', label: 'Lijst', icon: 'list' },
		{ href: '/suggesties', label: 'Suggesties', icon: 'sparkles' },
		{ href: '/historie', label: 'Historie', icon: 'history' },
		{ href: '/beheer', label: 'Beheer', icon: 'settings' }
	];

	const suggestionCount = $derived(app.suggestions.length);
</script>

<nav
	class="hide-on-kb pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
	aria-label="Hoofdnavigatie"
>
	<ul
		class="mx-auto grid h-[var(--nav-h)] max-w-2xl grid-cols-4 px-[env(safe-area-inset-left,0px)]"
	>
		{#each tabs as tab (tab.href)}
			{@const active = page.url.pathname === tab.href}
			<li class="flex">
				<a
					href={tab.href}
					class="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[min(0.8125rem,3.7vw,14.5px)] font-medium {active
						? 'text-accent'
						: 'text-muted'}"
					aria-current={active ? 'page' : undefined}
					data-testid="nav-{tab.label.toLowerCase()}"
				>
					<span
						class="grid h-8 w-full max-w-14 place-items-center rounded-full transition-colors {active
							? 'bg-accent-soft'
							: ''}"
					>
						<span class="relative">
							<Icon name={tab.icon} size={22} />
							{#if tab.href === '/suggesties' && suggestionCount > 0}
								<span
									class="absolute -top-[6px] left-[14px] h-[20px] min-w-[20px] rounded-full bg-accent px-[4px] text-center text-[11px] leading-[20px] font-bold text-on-accent"
									aria-label="{suggestionCount} suggesties">{suggestionCount}</span
								>
							{/if}
						</span>
					</span>
					<span class="leading-tight">{tab.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
