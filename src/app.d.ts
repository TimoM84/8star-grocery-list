// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
	const __APP_VERSION__: string;
	namespace App {
		interface PageState {
			/** Open bottom sheet (shallow routing so Android "back" closes it). */
			sheet?: string;
			confirm?: boolean;
		}
	}
}

export {};
