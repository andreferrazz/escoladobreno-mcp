# escoladobreno-mcp

An MCP server for the finance app at [app.escoladobreno.com](https://app.escoladobreno.com), so
Claude can add and look up entries without opening the app. It serves the tools over Streamable
HTTP behind its own OAuth sign-in, which is what remote clients such as claude.ai need.

The app has no public API. This talks to its Supabase backend the way its web client does, signed
in as one account. An app update can change those endpoints and break a tool.

- `POST /mcp`: the tools, bearer token required.
- OAuth 2.1 authorization server on the same origin: dynamic client registration, PKCE, refresh
  tokens. The consent step is a single admin password.
- No database. Client ids, codes and tokens are HMAC-signed values, so redeploys do not sign
  clients out. The cost: one token cannot be revoked on its own. Rotating `SIGNING_SECRET`
  revokes everything.

The OAuth code (`seal.ts`, `provider.ts`, `password.ts`, `login-page.ts`, most of `app.ts`) is
copied from `dokploy-mcp-gateway`; a fix in one belongs in the other.

## Tools

| Tool | What it does |
| --- | --- |
| `add_entry` | One entry, or a repeating or instalment series |
| `list_entries` | Entries in a date range, optional type and text filter |
| `update_entry` | Change one entry |
| `delete_entry` | Delete one entry by id |
| `month_summary` | The app's totals for a month |
| `list_tags`, `create_tag` | Tags |
| `list_cards`, `create_card` | Credit cards and their closing and due days |

`add_entry` needs only an amount and a description. The rest defaults to: today (São Paulo
time), type `Diario`, no tags, not repeating. Its description tells the model to apply those
without asking and to change one only when the user says so.

Entry types are the app's: `Entrada`, `Saida`, `Diario`, `Cartao`, `Economia`. A `Cartao` entry
given a card is saved on the due date of the invoice the purchase falls into, as the app does.

Series deletes, account reset and profile calls exist in the backend and are deliberately not
exposed.

## Configuration

See `.env.example`.

```sh
openssl rand -hex 32   # SIGNING_SECRET
pnpm hash-password     # ADMIN_PASSWORD_HASH, prompts for the password
```

## Develop

```sh
pnpm install
pnpm check
pnpm test              # OAuth flow and every tool, against a fake backend
pnpm smoke             # live: needs BRENO_EMAIL and BRENO_PASSWORD in .env
pnpm dev               # needs the full .env
```

`pnpm smoke` writes one R$ 0.01 entry named "TESTE MCP (apagar)" to the real account, then
updates and deletes it. Run it after the app ships an update to see whether the endpoints
still behave.

## Deploy

Build the `Dockerfile`, set the variables above, route a domain to port 3000. `PUBLIC_URL` must
be that domain's `https://` origin. In claude.ai, add a custom connector with the URL
`<PUBLIC_URL>/mcp`; in Claude Code, `claude mcp add --transport http escoladobreno <PUBLIC_URL>/mcp`.
