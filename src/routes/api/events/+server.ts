import { getRuntime } from '$lib/server/runtime';

export const GET = () => {
	const { hub, store } = getRuntime();
	return new Response(hub.connect(store.seq), {
		headers: {
			'Content-Type': 'text/event-stream; charset=utf-8',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive',
			'X-Accel-Buffering': 'no'
		}
	});
};
