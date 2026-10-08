import express from 'express';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import {
	getOAuthProtectedResourceMetadataUrl,
	mcpAuthRouter
} from '@modelcontextprotocol/sdk/server/auth/router.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createBrenoClient, type BrenoClient } from './breno.ts';
import type { Config } from './config.ts';
import { renderLoginPage } from './login-page.ts';
import { createLoginLimiter, verifyPassword } from './password.ts';
import { createProvider, SCOPE, type LoginClaims } from './provider.ts';
import { createSealer } from './seal.ts';
import { createMcpServer } from './tools.ts';

const methodNotAllowed = {
	jsonrpc: '2.0',
	error: { code: -32000, message: 'Method not allowed.' },
	id: null
};

// One backend client for the whole process, so its sign-in is shared by every request.
export function createApp(config: Config, breno: BrenoClient = createBrenoClient(config.breno)) {
	const sealer = createSealer(config.signingSecret);
	const { provider, completeLogin } = createProvider(sealer);
	const limiter = createLoginLimiter();
	const mcpUrl = new URL('/mcp', config.publicUrl);

	const app = express();
	app.disable('x-powered-by');
	// One proxy (Traefik) sits in front; the SDK's rate limiters key on the client address.
	app.set('trust proxy', 1);

	app.get('/healthz', (_req, res) => void res.json({ status: 'ok' }));

	app.use(
		mcpAuthRouter({
			provider,
			issuerUrl: config.publicUrl,
			resourceServerUrl: mcpUrl,
			scopesSupported: [SCOPE],
			resourceName: 'Escola do Breno',
			// Client secrets are derived from the client id, so they cannot be expired individually.
			clientRegistrationOptions: { clientSecretExpirySeconds: 0 }
		})
	);

	app.post('/login', express.urlencoded({ extended: false, limit: '16kb' }), (req, res) => {
		const { login, password } = (req.body ?? {}) as Record<string, unknown>;
		const claims = typeof login === 'string' ? sealer.open<LoginClaims>('login', login) : null;
		if (!claims || typeof login !== 'string') {
			res.status(400).type('text').send('This sign-in request expired. Start again from your MCP client.');
			return;
		}
		if (limiter.locked()) {
			renderLoginPage(res, { login, claims, error: 'Too many failed attempts. Try again in 15 minutes.' }, 429);
			return;
		}
		if (typeof password !== 'string' || !verifyPassword(password, config.adminPasswordHash)) {
			limiter.fail();
			renderLoginPage(res, { login, claims, error: 'Wrong password.' }, 401);
			return;
		}
		limiter.reset();
		res.redirect(302, completeLogin(claims));
	});

	const bearer = requireBearerAuth({
		verifier: provider,
		requiredScopes: [SCOPE],
		resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpUrl)
	});

	// Stateless: each request gets its own server, so redeploys never strand a client session.
	app.post('/mcp', bearer, express.json({ limit: '4mb' }), async (req, res) => {
		const server = createMcpServer(breno);
		const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
		res.on('close', () => {
			void transport.close();
			void server.close();
		});
		try {
			await server.connect(transport);
			await transport.handleRequest(req, res, req.body);
		} catch (error) {
			console.error('MCP request failed', error);
			if (!res.headersSent) {
				res.status(500).json({
					jsonrpc: '2.0',
					error: { code: -32603, message: 'Internal server error' },
					id: null
				});
			}
		}
	});
	app.get('/mcp', bearer, (_req, res) => void res.status(405).set('Allow', 'POST').json(methodNotAllowed));
	app.delete('/mcp', bearer, (_req, res) => void res.status(405).set('Allow', 'POST').json(methodNotAllowed));

	return app;
}
