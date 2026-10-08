# AGENTS.md: maintainer guide for AI assistants (and humans)

Read this first. It explains how Dune Server Manager is built, where every responsibility lives, and
exactly what to edit when Funcom ships an update that breaks something. Keep it current: if you change
an architectural fact below, update this file in the same change.

---

## 1. What the app is

A Windows desktop app that manages **Dune: Awakening self-hosted "battlegroups"**.

Funcom's self-host stack (not ours):
```
Steam tool (AppID 4754530 Live / 3104830 PTC)
 └─ battlegroup.bat (Windows, interactive menu) ── creates ──► Hyper-V VM "dune-awakening" (Alpine Linux)
                                                                └─ k3s (Kubernetes)
                                                                   ├─ Funcom operators
                                                                   ├─ BattleGroup CR  (start/stop = spec.stop)
                                                                   ├─ ServerStats CRs (players per partition)
                                                                   ├─ PostgreSQL pod "*db-dbdepl-sts*" (world DB "dune")
                                                                   ├─ RabbitMQ, Director, Gateway, Text Router
                                                                   └─ one UE5 game-server pod per map partition
In-VM CLI: /home/dune/.dune/bin/battlegroup  (status|start|stop|restart|update|backup|import|apply-default-usersettings|...)
Config:    /home/dune/server/DuneSandbox/Saved/UserSettings/{UserEngine,UserGame,UserServerCustomSettings}.ini
```
The app controls all of this from Windows over **OpenSSH** (`ssh.exe`/`scp.exe`, user `dune`, key from battlegroup.bat),
**PowerShell Hyper-V cmdlets**, and **SteamCMD**. There is no RCON. Player admin goes through SQL on the world DB.

## 2. Tech stack

| Layer | Tech |
|---|---|
| Shell | Tauri 2 (Rust), single binary, WebView2 |
| Backend | Rust + tokio (`src-tauri/src/*.rs`) |
| Frontend | React 19 + TypeScript + Tailwind 4 + Motion + Zustand (`src/`) |
| Build | Vite 8, `tsc -b`, `tauri build` (NSIS + MSI), `scripts/package-portable.mjs` (zip) |

## 3. Commands

```bash
npm install                 # once
npm run dev                 # browser-only UI with the demo simulator (http://localhost:1420)
npm run tauri dev           # full desktop app, hot reload
npx tsc -b                  # type-check frontend (must be clean)
cd src-tauri && cargo check # type-check backend (must have no warnings)
cd src-tauri && cargo test --lib   # Rust unit tests (snapshot parser)
npm run build:all           # installers + portable zip  (PowerShell: use npm.cmd if scripts are blocked)
```
Outputs: `src-tauri/target/release/bundle/{nsis,msi}/`, `release/DuneServerManager-<ver>-Portable.zip`.
Version lives in **3 places**: `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` (keep in sync).
The UI reads it from `package.json` via the `__APP_VERSION__` define in `vite.config.ts`.

## 4. File map

### Backend: `src-tauri/src/`
| File | Responsibility |
|---|---|
| `lib.rs` | App bootstrap: plugins, main-window creation (portable WebView dir), tray menu, close interception (`app://close-requested`), **command registry** (`generate_handler!`; every new `#[tauri::command]` must be added here) |
| `store.rs` | `state.json` persistence; **data dir resolution** (installed `%APPDATA%\DuneServerManager` vs portable `.\data` when a `portable` file sits next to the exe); `rebase()` re-anchors moved paths |
| `proc.rs` | Hidden-window process spawning, `run()` with timeout, **streaming** (`proc://line` / `proc://exit` events, killable by id), PowerShell helper, elevated console launch |
| `ssh.rs` | `SshTarget`, `exec(script)` (script piped to `sh -s`), streaming, remote read/write (base64 heredoc + `.bak`), `ls`, `scp` pull, key discovery/import (ACL fix), known_hosts in data dir |
| `dune.rs` | **Battlegroup knowledge**: snapshot shell script → parse BattleGroup + ServerStats + pods + `kubectl top` + /proc stats; vendor-wrapper driver (`wrapper_script`); `bg_set_stop` patch; generic kubectl. Unit tests at bottom. |
| `hyperv.rs` | `Get-VM` inventory (JSON), VM actions, resources; flags the Dune VM by `dune-server.vhdx` |
| `steam.rs` | SteamCMD bootstrap/update (progress lines), Steam build polling (`api.steamcmd.net`), Steam-library install detection, misc fs helpers |
| `net.rs` | Public IP, UPnP (igd-next), TCP probes, DDNS (DuckDNS/Cloudflare/custom), webhook POST |
| `backup.rs` | Zip backups (UserSettings + BattleGroup YAML + optional DB dump via `battlegroup backup` + scp), retention, pin, read settings back |
| `automation.rs` | **Background engine** (runs while in tray): every 30 s per real instance → watchdog, crash alerts (pod restart deltas), scheduled restarts + countdown warnings, interval backups, update polling/auto-update, DDNS, player-count events → webhooks + Windows notifications. Reads instances straight from `state.json`. |
| `system.rs` | Host stats (sysinfo), prerequisite checks (edition, Hyper-V, AVX2, elevation), relaunch elevated |

