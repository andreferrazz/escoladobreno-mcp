import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, test } from 'node:test';

// src/server.ts is what Vercel loads: it reads the environment once, at import, and its
// default export is the request handler. Each test imports a fresh copy.
const SETTINGS = ['BRENO_EMAIL', 'BRENO_PASSWORD', 'CONNECTOR_PASSWORD', 'VERCEL_PROJECT_PRODUCTION_URL', 'PUBLIC_URL', 'SIGNING_SECRET', 'ADMIN_PASSWORD_HASH'];
let copies = 0;

async function serve(env: Record<string, string>) {
	for (const name of SETTINGS) delete process.env[name];
	Object.assign(process.env, env);
	const { default: handler } = await import(`../src/server.ts?copy=${copies++}`);
	const server = createServer(handler);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
	return { base, close: () => void server.close() };
}

let running: Awaited<ReturnType<typeof serve>> | undefined;
afterEach(() => {
	running?.close();
	for (const name of SETTINGS) delete process.env[name];
});

test('with the three one-click settings it serves the connector at the address Vercel reports', async () => {
	running = await serve({
		BRENO_EMAIL: 'me@example.com',
		BRENO_PASSWORD: 'app-password',
		CONNECTOR_PASSWORD: 'a long connector password',
		VERCEL_PROJECT_PRODUCTION_URL: 'mine.vercel.app'
	});
	assert.deepEqual(await (await fetch(`${running.base}/healthz`)).json(), { status: 'ok' });
	const metadata = await (await fetch(`${running.base}/.well-known/oauth-authorization-server`)).json();
	assert.equal(metadata.issuer, 'https://mine.vercel.app/');
	assert.equal((await fetch(`${running.base}/mcp`, { method: 'POST' })).status, 401);
	// The landing page hands over the one thing to paste into Claude.
	assert.match(await (await fetch(running.base)).text(), /https:\/\/mine\.vercel\.app\/mcp/);
});

test('a bad setting is explained on the page instead of crashing the function', async () => {
	running = await serve({
		BRENO_EMAIL: 'me@example.com',
		BRENO_PASSWORD: 'app-password',
		CONNECTOR_PASSWORD: 'short',
		VERCEL_PROJECT_PRODUCTION_URL: 'mine.vercel.app'
	});
	for (const path of ['/', '/mcp', '/healthz']) {
		const res: Response = await fetch(`${running.base}${path}`);
		assert.equal(res.status, 500);
		const page = await res.text();
		assert.match(page, /CONNECTOR_PASSWORD must be at least 12 characters/);
		assert.doesNotMatch(page, /app-password|short/);
	}
});
