/** Server-Sent Events hub: notifies every connected device when the data changes. */

const encoder = new TextEncoder();

interface Client {
	controller: ReadableStreamDefaultController<Uint8Array>;
	heartbeat: ReturnType<typeof setInterval>;
}

export const HEARTBEAT_MS = 20_000;

export class EventHub {
	private clients = new Set<Client>();

	get size(): number {
		return this.clients.size;
	}

	/** Creates a new SSE stream. `initialSeq` is sent immediately so clients can catch up. */
	connect(initialSeq: number): ReadableStream<Uint8Array> {
		let client: Client;
		return new ReadableStream<Uint8Array>({
			start: (controller) => {
				client = {
					controller,
					heartbeat: setInterval(() => this.send(client, ': ping\n\n'), HEARTBEAT_MS)
				};
				this.clients.add(client);
				this.send(
					client,
					`retry: 3000\nevent: hello\ndata: ${JSON.stringify({ seq: initialSeq })}\n\n`
				);
			},
			cancel: () => this.drop(client)
		});
	}

	broadcast(seq: number) {
		const msg = `event: change\ndata: ${JSON.stringify({ seq })}\n\n`;
		for (const c of this.clients) this.send(c, msg);
	}

	/** Closes all streams (used on shutdown so the HTTP server can exit promptly). */
	closeAll() {
		for (const c of [...this.clients]) {
			try {
				c.controller.close();
			} catch {
				/* already closed */
			}
			this.drop(c);
		}
	}

	private send(client: Client, text: string) {
		try {
			client.controller.enqueue(encoder.encode(text));
		} catch {
			this.drop(client);
		}
	}

	private drop(client: Client | undefined) {
		if (!client) return;
		clearInterval(client.heartbeat);
		this.clients.delete(client);
	}
}
