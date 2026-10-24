/** Duration helper: Svelte JS transitions ignore CSS, so honour reduced motion here. */
const reduced =
	typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function ms(duration: number): number {
	return reduced ? 0 : duration;
}
