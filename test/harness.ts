import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from '../src/http.ts';
import type { BrenoOptions } from '../src/breno.ts';
import { hashPassword } from '../src/password.ts';

export const PASSWORD = 'correct horse battery staple';
export const REDIRECT = 'https://client.example/callback';
export const USER_ID = '11111111-1111-4111-8111-111111111111';

type Row = Record<string, unknown>;
export type Seen = { method: string; path: string; query: URLSearchParams; body: any; authorization?: string };

const listen = (server: Server) =>
	new Promise<string>((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve(`http://localhost:${(server.address() as AddressInfo).port}`))
	);

async function readJson(req: IncomingMessage) {
	let raw = '';
	for await (const chunk of req) raw += chunk;
	return raw ? JSON.parse(raw) : undefined;
}

/** Stands in for the app's Supabase backend: just enough PostgREST to exercise every tool. */
export async function startFakeBackend() {
	const state = {
		seen: [] as Seen[],
		tags: [] as Row[],
		cards: [] as Row[],
		entries: [] as Row[],
		logins: 0,
		/** How many of the next REST calls answer 401, as an expired session would. */
		expire: 0
	};
	let nextId = 1;
	const uuid = () => `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`;
	const eq = (query: URLSearchParams, key: string) => query.get(key)?.replace(/^eq\./, '');

	const server = createServer(async (req, res) => {
		const url = new URL(req.url!, 'http://backend');
		const body = await readJson(req);
		const path = url.pathname;
		state.seen.push({ method: req.method!, path, query: url.searchParams, body, authorization: req.headers.authorization });
		const send = (status: number, data?: unknown) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(data === undefined ? '' : JSON.stringify(data));
		};

		if (path === '/auth/v1/token') {
			if (body.password !== 'app-password') return send(400, { msg: 'Invalid login credentials' });
			state.logins += 1;
			return send(200, { access_token: `session-${state.logins}`, user: { id: USER_ID } });
		}
		if (state.expire > 0) {
			state.expire -= 1;
			return send(401, { message: 'JWT expired' });
		}
		if (req.headers.authorization !== `Bearer session-${state.logins}`) return send(401, { message: 'bad session' });

		const table = path.replace('/rest/v1', '');
		if (table === '/tag' || table === '/cartao') {
			const rows = table === '/tag' ? state.tags : state.cards;
			if (req.method === 'GET') return send(200, rows);
			const row = { id: uuid(), ...body };
			rows.push(row);
			return send(201, [row]);
		}
		if (table === '/conta') return send(204);
		if (table === '/view_movimentacao_all') {
			const id = eq(url.searchParams, 'movimentacao_id');
			const tipo = eq(url.searchParams, 'tipo');
			const search = url.searchParams.get('descricao')?.replace(/^ilike\.\*|\*$/g, '').toLowerCase();
			const [from, to] = url.searchParams.getAll('data').map((value) => value.replace(/^(gte|lte)\./, ''));
			const rows = state.entries
				.filter((row) => !id || row.movimentacao_id === id)
				.filter((row) => !tipo || row.tipo === tipo)
				.filter((row) => !search || String(row.descricao).toLowerCase().includes(search))
				.filter((row) => !from || !to || (String(row.data) >= from && String(row.data) <= to))
				.sort((a, b) => String(b.data).localeCompare(String(a.data)));
			return send(200, rows.slice(0, Number(url.searchParams.get('limit') ?? 1000)));
		}
		const tagNames = (ids: string[]) => ids.map((tagId) => state.tags.find((tag) => tag.id === tagId)?.nome);
		if (table === '/rpc/movimentacao_create_with_tags_v2') {
			const id = uuid();
			state.entries.push({
				movimentacao_id: id,
				data: body.p_data,
				descricao: body.p_descricao,
				valor: body.p_valor,
				tipo: body.p_tipo,
				recorrencia_id: null,
				tag_nomes: tagNames(body.p_tag_ids)
			});
			return send(200, id);
		}
		if (table === '/rpc/criar_movimentacoes_repetidas_v2') {
			const series = uuid();
			const start = new Date(body.p_data_inicial);
			for (let index = 0; index < body.p_quantidade_repeticoes; index++) {
				const day = new Date(start);
				day.setUTCMonth(start.getUTCMonth() + index);
				state.entries.push({
					movimentacao_id: uuid(),
					data: day.toISOString().slice(0, 10),
					descricao: body.p_descricao,
					valor: body.p_valor,
					tipo: body.p_tipo,
					recorrencia_id: series,
					tag_nomes: tagNames(body.p_tag_ids)
				});
			}
			return send(200, null);
		}
		if (table === '/rpc/movimentacao_update_with_tags_v2') {
			const row = state.entries.find((entry) => entry.movimentacao_id === body.p_mov);
			if (!row) return send(400, { message: 'movimentacao nao encontrada' });
			if (body.p_data !== null) row.data = body.p_data;
			if (body.p_descricao !== null) row.descricao = body.p_descricao;
			if (body.p_valor !== null) row.valor = body.p_valor;
			if (body.p_tipo !== null) row.tipo = body.p_tipo;
			if (body.p_tag_ids !== null) row.tag_nomes = tagNames(body.p_tag_ids);
			return send(204);
		}
		if (table === '/movimentacao' && req.method === 'DELETE') {
			const id = eq(url.searchParams, 'id');
			const gone = state.entries.filter((entry) => entry.movimentacao_id === id);
			state.entries = state.entries.filter((entry) => entry.movimentacao_id !== id);
			return send(200, gone);
		}
		if (table === '/rpc/get_totais_mes') return send(200, { total_diarios: 302.65, mes: body.mes_input });
		send(404, { message: `fake backend has no ${req.method} ${path}` });
	});

	const url = await listen(server);
	return {
		url,
		state,
		reset() {
			Object.assign(state, { seen: [], tags: [], cards: [], entries: [], expire: 0 });
		},
		/** Requests to one REST path, oldest first. */
		calls: (suffix: string) => state.seen.filter((seen) => seen.path.endsWith(suffix)),
		close() {
			server.closeAllConnections();
			server.close();
		}
	};
}

