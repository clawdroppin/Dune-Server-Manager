import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  CloudDownload,
  ExternalLink,
  FlaskConical,
  FolderSearch,
  KeyRound,
  Link2,
  Loader2,
  Monitor,
  PackageSearch,
  PlugZap,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  XCircle,
  AlertTriangle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { FOLDER_COLORS, newInstance, useStore } from "../lib/store";
import * as api from "../lib/api";
import { onStream, isTauri, streamId } from "../lib/tauri";
import { bytes } from "../lib/format";
import { Badge, Button, Callout, cx, Field, Input, Modal, Segmented, Select } from "../components/ui";
import { KeyPicker } from "./instance/InstanceSettingsTab";
import type { HyperVm, InstallFound, Instance, SystemReport } from "../lib/types";

type Source = "fresh" | "adopt" | "connect" | "demo";
type Step = "source" | "identity" | "preflight" | "install" | "setup" | "connect" | "finish";

const FLOWS: Record<Source, Step[]> = {
  fresh: ["source", "identity", "preflight", "install", "setup", "connect", "finish"],
  adopt: ["source", "identity", "preflight", "install", "setup", "connect", "finish"],
  connect: ["source", "identity", "connect", "finish"],
  demo: ["source", "identity", "finish"],
};
const STEP_LABEL: Record<Step, string> = { source: "Source", identity: "Identity", preflight: "Prerequisites", install: "Server files", setup: "Hyper-V setup", connect: "Connect", finish: "Launch" };

