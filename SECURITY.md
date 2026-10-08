# Security

## Reporting a vulnerability

Please **don't** open a public issue for security problems. Use GitHub's **[private vulnerability reporting](../../security/advisories/new)** instead. You'll get a reply as soon as possible.

## How the app handles sensitive data

- **No telemetry.** The app only connects to services you configure: your server (SSH), Steam, api.steamcmd.net, Discord webhooks, your DDNS provider and a public-IP lookup.
- **SSH keys** you import are copied to the app's data folder, and their permissions are restricted to your Windows user.
- **Configuration** (`state.json`) may contain webhook URLs, DDNS tokens and server passwords. It's stored in your user profile, or in the portable `data` folder. Exports made with *Export configuration* include these secrets, so treat them like passwords. Per-server exports strip secrets.
- **Game settings** writes always keep a `.dsm-<timestamp>.bak` copy on the server.
- The SQL explorer is **read-only** by default and refuses multiple statements unless you enable writes.

## Running a public server safely

- Only forward the ports Funcom requires: **UDP 7777-7810** (game) and **TCP 31982** (game message queue, TLS). Never expose SSH (22), Kubernetes or the database to the internet.
- Change the in-game **admin password** from its public default if you enable admin login.
- Keep the battlegroup up to date. The *Automation* tab can do this for you.
