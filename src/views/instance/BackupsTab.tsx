import { Archive, Database, FileCog, FolderOpen, HardDriveDownload, History, Pin, PinOff, RotateCcw, Trash2, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useStore } from "../../lib/store";
import { pickBattlegroup } from "../../lib/health";
import * as api from "../../lib/api";
import { runTask } from "../../lib/jobs";
import { wrapperAction } from "../../lib/actions";
import { isTauri, listen } from "../../lib/tauri";
import { bytes, dateTime } from "../../lib/format";
import { Badge, Button, Callout, Card, CardHeader, confirm, Empty, IconButton, Input, Modal, Spinner, Toggle } from "../../components/ui";
import type { BackupEntry, Instance } from "../../lib/types";

export function useBackupRoot() {
  const root = useStore((s) => s.settings.backupRoot);
  const [fallback, setFallback] = useState("");
  useEffect(() => {
    if (!root) api.appPaths().then((p) => setFallback(p.backups));
  }, [root]);
  return root || fallback;
}

export function BackupsTab({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const bg = pickBattlegroup(inst, tel);
  const root = useBackupRoot();
  const [list, setList] = useState<BackupEntry[] | null>(null);
  const [label, setLabel] = useState("manual");
  const [includeDb, setIncludeDb] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [restore, setRestore] = useState<BackupEntry | null>(null);

  const refresh = useCallback(async () => {
    if (!root) return;
    setList(await api.backupList(inst, root));
  }, [inst.id, root]);

  useEffect(() => {
    refresh();
    if (!isTauri) return;
    const un = listen<{ instanceId: string }>("backup://created", (e) => e.payload.instanceId === inst.id && refresh());
    const un2 = listen<{ instanceId: string; step: string }>("backup://progress", (e) => e.payload.instanceId === inst.id && setCreating(e.payload.step === "Done" ? null : e.payload.step));
    return () => {
      un.then((f) => f());
      un2.then((f) => f());
    };
  }, [refresh]);

  const create = async () => {
    if (includeDb && bg && !bg.stop) {
      const ok = await confirm({
        title: "Dump the database while running?",
        body: "Funcom recommends stopping the battlegroup first. A live dump can noticeably lag the VM and may be less consistent. Continue anyway?",
        confirmLabel: "Back up now",
      });
      if (!ok) return;
    }
    setCreating("Starting");
    try {
      const b = await runTask(`${inst.name} · Backup (${label})`, inst.id, (step) =>
        api.backupCreate(inst, root, bg?.namespace || inst.namespace, bg?.name || inst.battlegroup, label || "manual", includeDb, inst.automation.backupKeep, (s) => {
          setCreating(s);
          step(s);
        }),
      );
      useStore.getState().toast({ kind: "success", title: "Backup created", body: `${b.file} · ${bytes(b.size)}` });
      useStore.getState().log({ instanceId: inst.id, level: "info", kind: "backup", message: `Backup ${b.file} created (${bytes(b.size)})` });
      api.notify(inst, "info", "backup", "Manual backup complete", `\`${b.file}\` (${bytes(b.size)})`);
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "Backup failed", body: String(e) });
    } finally {
      setCreating(null);
      refresh();
    }
  };

  const total = (list ?? []).reduce((a, b) => a + b.size, 0);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader icon={Archive} title="Create backup" subtitle="UserSettings + BattleGroup spec, optionally a full world DB dump, compressed into one archive" />
          <div className="flex flex-wrap items-end gap-4 px-5 pb-5">
            <div className="w-64">
              <div className="mb-1.5 text-[12px] font-medium text-sand-300">Label</div>
              <Input value={label} onChange={(e) => setLabel(e.target.value.replace(/[^\w-]/g, "-"))} mono />
            </div>
            <label className="flex h-9 items-center gap-2.5 text-[13px] text-sand-200">
              <Toggle checked={includeDb} onChange={setIncludeDb} />
              <Database className="size-4 text-sand-400" /> Include world database
            </label>
            <div className="flex-1" />
            <Button variant="primary" icon={HardDriveDownload} onClick={create} loading={!!creating} disabled={!root}>
              {creating ?? "Back up now"}
            </Button>
          </div>
          {includeDb && (
            <div className="px-5 pb-5">
              <Callout kind="info" icon={Database}>
                Runs <span className="font-mono">battlegroup backup</span> inside the VM. Funcom’s CLI keeps a copy there for <span className="font-mono">database import</span>. The dump is also downloaded over SCP into the archive. Expect hundreds of MB.
              </Callout>
            </div>
          )}
        </Card>
        <Card className="p-5">
          <div className="text-[11.5px] font-semibold tracking-wider text-sand-400 uppercase">Storage</div>
          <div className="mt-2 font-display text-2xl font-semibold">{bytes(total)}</div>
          <div className="text-[12.5px] text-sand-400">
            {list?.length ?? 0} archives · keeping newest {inst.automation.backupKeep} (pinned are exempt)
          </div>
          <div className="mt-3 truncate font-mono text-[11px] text-sand-500" title={root}>
            {root}
          </div>
          {isTauri && root && (
            <Button size="sm" className="mt-3" icon={FolderOpen} onClick={() => revealItemInDir(root).catch(() => {})}>
              Open folder
            </Button>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader icon={History} title="Archives" subtitle="Newest first" />
        {list == null ? (
          <div className="grid h-32 place-items-center">
            <Spinner />
          </div>
        ) : list.length === 0 ? (
          <Empty icon={Archive} title="No backups yet" body="Create one above or enable scheduled backups in Automation." />
        ) : (
          <div className="divide-y divide-white/[0.05] px-2 pb-2">
            {list.map((b) => {
              const pinned = b.file.includes("-pinned");
              const hasDb = (b.manifest?.files ?? []).some((f: any) => String(f.name).startsWith("database/")) || !!b.manifest?.vmBackupName;
              const warnings: string[] = b.manifest?.warnings ?? [];
              return (
                <div key={b.path} className="group flex items-center gap-4 px-3 py-3">
                  <div className="grid size-9 place-items-center rounded-xl bg-black/25 text-sand-300">{hasDb ? <Database className="size-4" /> : <FileCog className="size-4" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[12.5px] text-sand-100">{b.file}</span>
                      {pinned && <Badge color="#f08a24">pinned</Badge>}
                      {hasDb && <Badge color="#60a5fa">database</Badge>}
                      {warnings.length > 0 && (
                        <span title={warnings.join("\n")}>
                          <Badge color="#f5b83d">
                            <TriangleAlert className="size-3" /> {warnings.length}
                          </Badge>
                        </span>
                      )}
                    </div>
                    <div className="text-[11.5px] text-sand-500">
                      {dateTime(b.created * 1000)} · {bytes(b.size)} · {(b.manifest?.files ?? []).length} files
                      {b.manifest?.vmBackupName && <> · VM copy “{b.manifest.vmBackupName}”</>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-70 group-hover:opacity-100">
                    <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => setRestore(b)}>
                      Restore
                    </Button>
                    <IconButton
                      icon={pinned ? PinOff : Pin}
                      label={pinned ? "Unpin" : "Pin (exempt from retention)"}
                      size="sm"
                      onClick={async () => {
                        await api.backupPin(inst, b.path, !pinned);
                        refresh();
                      }}
                    />
                    {isTauri && inst.mode === "real" && <IconButton icon={FolderOpen} label="Show in Explorer" size="sm" onClick={() => revealItemInDir(b.path).catch(() => {})} />}
                    <IconButton
                      icon={Trash2}
                      label="Delete"
                      size="sm"
                      onClick={async () => {
                        if (!(await confirm({ title: "Delete backup?", body: b.file, danger: true, confirmLabel: "Delete" }))) return;
                        await api.backupDelete(inst, b.path);
                        refresh();
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <RestoreModal inst={inst} backup={restore} onClose={() => setRestore(null)} ns={bg?.namespace || inst.namespace} running={!!bg && !bg.stop} />
    </div>
  );
}

function RestoreModal({ inst, backup, onClose, ns, running }: { inst: Instance; backup: BackupEntry | null; onClose: () => void; ns: string; running: boolean }) {
  const [files, setFiles] = useState<[string, string][] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setFiles(null);
    if (backup) api.backupReadSettings(inst, backup.path).then(setFiles).catch(() => setFiles([]));
  }, [backup?.path]);
  if (!backup) return <Modal open={false} onClose={onClose}>{null}</Modal>;
  const dir = inst.settingsDir || api.DEFAULT_SETTINGS_DIR;
  const restoreSettings = async () => {
    if (!files?.length) return;
    if (!(await confirm({ title: "Restore UserSettings?", body: `Overwrites ${files.length} INI files on the server. Current files are kept as .bak copies.`, confirmLabel: "Restore settings" }))) return;
    setBusy(true);
    try {
      for (const [name, content] of files) await api.remoteWrite(inst, `${dir}/${name}`, content);
      useStore.getState().toast({ kind: "success", title: "Settings restored", body: "Restart the battlegroup to apply." });
      useStore.getState().log({ instanceId: inst.id, level: "info", kind: "backup", message: `UserSettings restored from ${backup.file}` });
      onClose();
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "Restore failed", body: String(e) });
    } finally {
      setBusy(false);
    }
  };
  const vmName = backup.manifest?.vmBackupName as string | undefined;
  return (
    <Modal open onClose={onClose} width={620}>
      <div className="p-6">
        <div className="font-display text-lg font-semibold">Restore from backup</div>
        <div className="mt-1 font-mono text-[12px] text-sand-400">{backup.file}</div>
        <div className="mt-5 space-y-3">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <FileCog className="size-5 text-[var(--accent)]" />
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">Game settings (UserSettings)</div>
                <div className="text-[12px] text-sand-400">{files == null ? "Reading archive…" : files.length ? files.map((f) => f[0]).join(", ") : "No INI files in this archive"}</div>
              </div>
              <Button size="sm" variant="primary" onClick={restoreSettings} loading={busy} disabled={!files?.length}>
                Restore
              </Button>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <Database className="size-5 text-info" />
              <div className="flex-1">
                <div className="text-[13.5px] font-medium">World database</div>
                <div className="text-[12px] text-sand-400">{vmName ? <>Imports the VM-side copy “{vmName}” with Funcom’s <span className="font-mono">battlegroup import</span>.</> : "This archive has no database backup."}</div>
              </div>
              <Button
                size="sm"
                variant="danger"
                disabled={!vmName || running}
                title={running ? "Stop the battlegroup first" : undefined}
                onClick={() => {
                  onClose();
                  wrapperAction(inst, ["import", vmName!], "Import database", {
                    confirmText: `This overwrites the entire world (characters, bases, guilds) with backup “${vmName}”. This cannot be undone.`,
                    danger: true,
                    typeToConfirm: vmName,
                  });
                }}
              >
                Import
              </Button>
            </div>
            {running && vmName && <div className="mt-2 text-[11.5px] text-warn">Stop the battlegroup before importing (the VM must stay running).</div>}
          </Card>
        </div>
        <div className="mt-2 text-[11.5px] text-sand-500">Restoring is never automatic. You pick each part.</div>
        {ns && null}
      </div>
    </Modal>
  );
}
