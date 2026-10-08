import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { CheckCircle2, Download, FolderSearch, IdCard, KeyRound, Link2, Monitor, PlugZap, Route, ScanSearch, Trash2, XCircle } from "lucide-react";
import { useState } from "react";
import { FOLDER_COLORS, useStore } from "../../lib/store";
import * as api from "../../lib/api";
import { isTauri } from "../../lib/tauri";
import { Badge, Button, Callout, Card, CardHeader, confirm, cx, Field, Input, Segmented, Select, Textarea } from "../../components/ui";
import type { Instance } from "../../lib/types";

export function KeyPicker({ value, onChange, searchDirs, name }: { value: string; onChange: (v: string) => void; searchDirs: string[]; name: string }) {
  const [found, setFound] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input mono value={value} onChange={(e) => onChange(e.target.value)} placeholder="C:\…\id_ed25519" className="flex-1" />
        {isTauri && (
          <Button
            icon={FolderSearch}
            onClick={async () => {
              const p = await openDialog({ multiple: false, directory: false, title: "Select SSH private key" });
              if (typeof p === "string") onChange(p);
            }}
          >
            Browse
          </Button>
        )}
        <Button
          icon={ScanSearch}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setFound(await api.discoverKeys(searchDirs.filter(Boolean)));
            setBusy(false);
          }}
        >
          Find keys
        </Button>
      </div>
      {found && (
        <div className="rounded-xl bg-black/20 p-2">
          {found.length === 0 && <div className="p-2 text-[12px] text-sand-500">No private keys found in the server folder or ~/.ssh.</div>}
          {found.map((k) => (
            <button key={k} onClick={() => onChange(k)} className={cx("block w-full truncate rounded-lg px-2.5 py-1.5 text-left font-mono text-[12px] hover:bg-white/[0.06]", k === value ? "text-[var(--accent-2)]" : "text-sand-300")}>
              {k}
            </button>
          ))}
        </div>
      )}
      {value && isTauri && !value.includes("DuneServerManager\\keys") && (
        <button
          className="text-[11.5px] text-sand-400 underline decoration-dotted hover:text-sand-200"
          onClick={async () => {
            try {
              const dest = await api.importKey(value, name);
              onChange(dest);
              useStore.getState().toast({ kind: "success", title: "Key imported", body: "Copied into the app key store with a locked-down ACL (fixes OpenSSH “unprotected private key” errors)." });
            } catch (e) {
              useStore.getState().toast({ kind: "error", title: "Import failed", body: String(e) });
            }
          }}
        >
          Import into app key store & fix permissions
        </button>
      )}
    </div>
  );
}

