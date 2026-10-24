/** Service worker registration, update prompts and the Android install prompt. */

import { dev } from '$app/environment';

interface BeforeInstallPromptEvent extends Event {
	prompt: () => Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

class PwaState {
	updateReady = $state(false);
	canInstall = $state(false);
	installed = $state(false);
	swActive = $state(false);
	secure = $state(true);
	private deferred: BeforeInstallPromptEvent | null = null;
	private registration: ServiceWorkerRegistration | null = null;
	private reloading = false;
	private updateRequested = false;

	init() {
		if (typeof window === 'undefined') return;
		this.secure = window.isSecureContext;
		this.installed =
			window.matchMedia('(display-mode: standalone)').matches ||
			(navigator as Navigator & { standalone?: boolean }).standalone === true;

		window.addEventListener('beforeinstallprompt', (e) => {
			e.preventDefault();
			this.deferred = e as BeforeInstallPromptEvent;
			this.canInstall = true;
		});
		window.addEventListener('appinstalled', () => {
			this.installed = true;
			this.canInstall = false;
			this.deferred = null;
		});

		if (!('serviceWorker' in navigator) || !this.secure) return;
		void this.register();
	}

	private async register() {
		try {
			const reg = await navigator.serviceWorker.register('/service-worker.js', {
				type: dev ? 'module' : 'classic',
				updateViaCache: 'none'
			});
			this.registration = reg;
			this.swActive = !!reg.active;
			navigator.serviceWorker.ready.then(() => (this.swActive = true));

			const watch = (worker: ServiceWorker | null) => {
				if (!worker) return;
				worker.addEventListener('statechange', () => {
					// Only an *update* (an existing controller) needs a prompt; the first install is silent.
					if (worker.state === 'installed' && navigator.serviceWorker.controller)
						this.updateReady = true;
				});
			};
			if (reg.waiting && navigator.serviceWorker.controller) this.updateReady = true;
			watch(reg.installing);
			reg.addEventListener('updatefound', () => watch(reg.installing));

			navigator.serviceWorker.addEventListener('controllerchange', () => {
				// The first install also changes the controller (clients.claim); reloading then
				// would interrupt the user for nothing. Only reload for a requested update.
				if (this.reloading || !this.updateRequested) return;
				this.reloading = true;
				window.location.reload();
			});

			const check = () => reg.update().catch(() => {});
			setInterval(check, 30 * 60 * 1000);
			document.addEventListener('visibilitychange', () => {
				if (document.visibilityState === 'visible') check();
			});
		} catch (e) {
			console.warn('[pwa] service worker registration failed', e);
		}
	}

	applyUpdate() {
		this.updateRequested = true;
		const waiting = this.registration?.waiting;
		if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
		else window.location.reload();
	}

	async install() {
		if (!this.deferred) return;
		await this.deferred.prompt();
		const choice = await this.deferred.userChoice;
		if (choice.outcome === 'accepted') this.canInstall = false;
		this.deferred = null;
	}
}

export const pwa = new PwaState();
