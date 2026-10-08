import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { after, before, test } from 'node:test';
import { fakeLogin, PASSWORD, startApp, startFakeBackend, type FakeBackend } from './harness.ts';

let backend: FakeBackend;
let app: Awaited<ReturnType<typeof startApp>>;

before(async () => {
	backend = await startFakeBackend();
	app = await startApp(fakeLogin(backend));
});

after(() => {
	app.close();
	backend.close();
});

test('publishes OAuth metadata that points at this origin', async () => {
	const as = await (await fetch(`${app.base}/.well-known/oauth-authorization-server`)).json();
	assert.equal(as.registration_endpoint, `${app.base}/register`);
	assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
	const pr = await (await fetch(`${app.base}/.well-known/oauth-protected-resource/mcp`)).json();
	assert.equal(pr.resource, `${app.base}/mcp`);
});

test('rejects MCP calls without a valid token', async () => {
	const missing = await app.mcp(null, {});
	assert.equal(missing.status, 401);
	assert.match(missing.headers.get('www-authenticate')!, /resource_metadata=/);
	assert.equal((await app.mcp('not-a-token', {})).status, 401);
});

test('full flow: register, password, token, list tools', async () => {
	const { tokens } = await app.signIn();
	const init = await app.rpc(tokens.access_token, 'initialize', {
		protocolVersion: '2025-03-26',
		capabilities: {},
		clientInfo: { name: 'test', version: '0' }
	});
	assert.equal(init.serverInfo.name, 'escoladobreno');
	const { tools } = await app.rpc(tokens.access_token, 'tools/list');
	assert.deepEqual(
		tools.map((tool: { name: string }) => tool.name).sort(),
		['add_entry', 'create_card', 'create_tag', 'delete_entry', 'list_cards', 'list_entries', 'list_tags', 'month_summary', 'update_entry']
	);
	// Listing tools must not need the app login: a wrong app password should not break sign-in.
	assert.equal(backend.state.logins, 0);
});

test('an authorization code works once, and only with its verifier', async () => {
	const { client, code, verifier } = await app.signIn();
	const replay = await app.token({
		grant_type: 'authorization_code',
		client_id: client.client_id,
		code,
		code_verifier: verifier
	});
	assert.equal(replay.status, 400);

	const fresh = await app.authorize(client.client_id);
	const wrongVerifier = await app.token({
		grant_type: 'authorization_code',
		client_id: client.client_id,
		code: fresh.code,
		code_verifier: randomBytes(32).toString('base64url')
	});
	assert.equal(wrongVerifier.status, 400);
});

test('refresh tokens renew access, but only for the client they were issued to', async () => {
	const { client, tokens } = await app.signIn();
	const renewed = await app.token({
		grant_type: 'refresh_token',
		client_id: client.client_id,
		refresh_token: tokens.refresh_token
	});
	assert.equal(renewed.status, 200);
	const { access_token } = (await renewed.json()) as { access_token: string };
	assert.ok((await app.rpc(access_token, 'tools/list')).tools.length > 0);

	const other = await app.register();
	const stolen = await app.token({
		grant_type: 'refresh_token',
		client_id: other.client_id,
		refresh_token: tokens.refresh_token
	});
	assert.equal(stolen.status, 400);
	// A refresh token is not accepted as an access token.
	assert.equal((await app.mcp(tokens.refresh_token, {})).status, 401);
});

test('confidential clients must present their secret', async () => {
	const client = await app.register('client_secret_post');
	assert.ok(client.client_secret);
	const { code, verifier } = await app.authorize(client.client_id);
	const exchange = { grant_type: 'authorization_code', client_id: client.client_id, code, code_verifier: verifier };
	assert.equal((await app.token({ ...exchange, client_secret: 'wrong' })).status, 400);
	assert.equal((await app.token({ ...exchange, client_secret: client.client_secret })).status, 200);
});

test('tampered or unknown client ids are refused', async () => {
	const client = await app.register();
	const res = await fetch(
		`${app.base}/authorize?response_type=code&code_challenge=x&code_challenge_method=S256&client_id=${client.client_id}x`
	);
	assert.equal(res.status, 400);
});

// Last: it trips the lockout shared by the whole app.
test('wrong passwords are refused, then the login locks', async () => {
	const client = await app.register();
	const login = await app.startLogin(client.client_id, 'challenge');
	for (let attempt = 0; attempt < 5; attempt++) {
		assert.equal((await fetch(`${app.base}/login`, app.form({ login, password: 'nope' }))).status, 401);
	}
	const locked = await fetch(`${app.base}/login`, app.form({ login, password: PASSWORD }));
	assert.equal(locked.status, 429);
	assert.equal((await fetch(`${app.base}/login`, app.form({ login: 'garbage', password: PASSWORD }))).status, 400);
});
