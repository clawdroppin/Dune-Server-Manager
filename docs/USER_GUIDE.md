# User guide

This guide walks through every part of Dune Server Manager. New to self-hosting? Read **[How the server works](#how-the-server-works)** first. It makes the rest make sense.

- [Installing](#installing)
- [How the server works](#how-the-server-works)
- [Creating or connecting a server](#creating-or-connecting-a-server)
- [The main window](#the-main-window)
- [Server tabs](#server-tabs)
- [App settings](#app-settings)
- [Troubleshooting](#troubleshooting)

---

## Installing

Download from the [Releases page](https://github.com/clawdroppin/Dune-Server-Manager/releases/latest).

**Installer (`…-setup.exe`)**: run it and follow the steps. The app appears in the Start menu. Your settings live in `%APPDATA%\DuneServerManager`.

**Portable (`…-Portable.zip`)**: right-click the zip → *Extract All*, choose a normal folder such as `D:\Tools\DuneServerManager` (not *Program Files*), and run `Dune Server Manager.exe`. Everything (settings, backups, keys, SteamCMD) is kept in the `data` folder beside it, so you can move or back up the whole folder.

To **update** the portable version, extract the new zip over the old folder. Your `data` folder is kept.

> **"Windows protected your PC"?** The app isn't code-signed. Click **More info → Run anyway**.

**Administrator rights**: needed only for Hyper-V actions (start/stop the VM, checkpoints, resources). Use the **Run as admin** button in the title bar, or right-click the exe → *Run as administrator*. Everything else works as a normal user.

---

## How the server works

Funcom's self-hosted server doesn't run as a normal Windows program:

```
Steam tool "Dune: Awakening Self-Hosted Server"
 └─ battlegroup.bat  ── creates ──►  Hyper-V virtual machine "dune-awakening" (Linux)
                                       └─ Kubernetes "battlegroup"
                                          ├─ one game server per map (Hagga Basin, Deep Desert, Arrakeen…)
                                          ├─ PostgreSQL database (your world)
                                          └─ supporting services (gateway, director, message queue)
```

- A **battlegroup** is one world. Each map runs as its own server, called a **partition**.
- The VM's game settings are in `UserSettings/*.ini` files inside it.
- Dune Server Manager talks to the VM over **SSH** (with the key that `battlegroup.bat` created), to **Hyper-V** with PowerShell, and to **Steam** with SteamCMD.

---

## Creating or connecting a server

Click **New battlegroup** (sidebar or home page). The wizard offers four starting points:

| Option | When to use |
|---|---|
| **Fresh install** | Nothing installed yet. The app downloads the server tool with SteamCMD. |
| **Use existing install** | You installed the tool from Steam (*Library → Tools*). The app finds it. |
| **Connect to running VM** | The VM already exists, on this PC or another machine. You only need its IP and SSH key. |
| **Demo sandbox** | A simulated server to explore the app. |

### Fresh install, step by step
1. **Identity**: name the server in the manager, pick a folder, and choose *Live* or *Public Test (PTC)*.
2. **Prerequisites**: the app checks Windows edition, Hyper-V, virtualization, AVX2, RAM, disk, permissions and the OpenSSH client. Each failed check tells you how to fix it.
3. **Download**: SteamCMD installs the server tool. Progress is shown live.
4. **Setup**:
   1. Generate a **self-hosting token** at [account.duneawakening.com](https://account.duneawakening.com), signing in with the Steam account that owns the game.
   2. Click to open `battlegroup.bat` (it runs as administrator). Choose **initial-setup** and paste your token. This creates the VM and takes a while.
5. **Connect**: the app finds the Hyper-V VM, reads its IP, imports the SSH key and tests the connection.
6. **Finish**: your server appears in the sidebar.

---

## The main window

- **Sidebar**: *Fleet overview*, *Host & prerequisites*, your **folders** and servers. Drag servers between folders. Filter by name or `#tag`. The bottom shows host CPU and RAM.
- **Tabs**: each server opens in its own tab, like a browser. The **+** button opens a new one.
- **Command palette**: <kbd>Ctrl</kbd>+<kbd>K</kbd> to jump to any server, tab or action.
- **Title bar icons**: the **Operations drawer** (live output of running jobs) and **activity/notifications**.

### Fleet overview
Totals across all servers (online servers, players, host CPU and memory, alerts in the last 24 h), host graphs, and a card per server with its health score and quick Start/Stop. **Fleet actions** starts, stops or restarts everything at once.

### Host & prerequisites
Your PC's hardware and the same checks the wizard runs, plus the list of Hyper-V VMs.

---

## Server tabs

### Overview
Health score (0–100), status, uptime, build number and update badge, VM resources, partition summary and recent events. The header has **Start**, **Stop**, **Restart** and **Update**. The **⋯** menu has maintenance mode, Battlegroup Director, `battlegroup.bat`, a database backup and a Hyper-V checkpoint.

### Maps & Pods
Every map partition with players, readiness and its UDP port, plus every Kubernetes pod with CPU, memory and restart counts. A rising restart count means a crashing map.

### Players
- **Statistics**: online now, session peak, average and busiest map, plus players over time and distribution by map.
- **Player roster**: everyone in the world database. Switch *Online / Everyone* and search by name or ID. Each row has:
  - **Give Solari**: a positive amount adds, a negative amount removes. The balance can't go below zero.
  - **Award XP**: pick a specialization track and an amount.
  - **Kick**: disconnects the player on the server's next check-in. They can rejoin unless you change the join password.
- **SQL explorer**: run queries against the world database. It's **read-only** unless you tick *Allow writes*. Ready-made queries are in the snippet menu.
- **Invite card**: the address and password to share with friends.

> These player tools write straight to the live database. They're based on community research, not official Funcom documentation. Take a backup first, and prefer making changes while the player is offline. Players may need to relog to see them.

### Console
A terminal into the VM with three modes: **shell**, **kubectl** and the **battlegroup CLI**. Quick-command chips cover common jobs (status, pods, disk usage…).

### Logs
Live logs from any pod. Pick a map server and follow its output as it happens, with *wrap lines* and *stick to bottom*.

### Game Settings
- **Visual editor**: settings grouped by category (Server, Progression & XP, Rates & Economy, Crafting & Inventory, Survival, World & Hazards, Building, PvP & Combat, Guilds & Social, Persistence, Admin, Advanced). Search finds a setting by name or key.
  - A **custom** badge means you've changed it from the default. The ↺ button resets it.
  - A **community** badge means the key isn't officially documented. See the FAQ in the README.
  - **Advanced** shows every key in your files that the editor doesn't know yet.
- **Presets**: Vanilla, Boosted 3×, Casual PvE, Builder's paradise, Hardcore survival.
- **Raw INI**: edit the files directly.
- When you save, you see a **diff** of every change. The server keeps a `.dsm-<time>.bak` copy of the old file.
- **Restart the server** to apply changes.

### Backups
Create a backup now (settings + battlegroup spec, and optionally the full world database). The archive list lets you **pin** archives so they're never pruned, **show in Explorer**, **delete**, or **restore** settings from an archive. Scheduled backups are set up in *Automation*.

### Automation
Runs in the background even when the window is closed to the tray.
- **Watchdog**: crash alerts (pod restarts), *keep battlegroup running*, and *recover the Hyper-V VM* (needs admin).
- **Scheduled restarts**: times of day (local time), with countdown warnings on Discord at the minutes you choose.
- **Scheduled backups**: interval, how many to keep, and whether to include the world database.
- **Updates**: check Steam every N minutes, and optionally **auto-install** (with a safety backup first).
- **Maintenance mode** (Overview ⋯ menu) pauses everything while you work on the server.
- The **automation log** shows every decision the engine made.

### Network
- **Public IP**, **CGNAT detection** (if your ISP shares your IP, port forwarding can't work) and **reachability probes**.
- **UPnP**: one click forwards the game ports to the VM, if your router allows it.
- **Port reference**: UDP 7777-7810 (one per map) and TCP 31982 must reach the VM. Never expose SSH, Kubernetes or the database.
- **Dynamic DNS**: keep a hostname pointed at your home IP with DuckDNS, Cloudflare or a custom URL.

### Discord
Add webhooks (Discord *Server Settings → Integrations → Webhooks → New*). Choose which events each one receives: state changes, crashes, restarts, warnings, updates, backups and players. You can also add a role mention. Global webhooks in app settings get events from every server.

### Instance
- **Identity**: display name, description, folder, tags, accent color and mode.
- **Connection**: Hyper-V VM, VM IP, SSH port, user and private key.
- **Paths & battlegroup**: the server-tool folder, `battlegroup.bat`, the UserSettings directory, the Kubernetes namespace, the battlegroup name and the branch.
- **Portability & danger zone**: **export** this server's settings with secrets stripped, or **remove** it from the manager. Removing it never deletes the VM, game files, world or backups.

---

## App settings

*Settings* (bottom of the sidebar):
- **General**: what closing the window does (ask, minimize to tray, or quit), **start with Windows** (starts minimized to the tray), **desktop notifications**, and **confirm dangerous actions**. To exit fully, right-click the tray icon and choose **Quit**.
- **Appearance**: accent color, **reduce motion**, and the **telemetry interval**, which sets how often the visible server is polled.
- **Storage locations**: folders for backups, SteamCMD and server-tool installs, plus the Steam username SteamCMD uses.
- **Data**: shows where your data lives and whether this copy is *Installed* or *Portable*. **Export configuration** and **Import…** move your setup to another PC. Exports include webhook URLs and DDNS tokens, so keep the file private.
- **Global webhooks**: Discord webhooks that receive events from every server.
- **Keyboard shortcuts** and **About** (version).

---

## Troubleshooting

| Problem | Try |
|---|---|
| "Permission denied (publickey)" | Instance tab → re-import the SSH key from the `battlegroup.bat` folder. The app fixes its file permissions. |
| Can't start/stop the VM | Run the app as administrator (title-bar button). |
| Server shows *Degraded* | Maps & Pods: look for pods with high restart counts, then check their **Logs**. Usually a lack of RAM. |
| Friends can't connect | Network tab: check for CGNAT, try UPnP or forward UDP 7777-7810 and TCP 31982 to the VM, and make sure the build is up to date. |
| Settings don't change in game | Restart the battlegroup after saving. Community keys may have been renamed by a game update. |
| Roster says "Couldn't read" | The database may still be starting, or a game update changed the schema. The SQL explorer still works. |
| App won't start a second time | Only one copy can run. Look for it in the system tray. |

Still stuck? [Open an issue](https://github.com/clawdroppin/Dune-Server-Manager/issues/new/choose) with the app version (Settings → About) and, if you can, a screenshot.
