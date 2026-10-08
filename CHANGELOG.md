# Changelog

All notable changes are listed here. Versions follow [Semantic Versioning](https://semver.org).

## [1.1.0] - 2026-10-08

### Added
- **Player roster**: every character with online status, map, last seen, buildings and Solari, with Online/Everyone filter and search.
- **Player actions**: kick, give or remove Solari, award specialization XP (via the world database, with confirmation and logging).
- **About 30 more game settings**: build range and height, repair cost, base-backup limits, PvP security zones, day length, sandworm and Shai-Hulud timing, storm and Coriolis damage, item decay, loot, recycler output, vehicle wear, thirst and more.
- **Progression & XP** and **Rates & Economy** categories with XP, fame and harvest multipliers; presets updated.
- **Admin (experimental)** category: BattlEye toggle, in-game admin password, allowed GM commands.
- **Ready-made SQL queries**: players, richest players, top builders, XP by track, common items.
- **Close behaviour**: ask, minimize to tray or quit, with a tray menu Quit item.
- **Start with Windows** and **desktop notifications** for crashes and updates.

### Fixed
- World-database connection now uses the correct pod, database and credentials.
- Read-only SQL mode can no longer be bypassed with multiple statements.
- Online detection no longer depends on an exact status name.
- The admin-password field showed the wrong placeholder.

### Improved
- One fewer command per poll inside the VM, and UI and background engine share a short snapshot cache.

## [1.0.0]

First release: fleet dashboard, setup wizard, live telemetry, visual settings editor, logs, console, backups, automation engine, networking tools, Discord webhooks, demo sandbox, installer and portable editions.
