/**
 * Modal management on top of SvelteKit shallow routing: opening a sheet pushes a history
 * entry, so the Android back gesture closes the sheet instead of leaving the page.
 */

import { pushState } from '$app/navigation';
import { page } from '$app/state';

export interface ConfirmRequest {
	title: string;
	message?: string;
	confirmLabel: string;
	danger?: boolean;
	resolve: (ok: boolean) => void;
}

class UiState {
	sheetData = $state<Record<string, unknown>>({});
	confirmRequest = $state<ConfirmRequest | null>(null);

	isOpen(id: string): boolean {
		return page.state.sheet === id;
	}

	openSheet(id: string, data: Record<string, unknown> = {}) {
		this.sheetData = { ...this.sheetData, [id]: data };
		if (page.state.sheet === id) return;
		pushState('', { ...page.state, sheet: id });
	}

	data<T>(id: string): T | undefined {
		return this.sheetData[id] as T | undefined;
	}

	/** History entries to pop once the current confirm dialog finished resolving. */
	private pendingBack = 0;

	/** Guards against popping twice when several code paths close the same sheet. */
	private closing = false;

	closeSheet() {
		if (!page.state.sheet || this.closing) return;
		this.closing = true;
		window.addEventListener('popstate', () => (this.closing = false), { once: true });
		if (this.pendingBack > 0) this.pendingBack += 1;
		else history.back();
	}

	/** Promise-based confirmation dialog. */
	confirm(req: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
		this.confirmRequest?.resolve(false);
		return new Promise((resolve) => {
			this.confirmRequest = { ...req, resolve };
			pushState('', { ...page.state, confirm: true });
		});
	}

	answerConfirm(ok: boolean) {
		const req = this.confirmRequest;
		if (!req) return;
		this.confirmRequest = null;
		if (!page.state.confirm) {
			req.resolve(ok);
			return;
		}
		// Let the caller react first (it may close the underlying sheet too), then pop
		// all entries in one traversal.
		this.pendingBack = 1;
		req.resolve(ok);
		setTimeout(() => {
			const n = this.pendingBack;
			this.pendingBack = 0;
			history.go(-n);
		}, 0);
	}

	/** Keeps state consistent when the user navigates back with the system gesture. */
	syncWithHistory() {
		if (!page.state.confirm && this.confirmRequest) {
			const req = this.confirmRequest;
			this.confirmRequest = null;
			req.resolve(false);
		}
	}
}

export const ui = new UiState();
