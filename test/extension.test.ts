import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { bundle } from '../scripts/build-extension.ts';
import { todayInSaoPaulo } from '../src/dates.ts';
import { startFakeBackend, type FakeBackend } from './harness.ts';

// The desktop extension as it ships: the bundled file, started the way Claude Desktop starts
// it (plain `node`, login in env vars), talking to the fake backend.
let backend: FakeBackend;
let dir: string;
let server: string;

before(async () => {
	backend = await startFakeBackend();
	dir = mkdtempSync(join(tmpdir(), 'escoladobreno-extension-'));
	server = join(dir, 'index.cjs');
	await bundle(server);
});

after(() => {
	backend.close();
	rmSync(dir, { recursive: true, force: true });
});

async function connect(password: string) {
	const client = new Client({ name: 'test', version: '0' });
	await client.connect(
		new StdioClientTransport({
			command: process.execPath,
			args: [server],
			// Only what the manifest passes, plus the backend override; nothing inherited from pnpm.
			env: { BRENO_EMAIL: 'me@example.com', BRENO_PASSWORD: password, BRENO_SUPABASE_URL: backend.url },
			stderr: 'pipe'
		})
	);
	return client;
}

const payload = (result: Awaited<ReturnType<Client['callTool']>>) =>
	JSON.parse((result.content as { text: string }[])[0]!.text);

test('the bundled extension serves the tools over stdio and saves a quick-add entry', async () => {
	const client = await connect('app-password');
	try {
		const { tools } = await client.listTools();
		assert.equal(tools.length, 9);
		const result = await client.callTool({ name: 'add_entry', arguments: { amount: 45, description: 'almoço' } });
		assert.notEqual(result.isError, true);
		assert.deepEqual(payload(result).saved, {
			id: payload(result).saved.id,
			date: todayInSaoPaulo(),
			description: 'almoço',
			amount: 45,
			type: 'Diario',
			tags: []
		});
	} finally {
		await client.close();
	}
});

test('a wrong password in the settings is reported in plain words on the first call', async () => {
	const client = await connect('typo');
	try {
		const result = await client.callTool({ name: 'list_tags', arguments: {} });
		assert.equal(result.isError, true);
		assert.match(payload(result).error, /refused the e-mail or password/);
	} finally {
		await client.close();
	}
});

test('every tool the manifest advertises exists, and none is missing from it', async () => {
	const { default: manifest } = await import('../extension/manifest.json', { with: { type: 'json' } });
	const client = await connect('app-password');
	try {
		const served = (await client.listTools()).tools.map((tool) => tool.name).sort();
		assert.deepEqual(manifest.tools.map((tool: { name: string }) => tool.name).sort(), served);
	} finally {
		await client.close();
	}
});