export function InstanceSettingsTab({ inst }: { inst: Instance }) {
  const update = useStore((s) => s.updateInstance);
  const folders = useStore((s) => s.folders);
  const vms = useStore((s) => s.vms);
  const removeInstance = useStore((s) => s.removeInstance);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const set = (p: Partial<Instance>) => update(inst.id, p);
  const setSsh = (p: Partial<Instance["ssh"]>) => update(inst.id, (i) => ({ ssh: { ...i.ssh, ...p } }));
  const vm = vms.find((v) => v.name === inst.vmName);

  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card>
        <CardHeader icon={IdCard} title="Identity" />
        <div className="space-y-4 px-5 pb-5">
          <Field label="Display name">
            <Input value={inst.name} onChange={(e) => set({ name: e.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea rows={2} value={inst.description} onChange={(e) => set({ description: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Folder">
              <Select value={inst.folderId ?? ""} onChange={(v) => set({ folderId: v || null })} options={[{ value: "", label: "Ungrouped" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} />
            </Field>
            <Field label="Tags" hint="Comma separated, e.g. pvp, eu, modded">
              <Input defaultValue={inst.tags.join(", ")} onBlur={(e) => set({ tags: e.target.value.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) })} />
            </Field>
          </div>
          <Field label="Accent color">
            <div className="flex gap-2">
              {FOLDER_COLORS.map((c) => (
                <button key={c} onClick={() => set({ color: c })} className={cx("size-7 rounded-full transition hover:scale-110", inst.color === c && "ring-2 ring-white/70 ring-offset-2 ring-offset-[#1b1613]")} style={{ background: c }} />
              ))}
            </div>
          </Field>
          <Field label="Mode">
            <Segmented
              value={inst.mode}
              onChange={(v) => set({ mode: v })}
              options={[
                { value: "real", label: "Live server" },
                { value: "demo", label: "Demo simulation" },
              ]}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader icon={PlugZap} title="Connection" subtitle="SSH into the battlegroup VM (user dune). OpenSSH is built into Windows." />
        <div className="space-y-4 px-5 pb-5">
          <Field label="Hyper-V VM" hint={vm ? `${vm.state} · ${vm.ips.join(", ") || "no IP reported"}` : "Funcom’s setup names it “dune-awakening” by default"}>
            <div className="flex gap-2">
              {vms.length > 0 ? (
                <Select value={inst.vmName} onChange={(v) => set({ vmName: v })} options={[{ value: "", label: "None" }, ...vms.map((v) => ({ value: v.name, label: `${v.name}${v.duneConfidence !== "none" ? "  ★" : ""}` }))]} className="flex-1" />
              ) : (
                <Input value={inst.vmName} onChange={(e) => set({ vmName: e.target.value })} className="flex-1" />
              )}
              {vm?.ips[0] && vm.ips[0] !== inst.ssh.host && (
                <Button icon={Monitor} onClick={() => setSsh({ host: vm.ips[0] })}>
                  Use {vm.ips[0]}
                </Button>
              )}
            </div>
          </Field>
          <div className="grid grid-cols-[1fr_100px_120px] gap-3">
            <Field label="VM IP / host">
              <Input mono value={inst.ssh.host} onChange={(e) => setSsh({ host: e.target.value.trim() })} placeholder="192.168.1.60" />
            </Field>
            <Field label="Port">
              <Input mono type="number" value={inst.ssh.port ?? 22} onChange={(e) => setSsh({ port: Number(e.target.value) || 22 })} />
            </Field>
            <Field label="User">
              <Input mono value={inst.ssh.user} onChange={(e) => setSsh({ user: e.target.value.trim() })} />
            </Field>
          </div>
          <Field label="Private key" hint="battlegroup.bat generates one during initial-setup (rotate it from the bat menu). “Find keys” scans the server folder and ~/.ssh.">
            <KeyPicker value={inst.ssh.keyPath ?? ""} onChange={(v) => setSsh({ keyPath: v })} searchDirs={[inst.installDir, inst.batPath.replace(/\\[^\\]+$/, "")]} name={inst.name} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="primary"
              icon={Link2}
              loading={testing}
              onClick={async () => {
                setTesting(true);
                try {
                  setTest({ ok: true, text: await api.sshTest(inst) });
                } catch (e) {
                  setTest({ ok: false, text: String(e) });
                } finally {
                  setTesting(false);
                }
              }}
            >
              Test connection
            </Button>
            {isTauri && inst.ssh.host && (
              <Button variant="ghost" onClick={() => api.forgetHost(inst.ssh.host).then(() => useStore.getState().toast({ kind: "info", title: "Host key forgotten", body: "The next connection trusts the VM's new key." }))}>
                Reset host key
              </Button>
            )}
          </div>
          {test && (
            <Callout kind={test.ok ? "success" : "error"} icon={test.ok ? CheckCircle2 : XCircle}>
              <pre className="font-mono text-[12px] whitespace-pre-wrap">{test.text}</pre>
              {!test.ok && /permission denied/i.test(test.text) && <div className="mt-1">Key rejected. Make sure it's the key from battlegroup.bat, or import it to fix file permissions.</div>}
              {!test.ok && /host key|REMOTE HOST IDENTIFICATION/i.test(test.text) && <div className="mt-1">The VM was reinstalled. Use “Reset host key”.</div>}
            </Callout>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader icon={Route} title="Paths & battlegroup" />
        <div className="space-y-4 px-5 pb-5">
          <Field label="Self-hosted server tool folder (Windows)">
            <div className="flex gap-2">
              <Input mono value={inst.installDir} onChange={(e) => set({ installDir: e.target.value })} className="flex-1" />
              {isTauri && (
                <Button
                  icon={FolderSearch}
                  onClick={async () => {
                    const p = await openDialog({ directory: true, title: "Select server tool folder" });
                    if (typeof p === "string") {
                      const bat = await api.findBattlegroupBat(p);
                      set({ installDir: p, batPath: bat ?? inst.batPath });
                    }
                  }}
                >
                  Browse
                </Button>
              )}
            </div>
          </Field>
          <Field label="battlegroup.bat">
            <Input mono value={inst.batPath} onChange={(e) => set({ batPath: e.target.value })} />
          </Field>
          <Field label="UserSettings directory (inside VM)" hint="Funcom default: /home/dune/server/DuneSandbox/Saved/UserSettings">
            <Input mono value={inst.settingsDir} onChange={(e) => set({ settingsDir: e.target.value })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Namespace" hint="Auto-detected on first contact">
              <Input mono value={inst.namespace} onChange={(e) => set({ namespace: e.target.value.trim() })} placeholder="funcom-seabass-…" />
            </Field>
            <Field label="Battlegroup name">
              <Input mono value={inst.battlegroup} onChange={(e) => set({ battlegroup: e.target.value.trim() })} />
            </Field>
          </div>
          <Field label="Branch">
            <Segmented
              value={inst.branch}
              onChange={(v) => set({ branch: v, appId: v === "ptc" ? api.APP_PTC : api.APP_LIVE })}
              options={[
                { value: "live", label: `Live (${api.APP_LIVE})` },
                { value: "ptc", label: `PTC (${api.APP_PTC})` },
              ]}
            />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader icon={KeyRound} title="Portability & danger zone" />
        <div className="space-y-3 px-5 pb-5">
          <Button
            icon={Download}
            onClick={() => {
              const clean = { ...inst, webhooks: inst.webhooks.map((w) => ({ ...w, url: "" })), automation: { ...inst.automation, ddns: { ...inst.automation.ddns, token: "" } } };
              const blob = new Blob([JSON.stringify({ instances: [clean], folders: [] }, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `${inst.name.replace(/\W+/g, "-")}.dsm.json`;
              a.click();
              URL.revokeObjectURL(a.href);
            }}
          >
            Export instance (secrets stripped)
          </Button>
          <div className="rounded-xl border border-bad/25 bg-bad/[0.06] p-4">
            <div className="text-[13px] font-semibold text-[#ff8a87]">Remove from manager</div>
            <div className="mt-1 text-[12.5px] text-sand-400">Only removes the entry here. The VM, game files, world data and local backups stay untouched.</div>
            <Button
              variant="danger"
              icon={Trash2}
              className="mt-3"
              onClick={async () => {
                if (await confirm({ title: `Remove ${inst.name}?`, danger: true, typeToConfirm: inst.name, confirmLabel: "Remove" })) removeInstance(inst.id);
              }}
            >
              Remove instance
            </Button>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            <Badge>id {inst.id}</Badge>
            <Badge>created {new Date(inst.createdAt).toLocaleDateString()}</Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}
