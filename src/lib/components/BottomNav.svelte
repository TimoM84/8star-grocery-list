<script lang="ts">
	import { page } from '$app/state';
	import Icon, { type IconName } from './Icon.svelte';
	import { app } from '$lib/client/app.svelte';
	import { m } from '$lib/client/i18n';

	// Test ids stay Dutch (the route names) whatever the UI language.
	const tabs = $derived<{ href: string; id: string; label: string; icon: IconName }[]>([
		{ href: '/', id: 'lijst', label: m.nav.list, icon: 'list' },
		{ href: '/suggesties', id: 'suggesties', label: m.nav.suggestions, icon: 'sparkles' },
		{ href: '/historie', id: 'historie', label: m.nav.history, icon: 'history' },
		{ href: '/beheer', id: 'beheer', label: m.nav.settings, icon: 'settings' }
	]);

	const suggestionCount = $derived(
		app.suggestions.length + (app.aiEnabled ? app.aiRecommendations.length : 0)
	);
</script>

<nav
	class="hide-on-kb pb-safe fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 backdrop-blur"
	aria-label={m.nav.label}
>
	<ul
		class="mx-auto grid h-[var(--nav-h)] max-w-2xl grid-cols-4 px-[env(safe-area-inset-left,0px)]"
	>
		{#each tabs as tab (tab.href)}
			{@const active =
				tab.href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(tab.href)}
			<li class="flex">
				<a
					href={tab.href}
					class="relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[min(0.8125rem,3.7vw,14.5px)] font-medium {active
						? 'text-accent'
						: 'text-muted'}"
					aria-current={active ? 'page' : undefined}
					data-testid="nav-{tab.id}"
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
									aria-label={m.nav.suggestionCount(suggestionCount)}>{suggestionCount}</span
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
