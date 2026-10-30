# AGENTS.md

Orchestra: local services manager for Windows (Tauri 2 + Rust, plain JS frontend, no bundler).

This file is the single source of instructions for every AI coding agent (Claude Code, Codex, Cursor, Copilot,
Gemini CLI, etc.). Tool-specific files such as `CLAUDE.md` only point here; edit this file, not them.

## Commands

```
npm install
npm run dev        # app in dev mode
npm run build      # tauri build: produces the NSIS installer in src-tauri/target/release/bundle/nsis/
npm run lint       # Biome (this is what CI runs)
npm run lint:fix   # fix and format
```

`npm run dev` and `npm run build` expect the Rust toolchain and MSVC (Visual Studio Build Tools) to be already
installed and available in the environment. To sign the
updater artifacts, the `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` variables.
To check only the Rust code: `cargo check` inside `src-tauri/`.

## Layout

- `src/`: app UI (`index.html`, `app.js`, `i18n.js`, `style.css`). Global scripts, no modules;
  `I18N` and `LANGS` come from `i18n.js` and are used in `app.js`.
- `src-tauri/`: app backend (`src/main.rs`): service processes, logs, CPU/RAM, settings, updater.
- Installer: Tauri's default NSIS (`bundle.windows.nsis` in `tauri.conf.json`), per-user, no admin rights,
  in pt-BR, Spanish and English.
- `installer/`: an old custom installer (separate Tauri app, `com.orchestra.setup`). It is not used by any
  npm script or workflow; do not wire it back in without being asked.
- `.github/workflows/`: `ci.yml` (lint + cargo check on PRs to `main`, skipped for Markdown-only changes, also runnable manually) and the release pipeline
  (`deploy.yml` → `release.yml` → `build.yml` → `publish.yml`).

## Conventions

- **Do not write comments in code** (JS, CSS, HTML, Rust, YAML, scripts). The code stays comment-free.
- Formatting and linting by Biome (`biome.json`): tabs, `lineWidth` 120, braces required on every `if`/`for`.
  `src-tauri/` is outside Biome.
- Developer-facing text (docs, workflow step names, CI messages, commit messages) is written in English.
- App languages: pt-BR (default), es-CO and en-US. Every new user-facing string must exist in all three:
  - UI: `src/i18n.js` (the three sections must have exactly the same keys);
  - backend errors: the `tr!("pt", "es", "en", args...)` macro in `src-tauri/src/main.rs`.
- The version lives only in `package.json` (`tauri.conf.json` points to it). Never change the version by hand:
  semantic-release handles it. `Cargo.toml` stays at 1.0.0.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`...): they determine the next version.

## Updater

- `tauri-plugin-updater` plugin, used only from Rust (`check_update` / `install_update`), not via the JS API.
- Fixed endpoint in `tauri.conf.json`: `https://r2.orchestra.n4nlabs.com/releases/latest.json`.
- `install_update` downloads, saves the session and stops the services before `update.install()`, because the
  installer kills the process without going through `RunEvent::Exit`. NSIS runs in `passive` mode and reopens the app.
- The public key is in `tauri.conf.json`. The private key never goes into the repository
  (`TAURI_SIGNING_PRIVATE_KEY` secret in the pipeline).
- Users can turn off automatic update checks (`autoUpdate` in `settings.json`).

## App data

- `%APPDATA%\com.orchestra.app\`: `settings.json` (machine-local), `services.json` (service list when there is no
  shared file), `session.json`.
- Company: N4nLabs (`publisher`/`copyright` in `tauri.conf.json`).
- The old version was called "Orquestra" (`com.orquestra.app`); the app copies settings from that folder on first
  launch. Keep this compatibility.

## Release

Push to `main` → `deploy.yml`:
1. `release.yml` (ubuntu): lint and semantic-release (`.releaserc`: version in `package.json`, no npm publish,
   `chore(release)` commit + tag). Pushes with the org GitHub App token (`APP_ID` / `APP_PRIVATE_KEY`).
2. `build.yml` (windows, on the tag): checks the version, runs `npm run build` with the signing key and builds
   `latest.json` (notes taken from the release commit body).
3. `publish.yml` (ubuntu): uploads the installer, `.sig` and `latest.json` to `releases/` on R2 and verifies the
   public `latest.json`.

Variables: `vars.R2_PUBLIC_URL` (`https://r2.orchestra.n4nlabs.com`), `vars.R2_BUCKET`. Secrets: `APP_ID`,
`APP_PRIVATE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
