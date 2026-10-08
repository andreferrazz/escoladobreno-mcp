import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { invoiceDueDate, isIsoDate, todayInSaoPaulo } from '../src/dates.ts';
import { fakeLogin, startApp, startFakeBackend, USER_ID, type FakeBackend } from './harness.ts';

let backend: FakeBackend;
let app: Awaited<ReturnType<typeof startApp>>;
let accessToken: string;

before(async () => {
	backend = await startFakeBackend();
	app = await startApp(fakeLogin(backend));
	accessToken = (await app.signIn()).tokens.access_token;
});

beforeEach(() => backend.reset());

after(() => {
	app.close();
	backend.close();
});

/** Calls a tool and returns its JSON payload; `failed` is the MCP `isError` flag. */
async function call(name: string, args: object = {}) {
	const result = await app.rpc(accessToken, 'tools/call', { name, arguments: args });
	return { failed: result.isError === true, data: JSON.parse(result.content[0].text) };
}

const lastBody = (suffix: string) => backend.calls(suffix).at(-1)?.body;

test('quick add: amount and description alone save a Diario entry for today, untagged, not repeating', async () => {
	const { failed, data } = await call('add_entry', { amount: 45, description: 'almoço' });
	assert.equal(failed, false);
	assert.deepEqual(lastBody('/rpc/movimentacao_create_with_tags_v2'), {
		p_data: todayInSaoPaulo(),
		p_descricao: 'almoço',
		p_tag_ids: [],
		p_tipo: 'Diario',
		p_user: USER_ID,
		p_valor: 45
	});
	assert.equal(backend.calls('/rpc/criar_movimentacoes_repetidas_v2').length, 0);
	assert.deepEqual(data.saved, {
		id: data.saved.id,
		date: todayInSaoPaulo(),
		description: 'almoço',
		amount: 45,
		type: 'Diario',
		tags: []
	});
	// The app stamps the account after a write; so must we.
	const touch = backend.calls('/conta').at(-1)!;
	assert.equal(touch.method, 'PATCH');
	assert.equal(touch.query.get('user_id'), `eq.${USER_ID}`);
});

test('explicit type, date and tags override the defaults; tag names match loosely', async () => {
	backend.state.tags.push({ id: 'tag-1', nome: 'Salário' });
	const { data } = await call('add_entry', {
		amount: 5000.555,
		description: 'salário',
		type: 'Entrada',
		date: '2026-10-05',
		tags: ['salario']
	});
	const body = lastBody('/rpc/movimentacao_create_with_tags_v2');
	assert.equal(body.p_tipo, 'Entrada');
	assert.equal(body.p_data, '2026-10-05');
	assert.deepEqual(body.p_tag_ids, ['tag-1']);
	assert.equal(body.p_valor, 5000.56);
	assert.deepEqual(data.saved.tags, ['Salário']);
});

test('an unknown tag is refused before anything is written', async () => {
	backend.state.tags.push({ id: 'tag-1', nome: 'Mercado' });
	const { failed, data } = await call('add_entry', { amount: 10, description: 'x', tags: ['lazer'] });
	assert.equal(failed, true);
	assert.match(data.error, /No tag named "lazer".*Existing tags: Mercado/);
	assert.equal(backend.calls('/rpc/movimentacao_create_with_tags_v2').length, 0);
});

test('invalid arguments never reach the backend', async () => {
	for (const args of [
		{ amount: -5, description: 'x' },
		{ amount: 5, description: '  ' },
		{ amount: 5, description: 'x', date: '2026-02-30' },
		{ amount: 5, description: 'x', type: 'Despesa' }
	]) {
		const result = await app.rpc(accessToken, 'tools/call', { name: 'add_entry', arguments: args });
		assert.equal(result.isError, true, JSON.stringify(args));
	}
	assert.equal(backend.state.seen.length, 0);
});

test('a card purchase is saved on the due date of the invoice it falls into', async () => {
	backend.state.cards.push({ id: 'card-1', nome: 'Nubank', dia_fechamento: 25, dia_vencimento: 5 });
	const { data } = await call('add_entry', {
		amount: 120,
		description: 'tênis',
		type: 'Cartao',
		card: 'nubank',
		date: '2026-10-26'
	});
	assert.equal(lastBody('/rpc/movimentacao_create_with_tags_v2').p_data, '2026-12-05');
	assert.equal(data.saved.type, 'Cartao');
	assert.match(data.note, /Purchase on 2026-10-26 with Nubank.*2026-12-05/);

	const wrongType = await call('add_entry', { amount: 1, description: 'x', card: 'Nubank' });
	assert.equal(wrongType.failed, true);
	assert.match(wrongType.data.error, /only applies to type Cartao/);
});

