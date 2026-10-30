# CLAUDE.md

Orchestra: gerenciador de serviços locais para Windows (Tauri 2 + Rust, frontend em JS puro, sem bundler).

## Comandos

```
npm install
npm run dev        # app em modo dev (chama o setup do MSVC portátil em C:\quipux\tools)
npm run build      # tauri build: gera o instalador NSIS em src-tauri/target/release/bundle/nsis/
npm run lint       # Biome (é o que a CI roda)
npm run lint:fix   # corrige e formata
```

`npm run build` precisa do MSVC no ambiente (Visual Studio Build Tools ou o setup portátil) e, para gerar a
assinatura do atualizador, das variáveis `TAURI_SIGNING_PRIVATE_KEY` e `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Para só checar o Rust: `cargo check` dentro de `src-tauri/`.

## Estrutura

- `src/`: interface do app (`index.html`, `app.js`, `i18n.js`, `style.css`). Scripts globais, sem módulos;
  `I18N` e `LANGS` vêm de `i18n.js` e são usados em `app.js`.
- `src-tauri/`: backend do app (`src/main.rs`): processos dos serviços, logs, CPU/RAM, configurações, atualizador.
- Instalador: o NSIS padrão do Tauri (`bundle.windows.nsis` no `tauri.conf.json`), por usuário, sem administrador,
  em pt-BR, espanhol e inglês. Não existe instalador próprio.
- `.github/workflows/`: `ci.yml` (lint + cargo check em PRs e outras branches) e o fluxo de release
  (`deploy.yml` → `release.yml` → `build.yml` → `publish.yml`).

## Convenções

- **Não escrever comentários no código** (JS, CSS, HTML, Rust, YAML, scripts). O código fica sem comentários.
- Formatação e lint pelo Biome (`biome.json`): tabs, `lineWidth` 120, chaves obrigatórias em todo `if`/`for`.
  `src-tauri/` fica fora do Biome.
- Idiomas: pt-BR (padrão), es-CO e en-US. Todo texto novo precisa existir nos três:
  - interface: `src/i18n.js` (as três seções devem ter exatamente as mesmas chaves);
  - erros do backend: macro `tr!("pt", "es", "en", args...)` em `src-tauri/src/main.rs`.
- A versão vem só do `package.json` (o `tauri.conf.json` aponta para ele). Não alterar a versão manualmente:
  o semantic-release cuida disso. O `Cargo.toml` fica em 1.0.0.
- Commits no padrão Conventional Commits (`feat:`, `fix:`, `chore:`...): definem a próxima versão.

## Atualizador

- Plugin `tauri-plugin-updater`, usado só pelo Rust (`check_update` / `install_update`), não pela API JS.
- Endpoint fixo no `tauri.conf.json`: `https://r2.orchestra.n4nlabs.com/releases/latest.json`.
- `install_update` baixa, salva a sessão e para os serviços antes de `update.install()`, porque o instalador
  encerra o processo sem passar pelo `RunEvent::Exit`. O NSIS roda em modo `passive` e reabre o app.
- A chave pública está no `tauri.conf.json`. A privada nunca vai para o repositório
  (secret `TAURI_SIGNING_PRIVATE_KEY` na esteira).
- O usuário pode desligar a verificação automática (`autoUpdate` em `settings.json`).

## Dados do app

- `%APPDATA%\com.orchestra.app\`: `settings.json` (local da máquina), `services.json` (lista de serviços quando não
  há arquivo compartilhado), `session.json`.
- Empresa: N4nLabs (`publisher`/`copyright` no `tauri.conf.json`).
- A versão antiga se chamava "Orquestra" (`com.orquestra.app`); o app copia as configurações dessa pasta na primeira
  abertura. Manter essa compatibilidade.

## Release

Push na `main` → `deploy.yml`:
1. `release.yml` (ubuntu): lint e semantic-release (`.releaserc`: versão no `package.json`, sem publicar no npm,
   commit `chore(release)` + tag). Push com o token do GitHub App da org (`APP_ID` / `APP_PRIVATE_KEY`).
2. `build.yml` (windows, na tag): confere a versão, `npm run build` com a chave de assinatura e monta `latest.json`
   (notas tiradas do corpo do commit de release).
3. `publish.yml` (ubuntu): envia instalador, `.sig` e `latest.json` para `releases/` no R2 e confere o
   `latest.json` público.

Variáveis: `vars.R2_PUBLIC_URL` (`https://r2.orchestra.n4nlabs.com`), `vars.R2_BUCKET`. Secrets: `APP_ID`,
`APP_PRIVATE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
