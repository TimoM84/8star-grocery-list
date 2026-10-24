/** Single-slot toast with optional action (e.g. "Ongedaan maken"). */

export interface Toast {
	id: number;
	message: string;
	kind: 'info' | 'success' | 'warn' | 'error';
	action?: { label: string; run: () => void };
	duration: number;
}

let counter = 0;

class ToastState {
	current = $state<Toast | null>(null);
	private timer: ReturnType<typeof setTimeout> | null = null;

	show(message: string, options: Partial<Omit<Toast, 'id' | 'message'>> = {}) {
		const toast: Toast = {
			id: ++counter,
			message,
			kind: options.kind ?? 'info',
			action: options.action,
			duration: options.duration ?? (options.action ? 5000 : 3200)
		};
		this.current = toast;
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			if (this.current?.id === toast.id) this.current = null;
		}, toast.duration);
	}

	dismiss() {
		this.current = null;
		if (this.timer) clearTimeout(this.timer);
	}
}

export const toasts = new ToastState();