export function Wizard() {
  const open = useStore((s) => s.wizardOpen);
  const setOpen = useStore((s) => s.setWizard);
  const [source, setSource] = useState<Source>("fresh");
  const [step, setStep] = useState<Step>("source");
  const [draft, setDraft] = useState<Instance>(() => newInstance());
  const [canNext, setCanNext] = useState(true);

  useEffect(() => {
    if (open) {
      setStep("source");
      setSource("fresh");
      setDraft(newInstance({ name: "Arrakis" }));
    }
  }, [open]);

  const flow = FLOWS[source];
  const idx = flow.indexOf(step);
  const patch = (p: Partial<Instance>) => setDraft((d) => ({ ...d, ...p }));
  const go = (d: 1 | -1) => setStep(flow[Math.max(0, Math.min(flow.length - 1, idx + d))]);

  // The install step drives canNext itself (child effects run before this one).
  useEffect(() => {
    if (step !== "install") setCanNext(step !== "identity" || !!draft.name.trim());
  }, [step, draft.name]);

  const create = () => {
    const s = useStore.getState();
    const inst = { ...draft, mode: source === "demo" ? ("demo" as const) : ("real" as const), createdAt: Date.now() };
    s.addInstance(inst);
    s.openInstance(inst.id);
    s.log({ instanceId: inst.id, level: "info", kind: "state", message: `Instance created (${source})` });
    s.toast({ kind: "success", title: `${inst.name} created`, body: source === "demo" ? "Simulated battlegroup ready to explore." : "Monitoring starts now." });
    setOpen(false);
  };

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={980} dismissable={step === "source" || step === "identity" || step === "finish"}>
      <div className="flex h-[680px] max-h-[86vh]">
        <div className="relative hidden w-[250px] shrink-0 flex-col overflow-hidden border-r hairline p-6 md:flex">
          <div className="pointer-events-none absolute inset-0 grid-fade opacity-60" />
          <div className="pointer-events-none absolute -bottom-24 -left-20 size-72 rounded-full bg-[var(--accent)] opacity-[0.12] blur-3xl" />
          <div className="relative">
            <div className="text-[11px] font-semibold tracking-[0.12em] text-sand-500 uppercase">New battlegroup</div>
            <div className="mt-1 font-display text-xl font-semibold">
              Create <span className="accent-text">server</span>
            </div>
          </div>
          <div className="relative mt-8 space-y-1">
            {flow.map((s, i) => (
              <div key={s} className={cx("flex items-center gap-3 rounded-xl px-2 py-2 text-[13px]", i === idx ? "text-sand-50" : i < idx ? "text-sand-300" : "text-sand-500")}>
                <span className={cx("grid size-6 place-items-center rounded-full text-[11px] font-semibold", i < idx ? "bg-ok/20 text-ok" : i === idx ? "accent-bg text-black" : "bg-white/[0.06]")}>{i < idx ? <Check className="size-3.5" /> : i + 1}</span>
                {STEP_LABEL[s]}
              </div>
            ))}
          </div>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto p-7 pr-14">
            <AnimatePresence mode="wait">
              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.18 }}>
                {step === "source" && <SourceStep source={source} setSource={setSource} />}
                {step === "identity" && <IdentityStep draft={draft} patch={patch} />}
                {step === "preflight" && <PreflightStep />}
                {step === "install" && <InstallStep draft={draft} patch={patch} source={source} setCanNext={setCanNext} />}
                {step === "setup" && <SetupStep draft={draft} />}
                {step === "connect" && <ConnectStep draft={draft} patch={patch} />}
                {step === "finish" && <FinishStep draft={draft} source={source} />}
              </motion.div>
            </AnimatePresence>
          </div>
          <div className="flex items-center gap-2 border-t hairline px-7 py-4">
            {idx > 0 && (
              <Button variant="ghost" icon={ArrowLeft} onClick={() => go(-1)}>
                Back
              </Button>
            )}
            <div className="flex-1" />
            {step === "finish" ? (
              <Button variant="primary" size="lg" icon={Rocket} onClick={create}>
                Create {source === "demo" ? "sandbox" : "battlegroup"}
              </Button>
            ) : (
              <Button variant="primary" onClick={() => go(1)} disabled={!canNext}>
                Continue <ArrowRight className="size-4" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function H({ title, sub }: { title: string; sub?: React.ReactNode }) {
  return (
    <div className="mb-6">
      <div className="font-display text-[22px] font-semibold tracking-tight">{title}</div>
      {sub && <div className="mt-1 text-[13.5px] leading-relaxed text-sand-400">{sub}</div>}
    </div>
  );
}

function SourceStep({ source, setSource }: { source: Source; setSource: (s: Source) => void }) {
  const opts: { id: Source; icon: React.ElementType; title: string; body: string; badge?: string }[] = [
    { id: "fresh", icon: CloudDownload, title: "Fresh install", body: "Download the Self-Hosted Server tool with SteamCMD, run Funcom’s Hyper-V setup, then connect.", badge: "Recommended" },
    { id: "adopt", icon: PackageSearch, title: "Use existing install", body: "You already installed the tool from Steam (Library → Tools). We’ll find it and take it from there." },
    { id: "connect", icon: PlugZap, title: "Connect to running VM", body: "The battlegroup VM is already set up, here or on another machine. Just give the IP and SSH key." },
    { id: "demo", icon: FlaskConical, title: "Demo sandbox", body: "A fully simulated battlegroup to explore every feature. No Hyper-V needed." },
  ];
  return (
    <>
      <H title="How do you want to start?" sub="Dune: Awakening self-hosting runs a Linux VM under Hyper-V with Kubernetes inside. This manager drives Funcom’s official tooling for you." />
      <div className="grid gap-3 sm:grid-cols-2">
        {opts.map((o) => (
          <button
            key={o.id}
            onClick={() => setSource(o.id)}
            className={cx("relative rounded-2xl border p-5 text-left transition-all", source === o.id ? "border-[var(--accent)]/60 bg-[var(--accent-soft)] shadow-[0_0_30px_-10px_var(--accent-glow)]" : "border-white/[0.07] bg-black/20 hover:border-white/[0.15]")}
          >
            {o.badge && <span className="absolute top-4 right-4"><Badge color="#f08a24">{o.badge}</Badge></span>}
            <o.icon className={cx("size-6", source === o.id ? "text-[var(--accent-2)]" : "text-sand-400")} />
            <div className="mt-3 font-display text-[15px] font-semibold">{o.title}</div>
            <div className="mt-1 text-[12.5px] leading-relaxed text-sand-400">{o.body}</div>
          </button>
        ))}
      </div>
    </>
  );
}

function IdentityStep({ draft, patch }: { draft: Instance; patch: (p: Partial<Instance>) => void }) {
  const folders = useStore((s) => s.folders);
  const addFolder = useStore((s) => s.addFolder);
  const [newFolder, setNewFolder] = useState("");
  return (
    <>
      <H title="Name your world" sub="This is the label in the manager. The in-game server name is set later in Game Settings." />
      <div className="space-y-5">
        <Field label="Display name">
          <Input autoFocus value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Sietch Tabr EU" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Folder">
            <Select value={draft.folderId ?? ""} onChange={(v) => patch({ folderId: v || null })} options={[{ value: "", label: "Ungrouped" }, ...folders.map((f) => ({ value: f.id, label: f.name }))]} />
          </Field>
          <Field label="…or create a folder">
            <div className="flex gap-2">
              <Input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Cluster Group A" />
              <Button
                disabled={!newFolder.trim()}
                onClick={() => {
                  patch({ folderId: addFolder(newFolder.trim()) });
                  setNewFolder("");
                }}
              >
                Add
              </Button>
            </div>
          </Field>
        </div>
        <Field label="Tags" hint="Comma separated: pvp, eu, hardcore…">
          <Input defaultValue={draft.tags.join(", ")} onBlur={(e) => patch({ tags: e.target.value.split(",").map((t) => t.trim().replace(/^#/, "")).filter(Boolean) })} />
        </Field>
        <Field label="Branch" hint="Server and game client must be on the same branch and build.">
          <Segmented
            value={draft.branch}
            onChange={(v) => patch({ branch: v, appId: v === "ptc" ? api.APP_PTC : api.APP_LIVE })}
            options={[
              { value: "live", label: "Live" },
              { value: "ptc", label: "Public Test (PTC)" },
            ]}
          />
        </Field>
        <Field label="Accent">
          <div className="flex gap-2">
            {FOLDER_COLORS.map((c) => (
              <button key={c} onClick={() => patch({ color: c })} className={cx("size-7 rounded-full transition hover:scale-110", draft.color === c && "ring-2 ring-white/70 ring-offset-2 ring-offset-[#1b1613]")} style={{ background: c }} />
            ))}
          </div>
        </Field>
      </div>
    </>
  );
}

export function useSystemReport() {
  const [r, setR] = useState<SystemReport | null>(null);
  const [loading, setLoading] = useState(false);
  const run = () => {
    setLoading(true);
    api
      .systemCheck()
      .then(setR)
      .finally(() => setLoading(false));
  };
  useEffect(run, []);
  return { r, loading, run };
}

export function checks(r: SystemReport) {
  const gb = r.ramTotal / 1024 ** 3;
  const bestDisk = [...r.disks].sort((a, b) => b.free - a.free)[0];
  const pro = /pro|enterprise|education|server/i.test(r.windowsEdition);
  return [
    { ok: pro, warn: false, label: "Windows Pro / Enterprise", detail: r.windowsEdition || "unknown edition", fix: "Hyper-V isn't available on Home editions. Upgrade, or run the battlegroup VM on Proxmox/another Pro machine and use “Connect to running VM”." },
    { ok: r.hypervService === "Running", warn: !!r.hypervService && r.hypervService !== "Running", label: "Hyper-V enabled", detail: r.hypervService ? `vmms service: ${r.hypervService}` : "not installed", fix: "Enable “Hyper-V” in Windows Features (optionalfeatures.exe) and reboot." },
    { ok: r.virtualizationFirmware !== false, warn: r.virtualizationFirmware == null, label: "Virtualization in firmware", detail: r.virtualizationFirmware == null ? "hypervisor already running (OK)" : r.virtualizationFirmware ? "enabled" : "disabled", fix: "Enable Intel VT-x / AMD SVM in BIOS." },
    { ok: r.avx2, warn: false, label: "CPU with AVX2", detail: r.cpuModel, fix: "The game server binaries require AVX2." },
    { ok: gb >= 32, warn: gb >= 20 && gb < 32, label: "Memory ≥ 20 GB (64 GB ideal)", detail: `${gb.toFixed(0)} GB installed`, fix: "RAM is the main bottleneck. Below 20 GB, enable experimental swap in battlegroup.bat setup." },
    { ok: (bestDisk?.free ?? 0) > 100e9, warn: (bestDisk?.free ?? 0) > 60e9, label: "≥ 100 GB free SSD", detail: bestDisk ? `${bestDisk.mount} ${bytes(bestDisk.free, 0)} free` : "unknown", fix: "The VM image grows to ~80-120 GB." },
    { ok: r.elevated || r.hypervAdmin, warn: !(r.elevated || r.hypervAdmin), label: "Hyper-V permissions for this app", detail: r.elevated ? "running as Administrator" : r.hypervAdmin ? "Hyper-V Administrators member" : "standard user", fix: "Relaunch as admin (title bar button) to control the VM. SSH monitoring works without it." },
    { ok: r.sshAvailable, warn: false, label: "OpenSSH client", detail: r.sshAvailable ? "C:\\Windows\\System32\\OpenSSH" : "missing", fix: "Settings → Apps → Optional features → add “OpenSSH Client”." },
  ];
}

export function CheckList({ r }: { r: SystemReport }) {
  return (
    <div className="space-y-2">
      {checks(r).map((c) => (
        <div key={c.label} className="flex gap-3 rounded-xl bg-black/20 px-4 py-3">
          {c.ok ? <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-ok" /> : c.warn ? <AlertTriangle className="mt-0.5 size-4.5 shrink-0 text-warn" /> : <XCircle className="mt-0.5 size-4.5 shrink-0 text-bad" />}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-[13.5px] font-medium text-sand-100">{c.label}</span>
              <span className="truncate text-[12px] text-sand-400">{c.detail}</span>
            </div>
            {!c.ok && <div className="mt-1 text-[12px] leading-snug text-sand-400">{c.fix}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PreflightStep() {
  const { r, loading, run } = useSystemReport();
  return (
    <>
      <H title="Prerequisites" sub="Funcom’s self-hosted server needs Windows Pro with Hyper-V, an AVX2 CPU and plenty of RAM. Warnings don't block you." />
      {r ? <CheckList r={r} /> : <div className="grid h-48 place-items-center"><Loader2 className="size-6 animate-spin text-sand-400" /></div>}
      <Button className="mt-4" variant="ghost" icon={RefreshCw} onClick={run} loading={loading}>
        Re-check
      </Button>
    </>
  );
}

function InstallStep({ draft, patch, source, setCanNext }: { draft: Instance; patch: (p: Partial<Instance>) => void; source: Source; setCanNext: (v: boolean) => void }) {
  const settings = useStore((s) => s.settings);
  const [paths, setPaths] = useState<{ steamcmd: string; servers: string } | null>(null);
  const [found, setFound] = useState<InstallFound[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [user, setUser] = useState(settings.steamUser);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.appPaths().then((p) => {
      setPaths({ steamcmd: settings.steamcmdDir || p.steamcmd, servers: settings.serversDir || p.servers });
      if (!draft.installDir) patch({ installDir: `${settings.serversDir || p.servers}\\${draft.name.replace(/[^\w-]+/g, "-")}` });
    });
    if (source === "adopt") api.detectInstalls([]).then(setFound);
  }, []);
  useEffect(() => setCanNext(source === "adopt" ? !!draft.installDir : state === "done" || !!draft.batPath), [state, draft.installDir, draft.batPath, source]);
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [lines]);

  const install = async () => {
    if (!paths) return;
    setState("running");
    setLines([]);
    setProgress(0);
    try {
      const exe = isTauri ? await api.steamcmdEnsure(paths.steamcmd) : "steamcmd.exe";
      setLines((l) => [...l, `SteamCMD ready: ${exe}`]);
      const id = streamId("steam");
      const code = await new Promise<number>((resolve) => {
        onStream(
          id,
          (line) => {
            const m = /progress:\s*([\d.]+)/.exec(line);
            if (m) setProgress(parseFloat(m[1]));
            setLines((l) => [...l.slice(-400), line]);
          },
          resolve,
        );
        api.steamcmdUpdate(id, exe, draft.installDir, draft.appId, user || undefined, true).catch((e) => {
          setLines((l) => [...l, String(e)]);
          resolve(-1);
        });
      });
      if (code !== 0 && code !== 7) throw new Error(`SteamCMD exited with code ${code}`);
      const bat = await api.findBattlegroupBat(draft.installDir);
      patch({ batPath: bat ?? (isTauri ? "" : `${draft.installDir}\\battlegroup.bat`) });
      setProgress(100);
      setState("done");
    } catch (e) {
      setLines((l) => [...l, `✖ ${e}`]);
      setState("error");
    }
  };

  if (source === "adopt")
    return (
      <>
        <H title="Find your installation" sub="Installs of the Self-Hosted Server tool in your Steam libraries:" />
        <div className="space-y-2">
          {found == null && <Loader2 className="size-5 animate-spin text-sand-400" />}
          {found?.length === 0 && <Callout kind="warn" icon={AlertTriangle}>No installs detected. In Steam, enable the Tools filter in your Library and install “Dune: Awakening Self-Hosted Server”, or browse to the folder.</Callout>}
          {found?.map((f) => (
            <button
              key={f.path}
              onClick={() => patch({ installDir: f.path, batPath: f.battlegroupBat ?? "", appId: f.appId, branch: f.appId === api.APP_PTC ? "ptc" : "live" })}
              className={cx("flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left", draft.installDir === f.path ? "border-[var(--accent)]/60 bg-[var(--accent-soft)]" : "border-white/[0.07] bg-black/20 hover:border-white/[0.15]")}
            >
              <PackageSearch className="size-5 text-sand-400" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[12.5px]">{f.path}</div>
                <div className="text-[11.5px] text-sand-500">
                  {f.branch} · build {f.buildId ?? "?"} · {f.source} · {f.battlegroupBat ? "battlegroup.bat found" : "battlegroup.bat not found"}
                </div>
              </div>
            </button>
          ))}
        </div>
        <Field label="Or pick a folder" className="mt-5">
          <div className="flex gap-2">
            <Input mono value={draft.installDir} onChange={(e) => patch({ installDir: e.target.value })} className="flex-1" />
            {isTauri && (
              <Button
                icon={FolderSearch}
                onClick={async () => {
                  const p = await openDialog({ directory: true });
                  if (typeof p === "string") patch({ installDir: p, batPath: (await api.findBattlegroupBat(p)) ?? "" });
                }}
              >
                Browse
              </Button>
            )}
          </div>
        </Field>
      </>
    );

  return (
    <>
      <H title="Download server files" sub={<>SteamCMD fetches app <span className="font-mono">{draft.appId}</span> (Windows depot: Hyper-V VM image plus Funcom’s <span className="font-mono">battlegroup.bat</span>). The Linux game payload (~5 GB) is pulled later inside the VM.</>} />
      <div className="space-y-4">
        <Field label="Install folder">
          <div className="flex gap-2">
            <Input mono value={draft.installDir} onChange={(e) => patch({ installDir: e.target.value })} className="flex-1" disabled={state === "running"} />
            {isTauri && (
              <Button
                icon={FolderSearch}
                disabled={state === "running"}
                onClick={async () => {
                  const p = await openDialog({ directory: true });
                  if (typeof p === "string") patch({ installDir: `${p}\\${draft.name.replace(/[^\w-]+/g, "-")}` });
                }}
              >
                Browse
              </Button>
            )}
          </div>
        </Field>
        <Field label="Steam login" hint="Anonymous works for most users. If SteamCMD says “No subscription”, enter the Steam account that owns the game, sign in once via the console (Steam Guard), then retry.">
          <div className="flex gap-2">
            <Input value={user} onChange={(e) => setUser(e.target.value.trim())} placeholder="anonymous" className="flex-1" />
            {user && isTauri && paths && (
              <Button icon={KeyRound} onClick={async () => api.steamcmdInteractiveLogin(await api.steamcmdEnsure(paths.steamcmd), user)}>
                Sign in (console)
              </Button>
            )}
          </div>
        </Field>
        <div className="flex items-center gap-3">
          <Button variant="primary" icon={CloudDownload} onClick={install} loading={state === "running"} disabled={!draft.installDir}>
            {state === "done" ? "Re-validate" : "Download & install"}
          </Button>
          {state === "done" && (
            <span className="flex items-center gap-1.5 text-[13px] text-ok">
              <CheckCircle2 className="size-4" /> Installed{draft.batPath ? " · battlegroup.bat found" : ""}
            </span>
          )}
          {state === "error" && <span className="text-[13px] text-bad">Failed. See the log below.</span>}
        </div>
        {progress != null && (
          <div>
            <div className="mb-1 flex justify-between text-[11.5px] text-sand-400">
              <span>{state === "done" ? "Complete" : "Downloading"}</span>
              <span className="font-mono">{progress.toFixed(1)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.07]">
              <motion.div className="h-full rounded-full accent-bg" animate={{ width: `${progress}%` }} />
            </div>
          </div>
        )}
        {lines.length > 0 && (
          <div ref={logRef} className="max-h-48 overflow-auto rounded-xl bg-black/50 p-3 font-mono text-[11px] leading-relaxed text-sand-300 selectable">
            {lines.map((l, i) => (
              <div key={i} className="break-all">
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function SetupStep({ draft }: { draft: Instance }) {
  const [launched, setLaunched] = useState(false);
  const launch = async () => {
    try {
      const dir = draft.batPath ? draft.batPath.replace(/\\[^\\]+$/, "") : draft.installDir;
      await api.launchElevatedConsole(dir, `"${draft.batPath || `${draft.installDir}\\battlegroup.bat`}"`);
      setLaunched(true);
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "Couldn't launch battlegroup.bat", body: String(e) });
    }
  };
  const steps = [
    { icon: KeyRound, title: "Generate your self-hosting token", body: "Sign in with the Steam account that owns the game and create a token. Each server needs its own; keep it private.", action: <Button size="sm" icon={ExternalLink} onClick={() => (isTauri ? openUrl("https://account.duneawakening.com") : window.open("https://account.duneawakening.com"))}>account.duneawakening.com</Button> },
    { icon: TerminalSquare, title: "Run initial-setup", body: "battlegroup.bat opens elevated. Choose initial-setup: it creates the Hyper-V VM, network switch and Kubernetes battlegroup, and asks for the token, world name and region.", action: <Button size="sm" variant="primary" icon={ShieldCheck} onClick={launch} disabled={!isTauri}>Launch battlegroup.bat</Button> },
    { icon: Sparkles, title: "Note the port list", body: "At the end, setup prints the ports to forward (UDP 7777–7810, TCP 31982). The Network tab can open them via UPnP." },
  ];
  return (
    <>
      <H title="Funcom’s Hyper-V setup" sub="The official VM provisioning stays in Funcom’s interactive tool, so it’s always the supported path. We launch it for you; come back when it finishes." />
      <div className="space-y-3">
        {steps.map((s, i) => (
          <div key={i} className="flex gap-4 rounded-2xl border border-white/[0.06] bg-black/20 p-4">
            <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-2)]">
              <s.icon className="size-4.5" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold">
                {i + 1}. {s.title}
              </div>
              <div className="mt-1 text-[12.5px] leading-relaxed text-sand-400">{s.body}</div>
              {s.action && <div className="mt-3">{s.action}</div>}
            </div>
          </div>
        ))}
      </div>
      {launched && <Callout kind="info" icon={Loader2} className="mt-4">Waiting on you. Finish the console wizard, then click Continue to link the new VM.</Callout>}
      <Callout kind="warn" icon={AlertTriangle} className="mt-4">
        Hyper-V needs a bare-metal machine (no nested VPS) and an external virtual switch. Setup needs a second IP/MAC on your LAN for the VM.
      </Callout>
    </>
  );
}

function ConnectStep({ draft, patch }: { draft: Instance; patch: (p: Partial<Instance>) => void }) {
  const [vms, setVms] = useState<HyperVm[] | null>(null);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const scan = () => {
    setVms(null);
    api
      .vmList()
      .then((v) => {
        setVms(v);
        const best = v.find((x) => x.duneConfidence === "high") ?? v.find((x) => x.duneConfidence === "medium");
        if (best && !draft.ssh.host) patch({ vmName: best.name, ssh: { ...draft.ssh, host: best.ips[0] ?? "" } });
      })
      .catch(() => setVms([]));
  };
  useEffect(scan, []);
  const sorted = useMemo(() => [...(vms ?? [])].sort((a, b) => (a.duneConfidence === "high" ? -1 : b.duneConfidence === "high" ? 1 : 0)), [vms]);
  return (
    <>
      <H title="Connect to the battlegroup VM" sub="Monitoring and control go over SSH as the dune user, using the key battlegroup.bat generated." />
      <div className="space-y-5">
        <div>
          <div className="mb-2 flex items-center justify-between">
            <div className="text-[12px] font-medium text-sand-300">Hyper-V virtual machines</div>
            <Button size="sm" variant="ghost" icon={RefreshCw} onClick={scan}>
              Scan
            </Button>
          </div>
          <div className="space-y-1.5">
            {vms == null && <Loader2 className="size-5 animate-spin text-sand-400" />}
            {vms?.length === 0 && <div className="rounded-xl bg-black/20 px-4 py-3 text-[12.5px] text-sand-400">No VMs visible. Run the app as Administrator, or enter the IP manually for a remote VM.</div>}
            {sorted.map((v) => (
              <button
                key={v.name}
                onClick={() => patch({ vmName: v.name, ssh: { ...draft.ssh, host: v.ips[0] ?? draft.ssh.host } })}
                className={cx("flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left", draft.vmName === v.name ? "border-[var(--accent)]/60 bg-[var(--accent-soft)]" : "border-white/[0.07] bg-black/20 hover:border-white/[0.15]")}
              >
                <Monitor className="size-4.5 text-sand-400" />
                <span className="flex-1 text-[13px] font-medium">{v.name}</span>
                {v.duneConfidence === "high" && <Badge color="#f08a24">Dune VM</Badge>}
                <Badge color={v.state === "Running" ? "#34d399" : "#8b7d70"}>{v.state}</Badge>
                <span className="font-mono text-[12px] text-sand-400">{v.ips[0] ?? "no IP"}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_100px_120px] gap-3">
          <Field label="VM IP / hostname">
            <Input mono value={draft.ssh.host} onChange={(e) => patch({ ssh: { ...draft.ssh, host: e.target.value.trim() } })} placeholder="192.168.1.60" />
          </Field>
          <Field label="SSH port">
            <Input mono type="number" value={draft.ssh.port ?? 22} onChange={(e) => patch({ ssh: { ...draft.ssh, port: Number(e.target.value) || 22 } })} />
          </Field>
          <Field label="User">
            <Input mono value={draft.ssh.user} onChange={(e) => patch({ ssh: { ...draft.ssh, user: e.target.value.trim() } })} />
          </Field>
        </div>
        <Field label="SSH private key">
          <KeyPicker value={draft.ssh.keyPath ?? ""} onChange={(v) => patch({ ssh: { ...draft.ssh, keyPath: v } })} searchDirs={[draft.installDir, draft.batPath.replace(/\\[^\\]+$/, "")]} name={draft.name} />
        </Field>
        <div className="flex items-center gap-3">
          <Button
            icon={Link2}
            loading={testing}
            disabled={!draft.ssh.host}
            onClick={async () => {
              setTesting(true);
              try {
                setTest({ ok: true, text: await api.sshTest({ ...draft, mode: "real" }) });
              } catch (e) {
                setTest({ ok: false, text: String(e) });
              } finally {
                setTesting(false);
              }
            }}
          >
            Test connection
          </Button>
          <span className="text-[12px] text-sand-500">Optional. You can finish now and fix this later under Instance.</span>
        </div>
        {test && (
          <Callout kind={test.ok ? "success" : "error"} icon={test.ok ? CheckCircle2 : XCircle}>
            <pre className="font-mono text-[12px] whitespace-pre-wrap">{test.text}</pre>
          </Callout>
        )}
      </div>
    </>
  );
}

function FinishStep({ draft, source }: { draft: Instance; source: Source }) {
  const folder = useStore((s) => s.folders.find((f) => f.id === draft.folderId));
  const rows: [string, string][] = [
    ["Name", draft.name],
    ["Folder", folder?.name ?? "Ungrouped"],
    ["Branch", `${draft.branch.toUpperCase()} (${draft.appId})`],
  ];
  if (source !== "demo") {
    rows.push(["Server files", draft.installDir || "—"], ["battlegroup.bat", draft.batPath || "—"], ["VM", draft.vmName || "—"], ["SSH", `${draft.ssh.user}@${draft.ssh.host || "?"}:${draft.ssh.port ?? 22}`], ["Key", draft.ssh.keyPath || "—"]);
  }
  return (
    <>
      <H title="Ready for launch" sub={source === "demo" ? "A simulated battlegroup with live-looking telemetry, logs, backups and automation." : "Sensible defaults: crash alerts, watchdog, 6-hourly backups (20 kept) and 30-minute update checks. Tune them under Automation."} />
      <div className="divide-y divide-white/[0.05] rounded-2xl border border-white/[0.06] bg-black/20">
        {rows.map(([k, v]) => (
          <div key={k} className="flex gap-4 px-4 py-2.5 text-[13px]">
            <span className="w-32 shrink-0 text-sand-500">{k}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-sand-100">{v}</span>
          </div>
        ))}
      </div>
    </>
  );
}
