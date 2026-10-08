# Dune Server Manager: Feasibility, Architecture & Blueprint

> Status: **implemented** (v1.0). This document describes how the app works and why it was built this way.
> Facts about Funcom's tooling come from the official *Self Hosted Servers* page, the community wiki, and
> open-source community projects (see Sources). Funcom doesn't document the internals, so anything
> unverified is marked as such in the UI.

---

## 1. Feasibility & netcode analysis

### 1.1 What "dedicated server" means for Dune: Awakening

Dune: Awakening isn't a single `Server.exe` you launch. Funcom's self-host package is a whole **battlegroup**:

| Layer | What it is |
|---|---|
| Steam tool | *Dune: Awakening Self-Hosted Server*. Live AppID **4754530**, PTC AppID **3104830**. The Windows depot holds `battlegroup.bat` and a Hyper-V image `dune-server.vhdx`. |
| VM | Alpine Linux under **Hyper-V** (Windows Pro required), created by `battlegroup.bat → initial-setup`. User `dune`, an SSH key is generated at setup. |
| Orchestrator | Single-node **k3s** (Kubernetes) plus four Funcom operators (battlegroup, database, server, utilities). |
| Services | PostgreSQL (world DB), two RabbitMQ brokers (game TLS on **31982**, admin internal), Battlegroup Director (web UI, no auth), Gateway, Text Router, file broker. |
| Game servers | One UE5 pod per **map partition** (Overmap, Hagga Basin `Survival_1` ×N, Deep Desert, Arrakeen, Harko Village), started on demand. UDP **7777+n**, inter-server gateway (IGW) = game port + 111. |
| CLI | `~/.dune/bin/battlegroup` inside the VM: `status/start/stop/restart/update/backup/import/apply-default-usersettings/logs-export`. |
| State | The `BattleGroup` custom resource (`spec.stop`, `status.servers[]`, phases) and per-partition `ServerStats` CRs (`status.runtime.players`). |

### 1.2 SteamCMD

| Concern | Verdict |
|---|---|
| Automated fetch | ✅ `steamcmd +@sSteamCmdForcePlatformType windows +force_install_dir <dir> +login anonymous +app_update 4754530 validate +quit`. The manager bootstraps SteamCMD itself (downloads `steamcmd.zip`) and streams progress (`Update state (0x61) downloading, progress: NN.NN`). |
| Anonymous vs authenticated | Anonymous works for the tool depot for most users. Reports disagree, so the wizard supports a Steam username and opens a visible console for the Steam Guard login, after which credentials are cached by SteamCMD. The app never stores Steam passwords. |
| Background updates | The **game payload** (~5 GB) is updated *inside the VM* by `battlegroup update` (anonymous SteamCMD in Linux). The manager polls `api.steamcmd.net` for the public build ID and compares it with `appmanifest_*.acf` inside the VM. Client and server builds must match exactly, so auto-update matters. |
| Config files | `UserEngine.ini`, `UserGame.ini`, `UserServerCustomSettings.ini` live in `/home/dune/server/DuneSandbox/Saved/UserSettings` and apply to *all* game servers. Per-map settings (server counts, resources, args) live in the `BattleGroup` spec. |
| Process lifecycle | Not a Windows process at all. Start/stop flips `spec.stop` on the CR (exactly what the vendor CLI does). Restart, update, backup and import drive the vendor CLI non-interactively over SSH. Crashes are visible as pod `restartCount` increments; Kubernetes self-heals individual pods. |

### 1.3 Crossplay reality

| Platform pair | Crossplay | Self-hosted access |
|---|---|---|
| Steam PC ↔ Steam PC | ✅ | ✅ (Experimental tab in the server browser) |
| Xbox Series ↔ Microsoft Store / Game Pass PC | ✅ (Xbox ecosystem crossplay + Play Anywhere) | ❌ not announced |
| PS5 ↔ anything | ❌ | ❌ |
| Steam PC ↔ consoles | ❌ | n/a |

**Can a self-hosted server bridge crossplay?** No. Platform matchmaking, entitlement and authentication run through Funcom's backend (the self-host token from `account.duneawakening.com` registers your world with Funcom's directory). A self-hosted battlegroup can only accept the client population that backend lists it for, which today is PC. No server-side setting or proxy changes which platforms can see or authenticate to a world. Crossplay is decided by Funcom's backend and first-party platform agreements, not by your host.

