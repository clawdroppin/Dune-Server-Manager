# Credits

Dune Server Manager was created by **Jakub**. It stands on the work of many people. Thank you all.

## Funcom

**[Funcom](https://www.funcom.com)** made *Dune: Awakening* and its self-hosted server tooling (the Steam *Dune: Awakening Self-Hosted Server* tool, `battlegroup.bat`, the Hyper-V VM image and the in-VM `battlegroup` CLI). This app only drives that tooling. All of the actual server is Funcom's work.

- [Funcom: Self-Hosted Servers announcement](https://duneawakening.com/?p=33559)

## Community research

Funcom has documented little of the self-hosted stack, so many features rely on what server owners found and shared. Particular thanks to:

| Who | What we learned from it |
|---|---|
| **[Icehunter / dune-awakening-truenas](https://github.com/Icehunter/dune-awakening-truenas)** | World-database schema (players, Solari, XP), admin settings, recommended INI values |
| **[snapetech / DuneAwakeningSelfHost](https://github.com/snapetech/DuneAwakeningSelfHost)** | In-game admin / GM console research |
| **[adainrivers / dune-dedicated-server-manager](https://github.com/adainrivers/dune-dedicated-server-manager)** | BattleGroup and ServerStats resource layout |
| **[pmarreck / dune_awakening_server](https://github.com/pmarreck/dune_awakening_server)** | Battlegroup component breakdown |
| **[benninger.ca: Dune on Proxmox/KVM](https://benninger.ca/posts/dune-awakening-server-proxmox/)** | `battlegroup` CLI, ports, custom-resource details |
| **[dune.hexaspark.com](https://dune.hexaspark.com/?page=ServerConfig)** | Server-config reference (XP, harvest, survival keys) |
| **[Awakening Wiki](https://awakening.wiki/Self-Hosted_Server_Guide)** | Self-hosted server guide, developer updates |
| **[TroubleChute (TCNO)](https://hub.tcno.co/games/dune-awakening/self-hosted-server/)** | Self-hosted server setup guide |
| **[gamesomg](https://gamesomg.com/dune-awakening-server-settings/)** | Server-settings reference |
| **CubeCoders / AMP community** | Reports on how `UserServerCustomSettings.ini` is applied |
| **Steam community discussions** | Admin-command and hosting experiences |

No code was copied from these projects. They were used as documentation. If you're credited here and want a different link or wording, please open an issue.

## Open-source software

The app is built with these projects (and their dependencies):

- **[Tauri](https://tauri.app)**: desktop shell, plugins (dialog, opener, single-instance, notification, autostart)
- **[Rust](https://www.rust-lang.org)** crates: [tokio](https://tokio.rs), [serde](https://serde.rs), [reqwest](https://github.com/seanmonstar/reqwest), [rustls](https://github.com/rustls/rustls), [sysinfo](https://github.com/GuillaumeGomez/sysinfo), [igd-next](https://github.com/dariusc93/rust-igd), [zip](https://github.com/zip-rs/zip2), [chrono](https://github.com/chronotope/chrono), [regex](https://github.com/rust-lang/regex), [walkdir](https://github.com/BurntSushi/walkdir), [parking_lot](https://github.com/Amanieu/parking_lot), [base64](https://github.com/marshallpierce/rust-base64), [anyhow](https://github.com/dtolnay/anyhow), [dirs](https://github.com/dirs-dev/dirs-rs), [once_cell](https://github.com/matklad/once_cell)
- **[React](https://react.dev)**, **[TypeScript](https://www.typescriptlang.org)**, **[Vite](https://vite.dev)**
- **[Tailwind CSS](https://tailwindcss.com)**, **[Motion](https://motion.dev)**, **[Zustand](https://github.com/pmndrs/zustand)**, **[clsx](https://github.com/lukeed/clsx)**
- **[Lucide](https://lucide.dev)** icons
- Fonts via **[Fontsource](https://fontsource.org)**: [Inter](https://rsms.me/inter/), [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk), [JetBrains Mono](https://www.jetbrains.com/lp/mono/) (SIL Open Font License)
- **[SteamCMD](https://developer.valvesoftware.com/wiki/SteamCMD)** by Valve (downloaded at runtime, not bundled)
- **[api.steamcmd.net](https://www.steamcmd.net)** for build-number lookups

Each project keeps its own license.

## Built with AI assistance

Much of this app was designed and written together with **[Claude](https://claude.ai)** (Anthropic) via Claude Code.

## Trademarks

*Dune: Awakening* is a trademark of Funcom. *Dune* is a trademark of Herbert Properties LLC. This project is unofficial and is not affiliated with, endorsed by or sponsored by Funcom, Legendary Entertainment or Herbert Properties.