test('a Cartao entry without a card keeps the date given', async () => {
	await call('add_entry', { amount: 30, description: 'uber', type: 'Cartao', date: '2026-10-08' });
	assert.equal(lastBody('/rpc/movimentacao_create_with_tags_v2').p_data, '2026-10-08');
});

test('installments split the total and use the app\'s series payload', async () => {
	const { data } = await call('add_entry', {
		amount: 100,
		description: 'geladeira',
		type: 'Saida',
		date: '2026-10-10',
		repeat: 'installments',
		repeat_count: 3
	});
	assert.deepEqual(lastBody('/rpc/criar_movimentacoes_repetidas_v2'), {
		p_data_inicial: '2026-10-10T00:00:00Z',
		p_descricao: 'geladeira',
		p_frequencia: 'mensalmente',
		p_infinita: false,
		p_numero_repeticoes: 3,
		p_periodicidade_recorrencia: 'Mensalmente',
		p_quantidade_repeticoes: 3,
		p_tag_ids: [],
		p_tipo: 'Saida',
		p_user_id: USER_ID,
		p_valor: 33.33
	});
	assert.equal(backend.calls('/rpc/movimentacao_create_with_tags_v2').length, 0);
	assert.equal(data.saved_series.entries, 3);
	assert.equal(data.saved_series.first[0].date, '2026-10-10');
});

test('an open-ended weekly series asks for the count the app uses', async () => {
	await call('add_entry', { amount: 20, description: 'feira', repeat: 'weekly', repeat_forever: true });
	const body = lastBody('/rpc/criar_movimentacoes_repetidas_v2');
	assert.equal(body.p_infinita, true);
	assert.equal(body.p_quantidade_repeticoes, 104);
	assert.equal(body.p_frequencia, 'semanalmente');
	assert.equal(body.p_valor, 20);

	const forever = await call('add_entry', { amount: 1, description: 'x', repeat: 'installments', repeat_forever: true });
	assert.equal(forever.failed, true);
	const orphan = await call('add_entry', { amount: 1, description: 'x', repeat_count: 3 });
	assert.match(orphan.data.error, /need `repeat`/);
});

test('update sends only the fields given and reports before and after', async () => {
	const id = (await call('add_entry', { amount: 45, description: 'almoço' })).data.saved.id;
	const { data } = await call('update_entry', { id, amount: 54 });
	assert.deepEqual(lastBody('/rpc/movimentacao_update_with_tags_v2'), {
		p_data: null,
		p_descricao: null,
		p_mov: id,
		p_tag_ids: null,
		p_tipo: null,
		p_user: USER_ID,
		p_valor: 54
	});
	assert.equal(data.before.amount, 45);
	assert.equal(data.after.amount, 54);
	assert.equal(data.after.description, 'almoço');

	const empty = await call('update_entry', { id });
	assert.match(empty.data.error, /at least one field/);
	const missing = await call('update_entry', { id: '99999999-9999-4999-8999-999999999999', amount: 1 });
	assert.match(missing.data.error, /No entry with id/);
	assert.equal(backend.calls('/rpc/movimentacao_update_with_tags_v2').length, 1);
});

test('delete removes one entry, scoped to the user, and refuses an unknown id', async () => {
	const id = (await call('add_entry', { amount: 45, description: 'almoço' })).data.saved.id;
	const { data } = await call('delete_entry', { id });
	assert.equal(data.deleted.description, 'almoço');
	const request = backend.calls('/movimentacao').find((seen) => seen.method === 'DELETE')!;
	assert.equal(request.query.get('id'), `eq.${id}`);
	assert.equal(request.query.get('user_id'), `eq.${USER_ID}`);
	assert.equal(backend.state.entries.length, 0);

	const again = await call('delete_entry', { id });
	assert.equal(again.failed, true);
	assert.equal(backend.calls('/movimentacao').filter((seen) => seen.method === 'DELETE').length, 1);
});

