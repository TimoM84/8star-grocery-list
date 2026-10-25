/**
 * Screen Wake Lock for winkelstand. Only held while the page is visible; the browser drops the
 * lock when the tab is hidden, so it is re-acquired when the page becomes visible again.
 * Unsupported browsers (or a denied request) simply keep the normal screen timeout.
 */

interface Sentinel {
	release(): Promise<void>;
	addEventListener(type: 'release', cb: () => void): void;
}

export function holdWakeLock(): () => void {
	const wl = (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<Sentinel> } })
		.wakeLock;
	if (!wl) return () => {};
	let sentinel: Sentinel | null = null;
	let stopped = false;

	const acquire = async () => {
		if (stopped || sentinel || document.visibilityState !== 'visible') return;
		try {
			const s = await wl.request('screen');
			if (stopped) {
				void s.release();
				return;
			}
			sentinel = s;
			s.addEventListener('release', () => {
				if (sentinel === s) sentinel = null;
			});
		} catch {
			/* denied (battery saver, permissions policy): keep the normal timeout */
		}
	};
	const onVisibility = () => {
		if (document.visibilityState === 'visible') void acquire();
	};
	document.addEventListener('visibilitychange', onVisibility);
	void acquire();
	return () => {
		stopped = true;
		document.removeEventListener('visibilitychange', onVisibility);
		void sentinel?.release();
		sentinel = null;
	};
}
