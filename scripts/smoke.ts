// Live check against the real account: `pnpm smoke`, with BRENO_EMAIL and BRENO_PASSWORD in .env.
// It goes through the whole stack (OAuth sign-in, MCP call, backend) and writes one R$ 0.01 entry,
// which it updates and deletes again. A leftover would be named "TESTE MCP (apagar)".
import assert from 'node:assert/strict';
import { DEFAULT_ANON_KEY, DEFAULT_SUPABASE_URL } from '../src/breno.ts';
import { todayInSaoPaulo } from '../src/dates.ts';
import { startApp } from '../test/harness.ts';

const { BRENO_EMAIL: email, BRENO_PASSWORD: password } = process.env;
if (!email || !password) throw new Error('Set BRENO_EMAIL and BRENO_PASSWORD (node --env-file=.env)');

const LABEL = 'TESTE MCP (apagar)';
const app = await startApp({ supabaseUrl: DEFAULT_SUPABASE_URL, anonKey: DEFAULT_ANON_KEY, email, password });
const accessToken = (await app.signIn()).tokens.access_token;

async function call(name: string, args: object = {}) {
	const result = await app.rpc(accessToken, 'tools/call', { name, arguments: args });
	const data = JSON.parse(result.content[0].text);
	assert.notEqual(result.isError, true, `${name} failed: ${data.error}`);
	return data;
}
const leftovers = async () => (await call('list_entries', { search: 'TESTE MCP' })).entries as { id: string }[];

try {
	const today = todayInSaoPaulo();
	assert.deepEqual(await leftovers(), [], 'a test entry from an earlier run is still there');

	const { saved } = await call('add_entry', { amount: 0.01, description: LABEL });
	assert.deepEqual(saved, { id: saved.id, date: today, description: LABEL, amount: 0.01, type: 'Diario', tags: [] });
	console.log(`added    ${saved.id}: R$ ${saved.amount} ${saved.type} on ${saved.date}`);

	assert.deepEqual((await leftovers()).map((entry) => entry.id), [saved.id]);
	console.log('listed   found by search in the current month');

	const { after } = await call('update_entry', { id: saved.id, amount: 0.02, type: 'Saida' });
	assert.deepEqual(after, { ...saved, amount: 0.02, type: 'Saida' });
	console.log(`updated  R$ ${after.amount} ${after.type}`);

	await call('delete_entry', { id: saved.id });
	assert.deepEqual(await leftovers(), []);
	console.log('deleted  and no test entry is left');

	const summary = await call('month_summary');
	assert.equal(typeof summary.totals.total_diarios, 'number');
	const tags = (await call('list_tags')).tags.length;
	const cards = (await call('list_cards')).cards.length;
	console.log(`read     month ${summary.month}: total_diarios ${summary.totals.total_diarios}; ${tags} tags, ${cards} cards`);
} finally {
	// Whatever failed above, do not leave a test entry in the account.
	for (const entry of await leftovers().catch(() => [])) await call('delete_entry', { id: entry.id });
	app.close();
}