### Frontend: `src/`
| Path | Responsibility |
|---|---|
| `lib/types.ts` | **All shared types** (Instance, Settings, Snapshot, …). Rust structs serialize camelCase to match. |
| `lib/store.ts` | Zustand store (instances, folders, settings, tabs, telemetry, toasts…), first-run seeding, debounced persistence (`flushSave()` before quitting) |
| `lib/api.ts` | **Every backend call**. Routes demo instances (or plain browser) to `lib/demo.ts`. SQL runner (`sqlQuery`, `parsePsql`). Constants: AppIDs, default settings dir. |
| `lib/demo.ts` | Full in-memory battlegroup simulator (same shapes as Rust); keeps the UI explorable without Hyper-V |
| `lib/players.ts` | Roster / kick / Solari / XP via SQL on the `dune` schema |
| `lib/settingsSchema.ts` | **Game-settings catalogue** (file, section, key, type, range, verified flag, category) + presets |
| `lib/ini.ts` | Lossless INI model (keeps comments, `;disabled` template lines, `+Array` keys), diff |
| `lib/telemetry.tsx` | Headless poller (host 2 s, instances N s, Hyper-V 10 s) + automation event listeners |
| `lib/health.ts` | Health state + 0-100 score from a snapshot |
| `lib/actions.ts` | Start/stop/restart/update/maintenance (confirm → API → toast/log/webhook) |
| `lib/jobs.ts` | Operations drawer: tracked streamed jobs, batched line updates, `useBusy()` |
| `lib/close.ts` | Close behaviour (ask / tray / quit), tray hint notification |
| `lib/tauri.ts` | `invoke` wrapper, stream event bus (`onStream`) |
| `components/` | `ui.tsx` (design-system primitives), `charts.tsx` (SVG charts), TitleBar, Sidebar (folders, DnD), TabStrip, Overlays (toasts, activity, jobs, command palette), menu, CloseDialog |
| `views/` | HomeView, SettingsView, SystemView, Wizard, `instance/*Tab.tsx` (Overview, Maps, Players(+RosterCard), Console, Logs, Config, Backups, Automation, Network, Integrations, InstanceSettings, InviteCard) |
| `index.css` | Theme tokens (accents via `data-accent`), glass, animations |

### Docs
`README.md` (landing page), `docs/USER_GUIDE.md` (every screen), `docs/ARCHITECTURE.md` (design and feasibility, with sources), `CHANGELOG.md`, `CREDITS.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/RELEASE_NOTES.md` (body of GitHub releases), this file (maintenance).

### Releasing
Bump the version in the 3 manifests, add a `CHANGELOG.md` entry, commit, then push a tag `vX.Y.Z`. `.github/workflows/release.yml` builds the installer, MSI and portable zip with SHA-256 checksums and opens a **draft** GitHub Release to review and publish. `ci.yml` type-checks and tests every push and PR.

## 5. Data flow (one poll)

`telemetry.tsx` → `api.snapshot(inst)` → Rust `bg_snapshot` → `dune::snapshot` (2.5 s cache shared with the engine) →
one SSH session runs `SNAPSHOT_SCRIPT` (sections `@@BG @@PODS @@TOP @@MEM @@STAT …`) → `parse_snapshot` →
`Snapshot` JSON → `store.setTelemetry` (+ history sample) → components read `telemetry[id]`.

Long operations: UI → `runJob(title, id, sid => api.wrapperStream(...))` → Rust streams lines as `proc://line` →
`jobs.ts` batches → Operations drawer.

## 6. "Funcom changed X". Where to fix it

