# escoladobreno-mcp

Conecta o Claude ao app de finanças [app.escoladobreno.com](https://app.escoladobreno.com): você
diz "45 almoço" e o lançamento aparece no app, sem abrir o app.

> **Projeto não oficial.** Não tem vínculo com a Escola do Breno. Usa a mesma API interna do
> aplicativo web, que não é pública e pode mudar sem aviso; se isso acontecer, a extensão para de
> funcionar até ser atualizada. Use por sua conta e risco.

## Instalar no Claude Desktop

Funciona no aplicativo Claude para **macOS e Windows**. Não funciona no claude.ai pelo navegador
nem no celular.

1. Baixe o arquivo `escoladobreno.mcpb` na página de
   [releases](https://github.com/andreferrazz/escoladobreno-mcp/releases/latest).
2. Abra o arquivo (duplo clique). O Claude mostra uma tela de instalação. Se o duplo clique não
   abrir o Claude, vá em **Ajustes → Extensões** e arraste o arquivo para lá.
3. Clique em **Instalar** e preencha o e-mail e a senha da sua conta do app.
4. Em uma conversa nova, escreva por exemplo `45 almoço`.

Seu e-mail e sua senha ficam guardados só no seu computador e são usados apenas para entrar no
app em seu nome. Se você digitar a senha errada, o Claude avisa no primeiro pedido; corrija nos
ajustes da extensão.

### Como usar

Basta dizer o valor e a descrição. O resto segue um padrão, que você muda pedindo:

| | Padrão | Para mudar, diga por exemplo |
| --- | --- | --- |
| Data | hoje | "ontem", "dia 3" |
| Tipo | diário | "como entrada", "saída fixa", "no cartão", "economia" |
| Tags | nenhuma | "com a tag mercado" |
| Repetição | não repete | "todo mês", "em 6 parcelas" |

Você também pode pedir para listar os lançamentos de um período, corrigir ou apagar um
lançamento, ver o resumo do mês e criar tags ou cartões.

---

## For developers

An MCP server for the app, in two forms built from the same tools:

- **Desktop extension** (`src/stdio.ts`): the `.mcpb` above. Runs on the user's computer over
  stdio with their own login.
- **Hosted server** (`src/main.ts`): Streamable HTTP behind its own OAuth sign-in, for remote
  clients such as claude.ai. Single account: it acts on the one login in its env vars.

The app has no public API. `src/breno.ts` talks to its Supabase backend the way its web client
does.

### Tools

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

### Develop

```sh
pnpm install
pnpm check
pnpm test              # OAuth flow, every tool and the bundled extension, against a fake backend
pnpm smoke             # live: needs BRENO_EMAIL and BRENO_PASSWORD in .env
pnpm pack:extension    # writes escoladobreno.mcpb
pnpm dev               # hosted server; needs the full .env
```

`pnpm smoke` writes one R$ 0.01 entry named "TESTE MCP (apagar)" to the real account, then
updates and deletes it. Run it after the app ships an update to see whether the endpoints
still behave.

### The desktop extension

`extension/manifest.json` describes it; `scripts/build-extension.ts` bundles `src/stdio.ts` and
its dependencies into one CommonJS file (Claude Desktop runs it with its own Node, version
unspecified, so it targets Node 18) and packs it with `mcpb`. Keep the manifest's `version` equal
to `package.json`'s; the build refuses otherwise. To release, attach the `.mcpb` to a GitHub
release.

### The hosted server

- `POST /mcp`: the tools, bearer token required.
- OAuth 2.1 authorization server on the same origin: dynamic client registration, PKCE, refresh
  tokens. The consent step is a single admin password.
- No database. Client ids, codes and tokens are HMAC-signed values, so redeploys do not sign
  clients out. The cost: one token cannot be revoked on its own. Rotating `SIGNING_SECRET`
  revokes everything.

Configuration is in `.env.example`:

```sh
openssl rand -hex 32   # SIGNING_SECRET
pnpm hash-password     # ADMIN_PASSWORD_HASH, prompts for the password
```

Build the `Dockerfile`, set those variables, route a domain to port 3000. `PUBLIC_URL` must be
that domain's `https://` origin. In claude.ai, add a custom connector with the URL
`<PUBLIC_URL>/mcp`; in Claude Code, `claude mcp add --transport http escoladobreno <PUBLIC_URL>/mcp`.
