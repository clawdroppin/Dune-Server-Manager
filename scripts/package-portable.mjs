// Packages the release exe as a portable zip: the exe + a `portable` marker, so data lives in .\data.
// Run after `tauri build` (npm run build:all does both).
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const exe = join(root, "src-tauri", "target", "release", "dune-server-manager.exe");
if (!existsSync(exe)) {
  console.error(`Release exe not found at ${exe}. Run "npm run tauri build" first.`);
  process.exit(1);
}

const outDir = join(root, "release");
mkdirSync(outDir, { recursive: true });
// Stage in a throwaway temp folder: never touch a portable copy someone may be running (and its .\data).
const tmp = mkdtempSync(join(tmpdir(), "dsm-portable-"));
const stage = join(tmp, "DuneServerManager-Portable");
mkdirSync(stage, { recursive: true });

copyFileSync(exe, join(stage, "Dune Server Manager.exe"));
writeFileSync(
  join(stage, "portable"),
  "This file switches Dune Server Manager into portable mode.\r\nAll data is stored in the 'data' folder next to the exe.\r\nDelete this file to use %APPDATA%\\DuneServerManager instead.\r\n",
);
writeFileSync(
  join(stage, "README-Portable.txt"),
  [
    `Dune Server Manager ${version} - Portable`,
    "",
    "1. Extract this folder anywhere you can write to (not Program Files), e.g. D:\\Tools\\DuneServerManager.",
    "2. Run 'Dune Server Manager.exe'. A 'data' folder is created next to it on first launch.",
    "3. Everything (config, backups, imported SSH keys, SteamCMD, server tool files, WebView cache) lives in .\\data.",
    "",
    "Moving or copying the whole folder takes everything with you.",
    "If 'Start with Windows' is enabled, toggle it off/on after moving so the new path is registered.",
    "Hyper-V control still needs 'Run as administrator' (or Hyper-V Administrators group membership).",
    "Requires the Microsoft Edge WebView2 runtime (built into Windows 11 and current Windows 10).",
    "",
  ].join("\r\n"),
);

const zip = join(outDir, `DuneServerManager-${version}-Portable.zip`);
rmSync(zip, { force: true });
try {
  execFileSync("powershell.exe", ["-NoProfile", "-Command", `Compress-Archive -Path '${stage}' -DestinationPath '${zip}' -CompressionLevel Optimal`], { stdio: "inherit" });
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(`Portable build: ${zip}`);
console.log("Extract it somewhere outside the repo to use it; the zip is replaced on every build.");
