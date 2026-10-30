# AGENTS.md

Orchestra: local services manager for Windows (Tauri 2 + Rust, plain JS frontend, no bundler).

This file is the single source of instructions for every AI coding agent (Claude Code, Codex, Cursor, Copilot,
Gemini CLI, etc.). Tool-specific files such as `CLAUDE.md` only point here; edit this file, not them.

## Commands

```
npm install
npm run dev        # app in dev mode
npm run build      # tauri build: builds only the app (src-tauri/target/release/orchestra.exe)
npm run lint       # Biome (this is what CI runs)
npm run lint:fix   # fix and format
```

`npm run dev` and `npm run build` expect the Rust toolchain and MSVC (Visual Studio Build Tools) to be already
installed and available in the environment. Signing the installer for the updater only happens in CI
(`TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` secrets).
To check only the Rust code: `cargo check` inside `src-tauri/`.

## Layout

- `src/`: app UI (`index.html`, `app.js`, `i18n.js`, `style.css`). Global scripts, no modules;
  `I18N` and `LANGS` come from `i18n.js` and are used in `app.js`.
- `src-tauri/`: app backend (`src/main.rs`): service processes, logs, CPU/RAM, settings, updater.
- `installer/`: the custom installer, a separate Tauri app (`com.orchestra.setup`, own `Cargo.lock`, UI in
  `installer/src/`, texts in pt-BR, es-CO and en-US inside `installer.js`). It embeds the app binary
  (`installer/src-tauri/payload/orchestra.exe`, copied by the build) and installs per-user, without admin rights.
  The same exe has three modes: install (default), update (`--update` or the updater's `/UPDATE`) and
  uninstall (`--uninstall`, used by the `Uninstall.exe` copy it registers in Windows).
  Do not use Tauri's NSIS/MSI bundles: the app's `bundle.active` is `false` on purpose.
- npm scripts stay plain (`tauri dev`, `tauri build`, Biome). Do not add build/dev wrapper scripts or helper
  script files. Packaging the installer happens only in `build.yml`: copy `orchestra.exe` into the payload,
  `tauri build` inside `installer/`, rename to `Orchestra_<version>_x64-setup.exe` and sign it with
  `tauri signer sign`.
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
  updater exits the process without going through `RunEvent::Exit`. The plugin runs the downloaded custom installer
  with `/P /UPDATE /R`; `/UPDATE` puts it in update mode: it waits for the app to close, replaces `orchestra.exe`,
  updates the Windows registration and reopens the app.
- `latest.json` uses the `windows-x86_64` platform key (the plugin falls back to it when the app was not bundled).
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
2. `build.yml` (windows, on the tag): checks the version, builds the app (`npm run build`), builds the custom
   installer with the app embedded, signs it and builds `latest.json` (notes taken from the release commit body).
3. `publish.yml` (ubuntu): uploads the installer, `.sig` and `latest.json` to `releases/` on R2 (`latest.json` last,
   so users never see a partial release), verifies the public `latest.json` and only then creates the GitHub release
   with the installer attached. semantic-release itself only creates the tag.
4. `rollback` job in `deploy.yml`: if build or publish fails (or is cancelled) and the version is not live in
   `latest.json`, it deletes the tag and the GitHub release so the same version is released on the next push to
   `main` (or a re-run). It never reverts commits or touches R2.

Variables: `vars.R2_PUBLIC_URL` (`https://r2.orchestra.n4nlabs.com`), `vars.R2_BUCKET`. Secrets: `APP_ID`,
`APP_PRIVATE_KEY`, `CLOUDFLARE_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
