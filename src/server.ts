// Entry point on Vercel, which serves this file's default export as a single function.
// Docker and local runs start from main.ts instead.
import express from 'express';
import { loadConfig } from './config.ts';
import { createApp } from './http.ts';

function start() {
	try {
		return createApp(loadConfig());
	} catch (error) {
		// Whoever deployed this filled a form in a browser and has no logs open. Say what is
		// wrong on the page itself; config errors name variables, never their values.
		const reason = error instanceof Error ? error.message : 'configuração inválida';
		const broken = express();
		broken.disable('x-powered-by');
		broken.use((_req, res) => {
			res
				.status(500)
				.type('text')
				.send(
					`O conector não está configurado: ${reason}\n\n` +
						'Corrija em Settings → Environment Variables no projeto da Vercel e faça um novo deploy.'
				);
		});
		return broken;
	}
}

export default start();
