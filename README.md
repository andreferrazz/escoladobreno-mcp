# escoladobreno-mcp

Conecta o Claude ao app de finanças [app.escoladobreno.com](https://app.escoladobreno.com): você
diz "45 almoço" e o lançamento aparece no app, sem abrir o app.

> **Projeto não oficial.** Não tem vínculo com a Escola do Breno. Usa a mesma API interna do
> aplicativo web, que não é pública e pode mudar sem aviso; se isso acontecer, a extensão para de
> funcionar até ser atualizada. Use por sua conta e risco.

Há duas formas de usar, e você pode escolher só uma:

| | Extensão para o Claude Desktop | Conector na nuvem |
| --- | --- | --- |
| Funciona em | aplicativo Claude no computador | computador, navegador (claude.ai) e celular |
| Instalação | um arquivo, 2 minutos | uns 10 minutos, com contas na Vercel e no GitHub |
| Onde fica sua senha do app | no seu computador | no seu projeto na Vercel |

## Instalar no Claude Desktop

Funciona no aplicativo Claude para computador (**macOS, Windows e Linux**). Não funciona no
claude.ai pelo navegador nem no celular.

1. Baixe o arquivo `escoladobreno.mcpb` na página de
   [releases](https://github.com/andreferrazz/escoladobreno-mcp/releases/latest).
2. No Claude, abra **Ajustes → Extensões** (em inglês, **Settings → Extensions**) e arraste o
   arquivo para lá. No macOS e no Windows, um duplo clique no arquivo também abre a instalação;
   no Linux, não.
3. O Claude avisa que a extensão não é verificada: ela não tem assinatura digital. Confirme,
   clique em **Instalar** e preencha o e-mail e a senha da sua conta do app.
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

## Conector na nuvem (para usar também no celular)

Você cria a sua própria cópia do conector, gratuita, na [Vercel](https://vercel.com). Ela é só
sua: ninguém mais tem acesso, e sua senha do app fica guardada na sua conta da Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fandreferrazz%2Fescoladobreno-mcp&env=BRENO_EMAIL,BRENO_PASSWORD,CONNECTOR_PASSWORD&envDescription=E-mail%20e%20senha%20do%20app%20Escola%20do%20Breno%2C%20e%20uma%20senha%20nova%20(12%2B%20caracteres)%20para%20proteger%20o%20conector.&envLink=https%3A%2F%2Fgithub.com%2Fandreferrazz%2Fescoladobreno-mcp%23os-tr%C3%AAs-campos&project-name=escoladobreno-mcp&repository-name=escoladobreno-mcp)

1. Clique no botão acima. Entre na Vercel (ou crie uma conta gratuita) usando o GitHub; se você
   não tem conta no GitHub, a Vercel oferece criar uma no mesmo passo.
2. A Vercel copia este projeto para o seu GitHub. Aceite o nome sugerido.
3. Preencha os três campos (veja abaixo) e clique em **Deploy**. Leva cerca de um minuto.
4. Ao terminar, abra o endereço do projeto (algo como `https://escoladobreno-mcp-xxxx.vercel.app`).
   A página mostra o endereço do conector, terminado em `/mcp`. Copie esse endereço.
5. No Claude, vá em **Personalizar → Conectores → Adicionar → Adicionar conector personalizado**
   (em inglês, **Customize → Connectors → Add → Add custom connector**) e cole o endereço.
6. O Claude abre uma página pedindo uma senha: é a **senha do conector** que você criou no
   passo 3. Depois disso, escreva `45 almoço` em uma conversa nova.

No plano gratuito do Claude é possível ter um conector personalizado.

### Os três campos

| Campo | O que colocar |
| --- | --- |
| `BRENO_EMAIL` | O e-mail da sua conta em app.escoladobreno.com |
| `BRENO_PASSWORD` | A senha da sua conta do app |
| `CONNECTOR_PASSWORD` | Uma senha **nova**, inventada agora, com pelo menos 12 caracteres. Ela protege o seu conector: quem souber essa senha consegue ver e alterar seus lançamentos. Não reutilize a senha do app. |

### Se algo der errado

- **A página mostra "O conector não está configurado".** Ela diz qual campo está errado. Corrija
  em **Settings → Environment Variables** no projeto da Vercel e depois, em **Deployments**,
  escolha **Redeploy**.
- **O Claude diz que o app recusou o e-mail ou a senha.** `BRENO_EMAIL` ou `BRENO_PASSWORD`
  está errado; corrija do mesmo jeito.
- **Você trocou a senha do app.** Atualize `BRENO_PASSWORD` na Vercel e faça **Redeploy**. O
  Claude vai pedir a senha do conector de novo.

### Atualizar ou apagar

A sua cópia fica na versão em que foi criada. Se o app mudar e o conector parar de funcionar,
veja se há versão nova aqui. Para atualizar, apague a sua cópia (abaixo) e clique no botão de
novo, usando os mesmos três campos; depois remova e adicione o conector no Claude.

Para apagar tudo: na Vercel, **Settings → Delete Project**; no GitHub, apague a cópia do
repositório; no Claude, remova o conector.

---

## For developers

An MCP server for the app, in two forms built from the same tools:

- **Desktop extension** (`src/stdio.ts`): the `.mcpb` above. Runs on the user's computer over
  stdio with their own login.
- **Hosted server** (`src/main.ts`, or `src/server.ts` on Vercel): Streamable HTTP behind its own
  OAuth sign-in, for remote clients such as claude.ai. Single account: it acts on the one login
  in its env vars.

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

There are two ways to configure the sign-in (`src/config.ts`):

- **Administered server**, as in `.env.example`: `PUBLIC_URL`, `SIGNING_SECRET` and
  `ADMIN_PASSWORD_HASH`.

  ```sh
  openssl rand -hex 32   # SIGNING_SECRET
  pnpm hash-password     # ADMIN_PASSWORD_HASH, prompts for the password
  ```

  Build the `Dockerfile`, set the variables, route a domain to port 3000. `PUBLIC_URL` must be
  that domain's `https://` origin.

- **One-click deployment**: only `CONNECTOR_PASSWORD` (12+ characters). The signing secret is
  then derived from it and the app password, so every serverless instance agrees on it and
  changing either password signs clients out; the public URL comes from
  `VERCEL_PROJECT_PRODUCTION_URL`. Vercel runs `src/server.ts` as a single function with no
  build step or `vercel.json`.

  On Vercel the sign-in lockout and the single-use check on authorization codes are kept in
  memory per instance, so they are best-effort there. The password length minimum and the
  scrypt hash are what stand against guessing.

In claude.ai, add a custom connector with the URL `<PUBLIC_URL>/mcp`; in Claude Code,
`claude mcp add --transport http escoladobreno <PUBLIC_URL>/mcp`.
