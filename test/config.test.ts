import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadConfig } from '../src/config.ts';
import { hashPassword, verifyPassword } from '../src/password.ts';

const login = { BRENO_EMAIL: 'me@example.com', BRENO_PASSWORD: 'app-password' };
const oneClick = { ...login, CONNECTOR_PASSWORD: 'a long connector password', VERCEL_PROJECT_PRODUCTION_URL: 'mine.vercel.app' };

test('an administered server keeps its explicit settings', () => {
	const hash = hashPassword('correct horse battery staple');
	const config = loadConfig({
		...login,
		PUBLIC_URL: 'https://mcp.example.com',
		SIGNING_SECRET: 'x'.repeat(64),
		ADMIN_PASSWORD_HASH: hash,
		// Present on the host, but an explicit setting wins.
		VERCEL_PROJECT_PRODUCTION_URL: 'ignored.vercel.app',
		CONNECTOR_PASSWORD: 'also ignored here'
	});
	assert.equal(config.publicUrl.href, 'https://mcp.example.com/');
	assert.equal(config.signingSecret, 'x'.repeat(64));
	assert.equal(config.adminPasswordHash, hash);
	assert.deepEqual([config.breno.email, config.breno.password], ['me@example.com', 'app-password']);
});

test('a one-click deployment needs only the login and a connector password', () => {
	const config = loadConfig(oneClick);
	assert.equal(config.publicUrl.href, 'https://mine.vercel.app/');
	assert.equal(verifyPassword('a long connector password', config.adminPasswordHash), true);
	assert.equal(verifyPassword('something else', config.adminPasswordHash), false);
	assert.match(config.signingSecret, /^[0-9a-f]{64}$/);
});

test('the derived signing secret is the same on every start and follows both passwords', () => {
	const secret = (changes: object) => loadConfig({ ...oneClick, ...changes }).signingSecret;
	assert.equal(secret({}), secret({}));
	assert.notEqual(secret({}), secret({ CONNECTOR_PASSWORD: 'another connector password' }));
	assert.notEqual(secret({}), secret({ BRENO_PASSWORD: 'changed-in-the-app' }));
	assert.notEqual(secret({}), secret({ BRENO_EMAIL: 'other@example.com' }));
});

test('missing or weak settings are refused with the variable named', () => {
	assert.throws(() => loadConfig({ ...oneClick, CONNECTOR_PASSWORD: 'short' }), /CONNECTOR_PASSWORD must be at least 12/);
	assert.throws(() => loadConfig({ ...oneClick, CONNECTOR_PASSWORD: undefined }), /CONNECTOR_PASSWORD/);
	assert.throws(() => loadConfig({ ...oneClick, BRENO_PASSWORD: ' ' }), /BRENO_PASSWORD/);
	assert.throws(() => loadConfig({ ...oneClick, VERCEL_PROJECT_PRODUCTION_URL: undefined }), /PUBLIC_URL/);
	// A hash alone says nothing a secret could be derived from.
	assert.throws(
		() => loadConfig({ ...login, PUBLIC_URL: 'https://x.example', ADMIN_PASSWORD_HASH: hashPassword('p'.repeat(12)) }),
		/SIGNING_SECRET/
	);
});
