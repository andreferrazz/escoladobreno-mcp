// Entry point on Vercel, which serves this file's default export as a single function.
// Docker and local runs start from main.ts instead.
import express, { type RequestHandler } from 'express';

// Everything else loads on the first request, inside a guard. Whoever deployed this filled a
// form in a browser and has no logs open, so a bad setting or a failed start has to be said
// on the page itself. Config errors name variables, never their values.
async function load(): Promise<RequestHandler> {
	try {
		const [{ loadConfig }, { createApp }] = await Promise.all([import('./config.ts'), import('./http.ts')]);
		return createApp(loadConfig());
	} catch (error) {
		console.error('The connector could not start', error);
		const reason = error instanceof Error ? error.message : 'configuração inválida';
		return (_req, res) => {
			res
				.status(500)
				.type('text')
				.send(
					`O conector não está configurado: ${reason}\n\n` +
						'Corrija em Settings → Environment Variables no projeto da Vercel e faça um novo deploy.'
				);
		};
	}
}

let loading: Promise<RequestHandler> | undefined;

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
	(loading ??= load()).then((handler) => handler(req, res, next), next);
});

export default app;
