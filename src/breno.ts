// Client for the private backend of app.escoladobreno.com (Supabase Auth + PostgREST).
// The endpoints and payloads mirror what the web app itself sends; none of it is a public API.

export const DEFAULT_SUPABASE_URL = 'https://biijnyhamoyzanriocil.supabase.co';
// The app's public "anon" key, shipped in its JavaScript bundle. It identifies the project,
// not the user; access comes from the signed-in session.
export const DEFAULT_ANON_KEY =
	'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaWpueWhhbW95emFucmlvY2lsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ4Njg3MzMsImV4cCI6MjA3MDQ0NDczM30.nlgHA3vqlehWSdNQmYCBmA33VLD9TCNYYenyiRtzsLg';

export const ENTRY_TYPES = ['Entrada', 'Saida', 'Diario', 'Cartao', 'Economia'] as const;
export type EntryType = (typeof ENTRY_TYPES)[number];

export const REPEATS = ['daily', 'weekly', 'monthly', 'yearly', 'installments'] as const;
export type Repeat = (typeof REPEATS)[number];

// The app's own names for each repeat, and how many entries an "infinite" series creates.
const FREQUENCY: Record<Repeat, string> = {
	daily: 'diariamente',
	weekly: 'semanalmente',
	monthly: 'mensalmente',
	yearly: 'anualmente',
	installments: 'mensalmente'
};
const INFINITE_COUNT: Record<Repeat, number> = { daily: 730, weekly: 104, monthly: 24, yearly: 2, installments: 12 };
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);

export type BrenoOptions = { supabaseUrl: string; anonKey: string; email: string; password: string };

export type Tag = { id: string; nome: string; cor: number | string | null };
export type Card = { id: string; nome: string; dia_fechamento: number; dia_vencimento: number };
export type Entry = {
	movimentacao_id: string;
	data: string;
	descricao: string;
	valor: number;
	tipo: EntryType;
	recorrencia_id: string | null;
	tag_nomes: string[] | null;
};

export type NewEntry = { date: string; description: string; amount: number; type: EntryType; tagIds: string[] };
export type NewSeries = NewEntry & { repeat: Repeat; count: number; infinite: boolean };
export type EntryPatch = { id: string; date?: string; description?: string; amount?: number; type?: EntryType; tagIds?: string[] };
export type EntryFilter = { from: string; to: string; type?: EntryType; search?: string; limit: number };

/** A failure worth showing to the model as is: what the backend refused and why. */
export class BrenoError extends Error {}

type Session = { token: string; userId: string };
type Request = { query?: Record<string, string | string[]>; body?: unknown; prefer?: string };