### 1.4 "No tether": dedicated vs listen/P2P

Tethering in survival games (e.g. Conan Exiles co-op, Valheim, ARK non-dedicated) happens when one player's client *is* the server: other players must stay within a radius because only the host's surroundings are simulated, and the session dies when the host logs off.

A battlegroup removes tethering by design:

1. **Authoritative simulation runs in pods, not clients.** Every map partition is a full UE5 dedicated server that simulates its whole map regardless of where players are.
2. **No host player.** Admins can be offline; the world keeps ticking (spice blooms, Coriolis cycle, decay).
3. **Travel between maps is server-to-server** through the IGW gateway and the Director's travel queue, so friends can be on different maps at the same time.
4. **Rendering and relevancy grids** (UE net relevancy, world partition streaming) are per-client. Distance between players affects only what each client receives, never whether they may move.

**Local machine vs VPS:**

| Factor | Local host (home PC) | Cloud |
|---|---|---|
| Hyper-V requirement | ✅ native | ❌ Most VPSes can't nest Hyper-V. Needs bare metal, or a community KVM/Proxmox port of the VHDX. |
| Player latency | Your upload and route quality; fine for a regional group | Datacenter routes, usually lower jitter |
| Tethering / view distance | Unaffected (server-authoritative in both cases) | Unaffected |
| RAM | 20 GB minimum, 64 GB recommended; one Hagga Basin partition is ~10 GB with players | Large-RAM bare metal is costly |
| DDoS | Home IP exposed unless relayed | Provider filtering |

---

## 2. UI / UX design

### 2.1 Visual language
* **Arrakis night palette:** warm near-black (`#0d0b09`) with a radial spice glow; accent tokens are switchable (Spice, Ibad blue, Sietch, Harkonnen, Bene Gesserit).
* **Glass surfaces:** `backdrop-filter: blur(18px) saturate(140%)` panels with hairline borders. In the native window the background is **Mica** with a translucent wash.
* **Type:** Space Grotesk for display, Inter for UI, JetBrains Mono for data.
* **Status pills** pair colour with an icon or pulse and a text label (never colour alone). Health is computed from operator phases, ready partitions, crash-looping pods and memory pressure, and shown as a 0–100 ring.
* **Charts:** hand-rolled SVG with a recessive grid, 2px lines, crosshair + tooltip, a single y-axis, and a CVD-validated two-series pair (RX `#3987e5` / TX `#d95926`).
* **Motion:** spring physics via Motion for micro-interactions. Page transitions are CSS-only so they can never wedge when the window is hidden to the tray. "Reduce motion" is honoured.

### 2.2 Navigation
```
┌ TitleBar: logo · Ctrl+K palette · Run-as-admin · Operations · Activity · window controls ┐
├ Sidebar ───────────┬ Tab strip: [Fleet] [Server A ●] [Server B ●] [+]  (drag to reorder) ┤
│ Fleet overview     │ ┌ Instance header: health ring · status · Start/Stop/Restart/Update ┐ │
│ Host & prereqs     │ │ Overview · Maps & Pods · Players · Console · Logs · Game Settings │ │
│ ▾ PRODUCTION       │ │ Backups · Automation · Network · Discord · Instance               │ │
│   ● EU-1     12👤  │ └──────────────────────────────────────────────────────────────────┘ │
│ ▾ HARDCORE PVP     │                                                                      │
│ host CPU/RAM bars  │                                                                      │
└ Settings ──────────┴──────────────────────────────────────────────────────────────────────┘
```
* Each instance opens as an independent tab (middle-click to close, Ctrl+Tab and Ctrl+1–9 to switch). Background tabs keep polling at a reduced rate.
* **Folders** (Production / Testing / Hardcore PvP / any cluster group) support drag-and-drop, colour, icon, collapse, rename, bulk start/stop and an aggregate player count. **Tags** are searchable (`#pvp`). Pinned favourites float to the top.

