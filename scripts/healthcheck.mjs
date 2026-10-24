// Container healthcheck: exits 0 when the app and its database respond.
const port = process.env.PORT || 3000;
try {
	const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
		signal: AbortSignal.timeout(4000)
	});
	const body = await res.json();
	process.exit(res.ok && body.status === 'ok' ? 0 : 1);
} catch {
	process.exit(1);
}
