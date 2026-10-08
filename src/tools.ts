import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BrenoError, ENTRY_TYPES, REPEATS, type BrenoClient, type Entry } from './breno.ts';
import { invoiceDueDate, isIsoDate, todayInSaoPaulo } from './dates.ts';

/** A mistake in the call that the model can correct; the message is shown to it as is. */
class ToolError extends Error {}

const TYPE_GUIDE =
	'Entrada = income. Saida = a fixed or planned expense (rent, bills, subscriptions). ' +
	'Diario = day-to-day variable spending that counts against the daily budget (food, transport, leisure). ' +
	'Cartao = a credit card purchase, dated on the invoice due date. Economia = money set aside as savings.';

const date = z.string().refine(isIsoDate, 'Use a real calendar date as YYYY-MM-DD');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');
const amount = z.number().positive().max(100_000_000).describe('Amount in reais as a positive decimal, e.g. 45.9');
const type = z.enum(ENTRY_TYPES);
const tags = z.array(z.string().trim().min(1)).max(20);
const entryId = z.string().uuid().describe('Entry id, as returned by list_entries or add_entry');

const fold = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const cents = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

const text = (data: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] });

function describeEntry(entry: Entry) {
	return {
		id: entry.movimentacao_id,
		date: entry.data,
		description: entry.descricao,
		amount: entry.valor,
		type: entry.tipo,
		tags: entry.tag_nomes ?? [],
		...(entry.recorrencia_id ? { series_id: entry.recorrencia_id } : {})
	};
}

function monthRange(value: string) {
	const [year, monthNumber] = value.split('-').map(Number) as [number, number];
	const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
	return { from: `${value}-01`, to: `${value}-${String(lastDay).padStart(2, '0')}` };
}

