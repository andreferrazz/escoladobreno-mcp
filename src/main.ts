import { createApp } from './app.ts';
import { loadConfig } from './config.ts';

const config = loadConfig();
const server = createApp(config).listen(config.port, () => {
	console.log(`escoladobreno-mcp listening on :${config.port} for ${config.publicUrl.origin}`);
});

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
	process.on(signal, () => {
		server.close(() => process.exit(0));
		server.closeAllConnections();
	});
}
