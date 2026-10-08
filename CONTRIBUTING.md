# Contributing

Thanks for helping make Dune self-hosting easier. There are many ways to help, and most of them need no code.

## Reporting bugs

Open a [bug report](../../issues/new/choose) and include:
- the app version (*Settings → About*) and whether you use the installer or portable edition
- what you did, what you expected and what happened
- screenshots, and output from the **Operations drawer** or **Automation log** if relevant

Remove IP addresses, passwords, tokens and webhook URLs before posting.

## Sharing setting discoveries

Found an INI key that works but isn't in the editor? Open a **Setting discovery** issue with the file, section, key, what it does and the values you tested. This is one of the most useful contributions, because Funcom has documented very few settings.

## Code contributions

1. Read **[AGENTS.md](AGENTS.md)**. It has the file map, data flow, recipes (add a setting, tab, command, automation rule) and conventions.
2. Set up: install Node.js 20+ and Rust, then run `npm install`.
3. Develop with `npm run dev` (browser + demo sandbox) or `npm run tauri dev` (full app).
4. Before opening a pull request:
   - `npx tsc -b` is clean
   - `cd src-tauri && cargo check` has no warnings and `cargo test --lib` passes
   - every server tab still works in the demo sandbox
   - if you added an API that takes an instance, add a demo branch in `src/lib/demo.ts`
5. Keep pull requests focused, and describe how you tested (demo only, or a real server).

### Ground rules
- Mark settings `verified: true` only when Funcom documents them. Community keys stay `verified: false`.
- Anything destructive must go through `confirm()`. Config writes must keep a server-side backup.
- Remote scripts are POSIX `sh` (the VM runs Alpine/busybox). Don't use bash-isms.

## Code of conduct

Be kind and patient. Everyone here is a volunteer.
