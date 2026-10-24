// Container entrypoint: compose passes optional settings as empty strings when unset, but
// adapter-node rejects e.g. ORIGIN="". Drop empty values, then start the server.
for (const key of [
	'ORIGIN',
	'PROTOCOL_HEADER',
	'HOST_HEADER',
	'PORT_HEADER',
	'ADDRESS_HEADER',
	'XFF_DEPTH'
]) {
	if (process.env[key] !== undefined && process.env[key].trim() === '') delete process.env[key];
}
await import('../build/index.js');