test('list_entries covers the current month by default and says when it is cut off', async () => {
	const today = todayInSaoPaulo();
	for (const description of ['a', 'b', 'c']) await call('add_entry', { amount: 1, description });
	const { data } = await call('list_entries', { limit: 2 });
	assert.equal(data.from, `${today.slice(0, 7)}-01`);
	assert.equal(data.to.slice(0, 7), today.slice(0, 7));
	assert.equal(data.count, 2);
	assert.equal(data.truncated, true);
	const query = backend.calls('/view_movimentacao_all').at(-1)!.query;
	assert.deepEqual(query.getAll('data'), [`gte.${data.from}`, `lte.${data.to}`]);
	assert.equal(query.get('user_id'), `eq.${USER_ID}`);

	const filtered = await call('list_entries', { from: '2026-02-01', type: 'Saida', search: 'alu*guel' });
	assert.equal(filtered.data.to, '2026-02-28');
	const filter = backend.calls('/view_movimentacao_all').at(-1)!.query;
	assert.equal(filter.get('tipo'), 'eq.Saida');
	assert.equal(filter.get('descricao'), 'ilike.*aluguel*');
	assert.equal((await call('list_entries', { from: '2026-02-10', to: '2026-02-01' })).failed, true);
});

test('tags and cards: list, create, and refuse duplicates', async () => {
	const tag = await call('create_tag', { name: 'Mercado' });
	assert.equal(tag.data.created.name, 'Mercado');
	assert.equal(lastBody('/tag').user_id, USER_ID);
	assert.equal((await call('create_tag', { name: 'mercado' })).failed, true);
	assert.deepEqual((await call('list_tags')).data.tags, [{ id: tag.data.created.id, name: 'Mercado' }]);

	const card = await call('create_card', { name: 'Nubank', closing_day: 25, due_day: 5 });
	assert.deepEqual(lastBody('/cartao'), { dia_fechamento: 25, dia_vencimento: 5, nome: 'Nubank', user_id: USER_ID });
	assert.equal((await call('create_card', { name: 'NUBANK', closing_day: 1, due_day: 10 })).failed, true);
	assert.deepEqual((await call('list_cards')).data.cards, [
		{ id: card.data.created.id, name: 'Nubank', closing_day: 25, due_day: 5 }
	]);
});

test('month_summary asks for the first day of the month', async () => {
	const { data } = await call('month_summary', { month: '2026-09' });
	assert.deepEqual(lastBody('/rpc/get_totais_mes'), { mes_input: '2026-09-01', user_input: USER_ID });
	assert.equal(data.totals.total_diarios, 302.65);
});

test('an expired app session is renewed once and the call repeated', async () => {
	await call('list_tags');
	const logins = backend.state.logins;
	backend.state.expire = 1;
	assert.equal((await call('list_tags')).failed, false);
	assert.equal(backend.state.logins, logins + 1);

	// A backend that keeps refusing is reported, not retried forever.
	backend.state.expire = 5;
	const refused = await call('list_tags');
	assert.equal(refused.failed, true);
	assert.match(refused.data.error, /answered 401: JWT expired/);
	// 1 plain call, then 401 + retry, then 401 + one retry that also fails.
	assert.equal(backend.calls('/tag').length, 5);
});

test('invoice due dates follow the closing day, the due day and short months', () => {
	// Bought before closing: this month's invoice, due next month when the due day is not after the closing.
	assert.equal(invoiceDueDate('2026-10-08', 25, 5), '2026-11-05');
	// Bought on the closing day still makes that invoice; the day after does not.
	assert.equal(invoiceDueDate('2026-10-25', 25, 5), '2026-11-05');
	assert.equal(invoiceDueDate('2026-10-26', 25, 5), '2026-12-05');
	// Due day after the closing day: same month as the closing.
	assert.equal(invoiceDueDate('2026-10-03', 5, 15), '2026-10-15');
	assert.equal(invoiceDueDate('2026-10-06', 5, 15), '2026-11-15');
	// Across the year end, and days that a month does not have.
	assert.equal(invoiceDueDate('2026-12-28', 25, 5), '2027-02-05');
	assert.equal(invoiceDueDate('2027-02-10', 31, 30), '2027-03-30');
	assert.equal(invoiceDueDate('2027-01-31', 31, 30), '2027-02-28');
});

test('date helpers', () => {
	assert.equal(isIsoDate('2028-02-29'), true);
	assert.equal(isIsoDate('2027-02-29'), false);
	assert.equal(isIsoDate('27-02-01'), false);
	// 02:30 UTC is still the previous evening in São Paulo.
	assert.equal(todayInSaoPaulo(new Date('2026-10-08T02:30:00Z')), '2026-10-07');
});