### 2.3 Create Server Wizard
`Source → Identity → Prerequisites → Server files → Hyper-V setup → Connect → Launch`
* **Sources:** fresh SteamCMD install · adopt a Steam-library install (auto-detected through `libraryfolders.vdf`) · connect to an existing or remote VM · demo sandbox.
* **Prerequisites:** Windows edition, Hyper-V service, firmware virtualization, AVX2, RAM, free SSD, elevation or Hyper-V Administrators membership, OpenSSH.
* **Hyper-V setup:** opens the token page and launches `battlegroup.bat` elevated for Funcom's own `initial-setup` (the supported path).
* **Connect:** Hyper-V VM discovery (scored by the `dune-server.vhdx` disk), IP auto-fill, SSH key discovery and import (ACL fix), connection test.

---

## 3. Feature matrix

| Area | Feature | Implementation |
|---|---|---|
| **Lifecycle** | Start / stop | `kubectl patch battlegroup … spec.stop`; VM auto-boot first if it's Off |
| | Restart / update / backup / import | Vendor CLI driven over SSH with automatic menu answers; streamed live into **Operations** |
| | One-click SteamCMD | Bootstrap, update and validate with a progress bar; interactive Steam Guard login |
| | Hyper-V | Start, shutdown, save state, turn off, checkpoint, CPU/RAM sizing; live CPU %, assigned memory and demand |
| | Maintenance mode | Pauses watchdog and schedules per server or fleet-wide |
| **Automation** (Rust engine, runs while in tray) | Watchdog | Restarts a battlegroup that stopped unexpectedly; full restart after 5 min with zero ready partitions; boots the VM after 3 failed SSH checks |
| | Crash alerts | Pod `restartCount` deltas with reason (OOMKilled, CrashLoopBackOff) |
| | Scheduled restarts | Per-weekday times, multi-step countdown warnings |
| | Backups | Interval, retention, pinning; zip of UserSettings, the BattleGroup YAML and an optional pg dump (downloaded via SCP) with a manifest |
| | Update polling | Steam build vs VM build, notify, optional auto-update with a pre-update backup |
| | DDNS | DuckDNS / Cloudflare / custom URL, refreshed on IP change |
| **Configuration** | Visual editor | Curated, labelled fields (verified vs community-sourced, client-must-match flags), auto-discovered controls for *every* other key, presets, search |
| | Safety | Lossless INI model (comments and template lines preserved), unified diff review, server-side `.bak` before every write, “Push to file broker” and “Restart to apply” |
| | Battlegroup spec | YAML editor with server-side dry-run and replace |
| **Telemetry** | Live graphs | VM CPU / RAM / disk / bandwidth, players over time, per-map distribution, host CPU per core, RAM, network |
| | Pods | CPU and memory (metrics-server), restarts, age, describe, restart, jump to logs |
| | Logs | Live `kubectl logs -f`, regex filter, severity colouring, pause buffer, export |
| | Console | VM shell, kubectl and battlegroup CLI modes with history and quick commands |
| **Players** | Live counts | ServerStats CRs per partition, session peak, busiest map |
| | Roster & admin | Every character with online state, map, last seen, buildings and Solari, read from the world DB (`dune` schema); kick (session flagged `LoggingOut`), give Solari, award XP per specialization track |
| | Access control | Join password (`Bgd.ServerLoginPassword`); Funcom ships no RCON or ban list; experimental in-game admin login and GM allow-list settings |
| | DB explorer | psql in the Postgres pod, read-only transaction by default, guarded write mode, saved queries |
| | Invite | Copy-ready invite (name, password, steps) and a one-click Discord post |
| **Networking** | Port plan | UDP 7777–7810 and TCP 31982 → VM, never the host; cheat-sheet copy |
| | UPnP | IGD discovery, mapping audit (to VM vs elsewhere), one-click add/remove |
| | Diagnostics | Public IP, CGNAT / double-NAT detection, TCP probes (LAN, WAN, SSH) |
| | Anti-DDoS | Exposure minimisation and guidance on WireGuard/GRE VPS relays (TCP-only proxies can't carry UDP game traffic) |
| **Discord** | Webhooks | Per-server and global; per-event routing (state, crash, restart, warning, update, backup, players); role mention on crashes; test; announcements |
| **App** | UX | Command palette, keyboard shortcuts, activity feed, toasts, tray, single instance, export/import config, accent themes |

---

## 4. Tech stack

**Chosen: Tauri 2 (Rust) + React 19 + TypeScript + Tailwind 4 + Motion + Zustand.**

| Criterion | Tauri 2 + Rust | Electron + Node | Electron + .NET backend | WPF/WinUI 3 |
|---|---|---|---|---|
| Installer size | **~6–10 MB** | 90–150 MB | 150 MB+ | 5–60 MB |
| Idle RAM | **~60–90 MB** (WebView2) | 200–300 MB | 300 MB+ | ~80 MB |
| Native process control | Rust `tokio::process`, hidden windows, kill-on-drop | child_process | Good, but two runtimes | Good |
| Background engine | Same binary, async tasks keep running in the tray | Main process | Separate service | Same binary |
| UI velocity / looks | React, Tailwind, Motion, glass and Mica | Same | Same | XAML; slower to make look modern |
| Security | Capability-scoped IPC, no Node in the renderer | Node integration risk | Mixed | n/a |

Rust also gives typed parsing for Kubernetes JSON and a crash-safe automation loop (each instance ticks in its own task with a timeout). The web UI keeps design iteration fast. SSH goes through Windows' built-in OpenSSH (`ssh.exe`/`scp.exe`), so there's no OpenSSL dependency.

---

## 5. Roadmap

| Phase | Scope | Status |
|---|---|---|
| **1. Core engine** | Rust process/SSH/Hyper-V/SteamCMD layers, BattleGroup + ServerStats parsing, state store | ✅ |
| **2. GUI & folders** | Shell, tabs, folders with DnD, wizard, Overview/Maps/Logs/Console, demo simulator | ✅ |
| **3. Config, telemetry & players** | INI engine + visual editor + diff, spec editor, charts, DB explorer, invite | ✅ |
| **4. Automation & integrations** | Watchdog, schedules, backups, update polling, DDNS, UPnP, Discord | ✅ |
| **4b. Polish** | Native Windows notifications (crashes, failures, updates) · start with Windows minimized to tray · fleet-wide actions · player invite builder | ✅ |
| **4c. Admin & coverage (1.1.0)** | Player roster from the world DB, kick / give Solari / award XP, ~60 additional settings (XP, harvest, crafting, survival, building, storms, worms, vehicles, BattlEye, admin login & GM allow-list), close-to-tray dialog, portable edition, snapshot de-duplication | ✅ |
| **5. Next** | Long-term metrics history (SQLite) · multi-host fleets over remote SSH (VMs on Proxmox) · admin commands if Funcom ships an RCON or admin queue · signed auto-updates | planned |

## Sources
* [Funcom: Self Hosted Servers](https://duneawakening.com/?p=33559)
* [Dune: Awakening Community Wiki: Self-Hosted Server Guide](https://awakening.wiki/Self-Hosted_Server_Guide)
* [TroubleChute: Self-hosted server guide](https://hub.tcno.co/games/dune-awakening/self-hosted-server/)
* [Self-Hosting on Proxmox/KVM (battlegroup CLI, ports, CR details)](https://benninger.ca/posts/dune-awakening-server-proxmox/)
* [adainrivers/dune-dedicated-server-manager (BattleGroup/ServerStats schema)](https://github.com/adainrivers/dune-dedicated-server-manager)
* [pmarreck/dune_awakening_server (component breakdown)](https://github.com/pmarreck/dune_awakening_server)
* [gamesomg settings reference](https://gamesomg.com/dune-awakening-server-settings/)
* [RPG Site: console launch & crossplay](https://www.rpgsite.net/news/20515-dune-awakening-coming-to-ps5-xbox-series-xs-with-major-update-patch-on-september-22)
* [Gematsu: console launch (self-hosting PC-only)](https://gematsu.com/2026/06/dune-awakening-for-ps5-xbox-series-launches-september-22)
* [Icehunter/dune-awakening-truenas (world-DB schema, admin settings, recommended INIs)](https://github.com/Icehunter/dune-awakening-truenas)
* [snapetech/DuneAwakeningSelfHost (GM console research)](https://github.com/snapetech/DuneAwakeningSelfHost/blob/main/docs/admin-gm-console.md)
* [dune.hexaspark.com server-config wiki (XP/harvest/survival keys)](https://dune.hexaspark.com/?page=ServerConfig)
* [Massively OP: planned admin commands](https://massivelyop.com/2026/05/21/dune-awakening-answers-questions-about-about-upcoming-features-for-self-hosted-servers/)
* [1.5.3.1 hotfix notes (BattlEye optional, custom settings file)](https://patched.gg/games/dune-awakening/dune-awakening-1531-hotfix-patch-notes)