export function createMcpServer(breno: BrenoClient): McpServer {
	const server = new McpServer({ name: 'escoladobreno', version: '0.1.1' });

	// Backend refusals and bad arguments go back as tool errors the model can read and act on.
	const run = (work: () => Promise<unknown>) => async () => {
		try {
			return text(await work());
		} catch (error) {
			if (error instanceof ToolError || error instanceof BrenoError) {
				return { ...text({ error: error.message }), isError: true };
			}
			console.error('Tool failed', error);
			return { ...text({ error: 'The connector failed unexpectedly; nothing is known about whether the change was saved.' }), isError: true };
		}
	};

	async function tagIds(names: string[]): Promise<string[]> {
		if (names.length === 0) return [];
		const existing = await breno.listTags();
		return names.map((name) => {
			const match = existing.find((tag) => fold(tag.nome) === fold(name));
			if (!match) {
				const known = existing.map((tag) => tag.nome).join(', ') || 'none yet';
				throw new ToolError(`No tag named "${name}". Existing tags: ${known}. Create it with create_tag first.`);
			}
			return match.id;
		});
	}

	async function findCard(name: string) {
		const cards = await breno.listCards();
		const match = cards.find((card) => fold(card.nome) === fold(name));
		if (!match) {
			const known = cards.map((card) => card.nome).join(', ') || 'none yet';
			throw new ToolError(`No card named "${name}". Existing cards: ${known}. Register it with create_card first.`);
		}
		return match;
	}

	async function requireEntry(id: string): Promise<Entry> {
		const entry = await breno.getEntry(id);
		if (!entry) throw new ToolError(`No entry with id ${id}.`);
		return entry;
	}

	server.registerTool(
		'list_tags',
		{
			title: 'List tags',
			description: 'Lists the tags that can be put on entries.',
			inputSchema: {},
			annotations: { readOnlyHint: true }
		},
		run(async () => ({ tags: (await breno.listTags()).map((tag) => ({ id: tag.id, name: tag.nome })) }))
	);

	server.registerTool(
		'create_tag',
		{
			title: 'Create tag',
			description: 'Creates a tag. Check list_tags first so an existing tag is reused rather than duplicated.',
			inputSchema: { name: z.string().trim().min(1).max(40) },
			annotations: { readOnlyHint: false, destructiveHint: false }
		},
		(args) =>
			run(async () => {
				const existing = (await breno.listTags()).find((tag) => fold(tag.nome) === fold(args.name));
				if (existing) throw new ToolError(`A tag named "${existing.nome}" already exists.`);
				const tag = await breno.createTag(args.name);
				return { created: { id: tag.id, name: tag.nome } };
			})()
	);

	server.registerTool(
		'list_cards',
		{
			title: 'List credit cards',
			description: 'Lists the registered credit cards with the day their invoice closes and the day it is due.',
			inputSchema: {},
			annotations: { readOnlyHint: true }
		},
		run(async () => ({
			cards: (await breno.listCards()).map((card) => ({
				id: card.id,
				name: card.nome,
				closing_day: card.dia_fechamento,
				due_day: card.dia_vencimento
			}))
		}))
	);

	server.registerTool(
		'create_card',
		{
			title: 'Register credit card',
			description: 'Registers a credit card. Ask the user for the closing day and due day; never guess them.',
			inputSchema: {
				name: z.string().trim().min(1).max(40),
				closing_day: z.number().int().min(1).max(31).describe('Day of the month the invoice closes'),
				due_day: z.number().int().min(1).max(31).describe('Day of the month the invoice is due')
			},
			annotations: { readOnlyHint: false, destructiveHint: false }
		},
		(args) =>
			run(async () => {
				const existing = (await breno.listCards()).find((card) => fold(card.nome) === fold(args.name));
				if (existing) throw new ToolError(`A card named "${existing.nome}" already exists.`);
				const card = await breno.createCard({ name: args.name, closingDay: args.closing_day, dueDay: args.due_day });
				return { created: { id: card.id, name: card.nome, closing_day: card.dia_fechamento, due_day: card.dia_vencimento } };
			})()
	);

	server.registerTool(
		'list_entries',
		{
			title: 'List entries',
			description:
				'Lists finance entries in a date range, newest first. Without dates it covers the current month. ' +
				'Use it to find an entry id before update_entry or delete_entry.',
			inputSchema: {
				from: date.optional().describe('First day, YYYY-MM-DD. Defaults to the first day of the current month.'),
				to: date.optional().describe('Last day, inclusive. Defaults to the last day of the month of `from`.'),
				type: type.optional().describe(TYPE_GUIDE),
				search: z.string().trim().min(1).max(80).optional().describe('Text the description must contain'),
				limit: z.number().int().min(1).max(500).default(100)
			},
			annotations: { readOnlyHint: true }
		},
		(args) =>
			run(async () => {
				const base = monthRange((args.from ?? todayInSaoPaulo()).slice(0, 7));
				const from = args.from ?? base.from;
				const to = args.to ?? base.to;
				if (to < from) throw new ToolError('`to` is before `from`.');
				// One extra row tells a full page apart from a cut-off one.
				const rows = await breno.listEntries({ from, to, type: args.type, search: args.search, limit: args.limit + 1 });
				const entries = rows.slice(0, args.limit).map(describeEntry);
				return { from, to, count: entries.length, truncated: rows.length > args.limit, entries };
			})()
	);

	server.registerTool(
		'month_summary',
		{
			title: 'Month summary',
			description:
				'Totals for one month as the app computes them: income, expenses, daily spending, savings, card spending, ' +
				'cost of living and the daily budget. Field names are the app\'s own, in Portuguese.',
			inputSchema: { month: month.optional().describe('YYYY-MM. Defaults to the current month.') },
			annotations: { readOnlyHint: true }
		},
		(args) =>
			run(async () => {
				const value = args.month ?? todayInSaoPaulo().slice(0, 7);
				return { month: value, totals: await breno.monthTotals(value) };
			})()
	);

	server.registerTool(
		'add_entry',
		{
			title: 'Add entry',
			description:
				'Adds a finance entry. Only `amount` and `description` are needed: the user usually gives just those two. ' +
				'For everything else apply the defaults (date today, type Diario, no tags, not repeating) without asking ' +
				'follow-up questions and without inferring a type or tag from the description. Set another field only when ' +
				'the user asked for it in this request. ' +
				TYPE_GUIDE +
				' After saving, tell the user in one line what was saved: amount, description, date and type.',
			inputSchema: {
				description: z.string().trim().min(1).max(200),
				amount,
				type: type.default('Diario').describe('Defaults to Diario. Change it only when the user names another type.'),
				date: date
					.optional()
					.describe('YYYY-MM-DD, defaults to today in São Paulo. With `card`, this is the purchase date.'),
				tags: tags
					.optional()
					.describe('Defaults to none. Tag names, which must already exist (see list_tags, create_tag).'),
				card: z
					.string()
					.trim()
					.min(1)
					.optional()
					.describe(
						'Card name, only with type Cartao. The entry is then dated on the due date of the invoice the purchase ' +
							'falls into. Without it, a Cartao entry is saved on `date` as given.'
					),
				repeat: z
					.enum(REPEATS)
					.optional()
					.describe(
						'Defaults to a single entry. Creates a series starting on the entry date. With "installments", `amount` is the purchase total and is ' +
							'split equally across monthly entries; with the others, `amount` is the value of each entry.'
					),
				repeat_count: z.number().int().min(2).max(99).optional().describe('Entries in the series. Defaults to 12.'),
				repeat_forever: z
					.boolean()
					.optional()
					.describe('Open-ended series (not for installments). The app materialises about two years of entries.')
			},
			annotations: { readOnlyHint: false, destructiveHint: false }
		},
		(args) =>
			run(async () => {
				if (args.card && args.type !== 'Cartao') throw new ToolError('`card` only applies to type Cartao.');
				if (!args.repeat && (args.repeat_count !== undefined || args.repeat_forever !== undefined)) {
					throw new ToolError('`repeat_count` and `repeat_forever` need `repeat`.');
				}
				if (args.repeat === 'installments' && args.repeat_forever) {
					throw new ToolError('Installments cannot repeat forever; give `repeat_count`.');
				}

				let day = args.date ?? todayInSaoPaulo();
				let note: string | undefined;
				if (args.card) {
					const card = await findCard(args.card);
					const purchase = day;
					day = invoiceDueDate(purchase, card.dia_fechamento, card.dia_vencimento);
					note = `Purchase on ${purchase} with ${card.nome}; saved on its invoice due date, ${day}.`;
				}
				const entry = {
					date: day,
					description: args.description,
					amount: cents(args.amount),
					type: args.type,
					tagIds: await tagIds(args.tags ?? [])
				};

				if (!args.repeat) {
					const id = await breno.createEntry(entry);
					const saved = typeof id === 'string' ? await breno.getEntry(id) : null;
					return { saved: saved ? describeEntry(saved) : { id }, ...(note ? { note } : {}) };
				}

				await breno.createSeries({
					...entry,
					repeat: args.repeat,
					count: args.repeat_count ?? 12,
					infinite: args.repeat_forever ?? false
				});
				// The series call does not hand back its entries, so read the first ones for confirmation.
				const first = await breno.listEntries({ from: day, to: '9999-12-31', search: args.description, limit: 500 });
				const series = first.filter((row) => row.recorrencia_id && row.descricao === args.description).reverse();
				return {
					saved_series: { entries: series.length, first: series.slice(0, 3).map(describeEntry) },
					...(note ? { note } : {})
				};
			})()
	);

	server.registerTool(
		'update_entry',
		{
			title: 'Update entry',
			description:
				'Changes one entry. Only the fields given change. `tags` replaces the whole tag list; pass [] to clear it. ' +
				'For an entry that belongs to a series, only that one occurrence changes.',
			inputSchema: {
				id: entryId,
				description: z.string().trim().min(1).max(200).optional(),
				amount: amount.optional(),
				type: type.optional().describe(TYPE_GUIDE),
				date: date.optional(),
				tags: tags.optional()
			},
			annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
		},
		(args) =>
			run(async () => {
				const { id, ...changes } = args;
				if (Object.values(changes).every((value) => value === undefined)) {
					throw new ToolError('Give at least one field to change.');
				}
				const before = await requireEntry(id);
				await breno.updateEntry({
					id,
					date: args.date,
					description: args.description,
					amount: args.amount === undefined ? undefined : cents(args.amount),
					type: args.type,
					tagIds: args.tags ? await tagIds(args.tags) : undefined
				});
				return { before: describeEntry(before), after: describeEntry(await requireEntry(id)) };
			})()
	);

	server.registerTool(
		'delete_entry',
		{
			title: 'Delete entry',
			description:
				'Permanently deletes one entry by id. Confirm with the user which entry is meant before calling. ' +
				'For an entry in a series, only that occurrence is deleted.',
			inputSchema: { id: entryId },
			annotations: { readOnlyHint: false, destructiveHint: true }
		},
		(args) =>
			run(async () => {
				const entry = await requireEntry(args.id);
				const removed = await breno.deleteEntry(args.id);
				if (removed === 0) throw new ToolError(`Entry ${args.id} was not deleted; it may already be gone.`);
				return { deleted: describeEntry(entry) };
			})()
	);

	return server;
}