export function createBrenoClient(options: BrenoOptions) {
	let session: Session | null = null;
	let signingIn: Promise<Session> | null = null;

	const headers = { apikey: options.anonKey, 'Content-Type': 'application/json' };

	async function parse(res: Response): Promise<unknown> {
		const text = await res.text();
		let data: unknown = null;
		try {
			data = text ? JSON.parse(text) : null;
		} catch {
			data = text;
		}
		if (res.ok) return data;
		const detail = data as { message?: string; msg?: string; error_description?: string; hint?: string } | string | null;
		const message =
			typeof detail === 'string'
				? detail.slice(0, 300)
				: [detail?.message ?? detail?.msg ?? detail?.error_description, detail?.hint].filter(Boolean).join(' ');
		throw new BrenoError(`Escola do Breno backend answered ${res.status}${message ? `: ${message}` : ''}`);
	}

	async function signIn(): Promise<Session> {
		const res = await fetch(`${options.supabaseUrl}/auth/v1/token?grant_type=password`, {
			method: 'POST',
			headers,
			body: JSON.stringify({ email: options.email, password: options.password }),
			signal: AbortSignal.timeout(15_000)
		});
		// Supabase answers 400 for a wrong e-mail or password; say so in words the user can act on.
		if (res.status === 400) {
			throw new BrenoError(
				'The Escola do Breno app refused the e-mail or password this connector is configured with. ' +
					'Ask the user to correct them in the connector settings; nothing was read or saved.'
			);
		}
		const data = (await parse(res)) as { access_token: string; user: { id: string } };
		return { token: data.access_token, userId: data.user.id };
	}

	// One sign-in at a time, shared by every request that arrives while it is in flight.
	function getSession(): Promise<Session> {
		if (session) return Promise.resolve(session);
		signingIn ??= signIn()
			.then((fresh) => (session = fresh))
			.finally(() => (signingIn = null));
		return signingIn;
	}

	async function rest<T>(method: string, path: string, request: Request = {}, retry = true): Promise<T> {
		const { token } = await getSession();
		const url = new URL(`${options.supabaseUrl}/rest/v1${path}`);
		for (const [key, value] of Object.entries(request.query ?? {})) {
			for (const item of [value].flat()) url.searchParams.append(key, item);
		}
		const res = await fetch(url, {
			method,
			headers: { ...headers, Authorization: `Bearer ${token}`, ...(request.prefer ? { Prefer: request.prefer } : {}) },
			body: request.body === undefined ? undefined : JSON.stringify(request.body),
			signal: AbortSignal.timeout(15_000)
		});
		// The session lasts a week; when it lapses, sign in again and repeat the call once.
		if (res.status === 401 && retry) {
			session = null;
			return rest<T>(method, path, request, false);
		}
		return (await parse(res)) as T;
	}

	const userId = async () => (await getSession()).userId;
	const mine = async () => ({ user_id: `eq.${await userId()}` });

	// The app stamps the account after every write so its other open sessions refetch.
	async function touch() {
		try {
			await rest('PATCH', '/conta', {
				query: await mine(),
				body: { movimentacao_updated_at: new Date().toISOString() },
				prefer: 'return=minimal'
			});
		} catch {
			// Best effort, as in the app: the write itself already succeeded.
		}
	}

	return {
		async listTags(): Promise<Tag[]> {
			return rest('GET', '/tag', { query: { select: '*', order: 'nome.asc', ...(await mine()) } });
		},

		async createTag(name: string): Promise<Tag> {
			const rows = await rest<Tag[]>('POST', '/tag', {
				body: {
					conta_custo_vida: true,
					conta_diario_medio: true,
					conta_economizado: true,
					conta_performance: true,
					conta_saldo_dia: true,
					// Index into the app's colour palette; 4 is what its own "new tag" form starts on.
					cor: 4,
					nome: name,
					user_id: await userId()
				},
				prefer: 'return=representation'
			});
			if (!rows?.[0]) throw new BrenoError('The backend accepted the tag but returned nothing.');
			return rows[0];
		},

		async listCards(): Promise<Card[]> {
			return rest('GET', '/cartao', { query: { select: '*', order: 'nome.asc', ...(await mine()) } });
		},

		async createCard(card: { name: string; closingDay: number; dueDay: number }): Promise<Card> {
			const rows = await rest<Card[]>('POST', '/cartao', {
				body: { dia_fechamento: card.closingDay, dia_vencimento: card.dueDay, nome: card.name, user_id: await userId() },
				prefer: 'return=representation'
			});
			if (!rows?.[0]) throw new BrenoError('The backend accepted the card but returned nothing.');
			return rows[0];
		},

		async listEntries(filter: EntryFilter): Promise<Entry[]> {
			return rest('GET', '/view_movimentacao_all', {
				query: {
					select: '*',
					...(await mine()),
					data: [`gte.${filter.from}`, `lte.${filter.to}`],
					...(filter.type ? { tipo: `eq.${filter.type}` } : {}),
					...(filter.search ? { descricao: `ilike.*${filter.search.replaceAll('*', '')}*` } : {}),
					order: 'data.desc,created_at.desc',
					limit: String(filter.limit)
				}
			});
		},

		async getEntry(id: string): Promise<Entry | null> {
			const rows = await rest<Entry[]>('GET', '/view_movimentacao_all', {
				query: { select: '*', movimentacao_id: `eq.${id}`, ...(await mine()), limit: '1' }
			});
			return rows[0] ?? null;
		},

		async createEntry(entry: NewEntry): Promise<unknown> {
			const created = await rest('POST', '/rpc/movimentacao_create_with_tags_v2', {
				body: {
					p_data: entry.date,
					p_descricao: entry.description,
					p_tag_ids: entry.tagIds,
					p_tipo: entry.type,
					p_user: await userId(),
					p_valor: entry.amount
				}
			});
			await touch();
			return created;
		},

		/** For installments, `amount` is the total and each entry gets an equal share. */
		async createSeries(series: NewSeries): Promise<unknown> {
			const installments = series.repeat === 'installments';
			const infinite = series.infinite && !installments;
			const count = infinite ? INFINITE_COUNT[series.repeat] : series.count;
			const created = await rest('POST', '/rpc/criar_movimentacoes_repetidas_v2', {
				body: {
					p_data_inicial: `${series.date}T00:00:00Z`,
					p_descricao: series.description,
					p_frequencia: FREQUENCY[series.repeat],
					p_infinita: infinite,
					p_numero_repeticoes: count,
					p_periodicidade_recorrencia: capitalize(FREQUENCY[series.repeat]),
					p_quantidade_repeticoes: count,
					p_tag_ids: series.tagIds,
					p_tipo: series.type,
					p_user_id: await userId(),
					p_valor: installments ? Math.round((series.amount / count + Number.EPSILON) * 100) / 100 : series.amount
				}
			});
			await touch();
			return created;
		},

		/** Fields left out keep their value; the backend reads null as "unchanged". */
		async updateEntry(patch: EntryPatch): Promise<void> {
			await rest('POST', '/rpc/movimentacao_update_with_tags_v2', {
				body: {
					p_data: patch.date ?? null,
					p_descricao: patch.description ?? null,
					p_mov: patch.id,
					p_tag_ids: patch.tagIds ?? null,
					p_tipo: patch.type ?? null,
					p_user: await userId(),
					p_valor: patch.amount ?? null
				}
			});
			await touch();
		},

		/** Returns how many rows went away: 0 means the id was not one of the user's entries. */
		async deleteEntry(id: string): Promise<number> {
			const rows = await rest<unknown[]>('DELETE', '/movimentacao', {
				query: { id: `eq.${id}`, ...(await mine()) },
				prefer: 'return=representation'
			});
			await touch();
			return rows?.length ?? 0;
		},

		async monthTotals(month: string): Promise<unknown> {
			return rest('POST', '/rpc/get_totais_mes', { body: { mes_input: `${month}-01`, user_input: await userId() } });
		}
	};
}

export type BrenoClient = ReturnType<typeof createBrenoClient>;