| Symptom after a game/server patch | Edit |
|---|---|
| New Steam AppID / branch | `APP_LIVE/APP_PTC` in `src/lib/api.ts` **and** `src-tauri/src/steam.rs` |
| `battlegroup` CLI moved or renamed | `WRAPPER` in `dune.rs`; quick-command chips in `views/instance/ConsoleTab.tsx`; `ssh_test` in `ssh.rs` |
| CLI prompts changed (hangs or answers wrong) | `wrapper_script()` in `dune.rs` (pipes `<index>\nN\nN\n` to stdin) |
| Start/stop stopped working | `patch_stop_script()` in `dune.rs` (BattleGroup `spec.stop`) |
| Dashboard shows no maps/players | `parse_bgs()` in `dune.rs` (`status.servers[].partitionMap/partitionIndex/ready`, ServerStats `spec.area.partition` / `status.runtime.players`). Add a test with a real JSON sample. |
| New map names | `friendly_map()` in `dune.rs`, `MAP_ART` in `MapsTab.tsx`, `MAP_NAMES` in `RosterCard.tsx`, demo `MAPS` |
| UserSettings path moved | `DEFAULT_SETTINGS_DIR` in `api.ts` and the fallback in `automation.rs` |
| New or renamed INI settings | `lib/settingsSchema.ts`: add a `FieldDef` (set `verified: true` only when Funcom documents it). Unknown keys already appear under *Advanced* automatically. |
| Ports changed | `RULES` in `NetworkTab.tsx`, port hints in `MapsTab.tsx`, `docs/ARCHITECTURE.md` |
| DB pod or credentials changed | `sqlQuery()` in `api.ts` (pod grep `db-dbdepl-sts`, users/ports loop) |
| DB schema changed (roster/kick/Solari/XP broken) | `lib/players.ts` (all SQL in one place) and the snippets in `PlayersTab.tsx` |
| Build-ID detection broken | `@@BUILD` line in `SNAPSHOT_SCRIPT` (`appmanifest_*.acf` inside the VM) and `steam_remote_build` |
| Hyper-V VM renamed | default `vmName` in `newInstance()` (`store.ts`); detection in `hyperv.rs::annotate` |
| Official RCON/admin API appears | add a Rust module + commands, register in `lib.rs`, call from `api.ts`, surface in `PlayersTab`/`RosterCard` |

## 7. Recipes

**Add a backend command**: write `#[tauri::command] pub async fn foo(...) -> Result<T, String>` in the right module →
add `module::foo` to `generate_handler!` in `lib.rs` → add a typed wrapper in `src/lib/api.ts` (with a demo branch if it
touches an instance) → call it from the UI. Args are camelCase in JS, snake_case in Rust.

**Add a game setting**: append to `FIELDS` / `community()` in `settingsSchema.ts`:
`{ file, section, key, label, description, category, type, default, min, max, step, verified }`.
Types: `bool` (True/False), `bool01` (1/0), `boolLower` (true/false), `number`, `int`, `string`, `secret`, `enum`, `partitions`, `list` (`+Key=` arrays).

**Add an instance tab**: create `views/instance/FooTab.tsx` (`({ inst }: { inst: Instance })`), add the id to the
`InstanceTab` union (`types.ts`) and to `TABS` + the render switch in `InstanceView.tsx`, optionally to the command palette list in `Overlays.tsx`.

**Add an automation rule**: extend the `Automation` type (TS) **and** the serde struct in `automation.rs` (fields are
`#[serde(default)]`), implement it in `tick()`, add UI in `AutomationTab.tsx`, default in `defaultAutomation()`.

**Add a webhook event kind**: `WebhookEvent` in `types.ts`, `EVENTS` in `IntegrationsTab.tsx`, `color()` in `automation.rs`, then call `ctx.notify(..., "<kind>", ...)`.

## 8. Conventions and gotchas

- **Never block the UI thread in Rust**: commands that touch disk heavily use `spawn_blocking`; processes use `proc::command()` (no console flash).
- Remote scripts are POSIX `sh` (Alpine/busybox). No bash-isms. Quote with `ssh::sq()` / `api.sq()`. Large payloads go base64 through a heredoc.
- `kubectl` is resolved at runtime via `KUBECTL_PRELUDE` (`sudo -n kubectl` → `kubectl`). Always prefix scripts with it and call `$K`.
- Zustand selectors must return **stable** values (no `.filter()/.map()` inside the selector; derive with `useMemo`).
- Page transitions are CSS (`.page-enter`), not `AnimatePresence`: animation frames pause when the window is hidden.
- Every config write keeps a server-side `.dsm-<timestamp>.bak`. Every destructive action goes through `confirm()`.
- Community-sourced facts are labelled in the UI (`verified: false`, badges). Don't promote them to verified without a Funcom source.
- Demo parity: when you add an API that takes an `Instance`, add a demo branch so the browser preview keeps working.
- Don't rename `identifier` in `tauri.conf.json`: it keys the data dir, autostart entry and single-instance lock.

## 9. Verification checklist before shipping

1. `npx tsc -b` clean, `cargo check` with no warnings, `cargo test --lib` green.
2. `npm run dev` → click every instance tab on the demo server; no console errors.
3. `npm run build:all` succeeds; launch the portable exe once (it should create `.\data`, not `%APPDATA%`).
4. Bump the version in all three manifests and note changes in `docs/ARCHITECTURE.md` (roadmap table) if user-visible.