export type FakeBackend = Awaited<ReturnType<typeof startFakeBackend>>;

/** Login the fake backend accepts. */
export const fakeLogin = (backend: FakeBackend): BrenoOptions => ({
	supabaseUrl: backend.url,
	anonKey: 'anon',
	email: 'me@example.com',
	password: 'app-password'
});

/** The real app on a local port, plus an OAuth client to drive it. */
export async function startApp(breno: BrenoOptions) {
	const server = createServer();
	const base = await listen(server);
	server.on(
		'request',
		createApp({
			publicUrl: new URL(base),
			signingSecret: randomBytes(32).toString('hex'),
			adminPasswordHash: hashPassword(PASSWORD),
			port: 0,
			breno
		})
	);

	const form = (fields: Record<string, string>) => ({
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields),
		redirect: 'manual' as const
	});

	async function register(method = 'none') {
		const res = await fetch(`${base}/register`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ client_name: 'Test <client>', redirect_uris: [REDIRECT], token_endpoint_auth_method: method })
		});
		assert.equal(res.status, 201);
		return (await res.json()) as { client_id: string; client_secret?: string };
	}

	/** Starts an authorization and returns the sealed login the password page carries. */
	async function startLogin(clientId: string, challenge: string) {
		const url = new URL(`${base}/authorize`);
		url.search = new URLSearchParams({
			client_id: clientId,
			redirect_uri: REDIRECT,
			response_type: 'code',
			code_challenge: challenge,
			code_challenge_method: 'S256',
			state: 'xyz',
			scope: 'finance'
		}).toString();
		const res = await fetch(url);
		assert.equal(res.status, 200);
		const html = await res.text();
		assert.match(html, /Test &#60;client&#62;/);
		const login = /name="login" value="([^"]+)"/.exec(html)?.[1];
		assert.ok(login);
		return login;
	}

	async function authorize(clientId: string) {
		const verifier = randomBytes(32).toString('base64url');
		const challenge = createHash('sha256').update(verifier).digest('base64url');
		const login = await startLogin(clientId, challenge);
		const res = await fetch(`${base}/login`, form({ login, password: PASSWORD }));
		assert.equal(res.status, 302);
		const location = new URL(res.headers.get('location')!);
		assert.equal(location.origin + location.pathname, REDIRECT);
		assert.equal(location.searchParams.get('state'), 'xyz');
		return { code: location.searchParams.get('code')!, verifier };
	}

	const token = (fields: Record<string, string>) => fetch(`${base}/token`, form(fields));

	async function signIn() {
		const client = await register();
		const { code, verifier } = await authorize(client.client_id);
		const res = await token({
			grant_type: 'authorization_code',
			client_id: client.client_id,
			code,
			code_verifier: verifier,
			redirect_uri: REDIRECT
		});
		assert.equal(res.status, 200);
		const tokens = (await res.json()) as { access_token: string; refresh_token: string };
		return { client, code, verifier, tokens };
	}

	const mcp = (accessToken: string | null, body: object) =>
		fetch(`${base}/mcp`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json, text/event-stream',
				...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
			},
			body: JSON.stringify(body)
		});

	async function rpc(accessToken: string, method: string, params: object = {}) {
		const res = await mcp(accessToken, { jsonrpc: '2.0', id: 1, method, params });
		assert.equal(res.status, 200);
		const text = await res.text();
		const data = text.startsWith('{') ? text : /^data: (.+)$/m.exec(text)![1]!;
		return JSON.parse(data).result;
	}

	return {
		base,
		form,
		register,
		startLogin,
		authorize,
		token,
		signIn,
		mcp,
		rpc,
		close() {
			server.closeAllConnections();
			server.close();
		}
	};
}
