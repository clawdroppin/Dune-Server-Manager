import { AnimatePresence, motion } from "motion/react";
import { AlertTriangle, Code2, Eye, EyeOff, FileCog, FileWarning, Loader2, RefreshCw, RotateCcw, Save, Search, SlidersHorizontal, Sparkles, Users2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useStore } from "../../lib/store";
import * as api from "../../lib/api";
import { restartInstance, wrapperAction } from "../../lib/actions";
import { CATEGORIES, FIELDS, FILES, humanize, PRESETS, type Category, type FieldDef } from "../../lib/settingsSchema";
import { diffLines, disableKey, entries, getArray, getValue, isBoolValue, isNumValue, parseIni, serializeIni, setArray, setValue, unquote, type IniLine } from "../../lib/ini";
import { Badge, Button, Callout, Card, cx, Empty, IconButton, Input, Modal, Segmented, Select, Slider, Textarea, Toggle } from "../../components/ui";
import type { Instance } from "../../lib/types";

interface FileState {
  path: string;
  original: string;
  lines: IniLine[];
  raw: string | null; // non-null while editing in raw mode
}

export function ConfigTab({ inst }: { inst: Instance }) {
  const dir = inst.settingsDir || api.DEFAULT_SETTINGS_DIR;
  const [files, setFiles] = useState<Record<string, FileState>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"visual" | "raw">("visual");
  const [cat, setCat] = useState<Category>("Server");
  const [rawFile, setRawFile] = useState<string>("UserEngine.ini");
  const [q, setQ] = useState("");
  const [review, setReview] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const ls = await api.remoteLs(inst, dir);
      const names = new Set<string>(ls.filter((f) => !f.dir && f.name.toLowerCase().endsWith(".ini")).map((f) => f.name));
      const out: Record<string, FileState> = {};
      for (const name of names) {
        const text = await api.remoteRead(inst, `${dir}/${name}`);
        out[name] = { path: `${dir}/${name}`, original: text, lines: parseIni(text), raw: null };
      }
      setFiles(out);
      if (!out[rawFile]) setRawFile(Object.keys(out)[0] ?? "UserEngine.ini");
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [inst.id, dir]);

  useEffect(() => {
    load();
  }, [load]);

  const contentOf = (f: FileState) => (f.raw != null ? f.raw : serializeIni(f.lines));
  const norm = (s: string) => s.replace(/\r\n/g, "\n").trimEnd();
  const dirty = Object.entries(files).filter(([, f]) => norm(contentOf(f)) !== norm(f.original));

  const mutate = (file: string, fn: (l: IniLine[]) => IniLine[]) =>
    setFiles((fs) => {
      const f = fs[file] ?? { path: `${dir}/${file}`, original: "", lines: [], raw: null };
      const base = f.raw != null ? parseIni(f.raw) : f.lines;
      return { ...fs, [file]: { ...f, lines: fn(base), raw: null } };
    });

  const resolveSection = (def: FieldDef): string | null => {
    const f = files[def.file];
    if (def.section) return def.section;
    return (f && getValue(f.lines, def.key)?.section) || def.fallbackSection || null;
  };

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id)!;
    let applied = 0;
    for (const [key, val] of Object.entries(p.values)) {
      const def = FIELDS.find((d) => d.key === key);
      if (!def || !files[def.file]) continue;
      const sec = resolveSection(def);
      if (!sec) continue;
      mutate(def.file, (l) => setValue(l, sec, key, def.quote ? `"${val}"` : val));
      applied++;
    }
    useStore.getState().toast({ kind: "info", title: `Preset “${p.name}” staged`, body: `${applied} values changed. Review and save to apply.` });
  };

  const save = async () => {
    setSaving(true);
    try {
      for (const [, f] of dirty) await api.remoteWrite(inst, f.path, contentOf(f));
      useStore.getState().log({ instanceId: inst.id, level: "info", kind: "config", message: `Saved ${dirty.map(([n]) => n).join(", ")}` });
      setReview(false);
      setSavedAt(Date.now());
      await load();
    } catch (e) {
      useStore.getState().toast({ kind: "error", title: "Save failed", body: String(e) });
    } finally {
      setSaving(false);
    }
  };

  const curatedKeys = useMemo(() => new Set(FIELDS.map((f) => `${f.file}|${f.key}`)), []);
  const discovered = useMemo(
    () =>
      Object.entries(files).flatMap(([file, f]) =>
        entries(f.lines)
          .filter((e) => !curatedKeys.has(`${file}|${e.key}`))
          .map((e) => ({ file, ...e })),
      ),
    [files, curatedKeys],
  );

  const ql = q.toLowerCase();
  const fieldsIn = (c: Category) => FIELDS.filter((f) => f.category === c && (!ql || f.label.toLowerCase().includes(ql) || f.key.toLowerCase().includes(ql)));
  const discoveredShown = discovered.filter((d) => !ql || d.key.toLowerCase().includes(ql) || humanize(d.key).toLowerCase().includes(ql));

  if (loading && Object.keys(files).length === 0)
    return (
      <Card className="grid h-64 place-items-center">
        <Loader2 className="size-6 animate-spin text-sand-400" />
      </Card>
    );

  if (error)
    return (
      <Card>
        <Empty icon={FileWarning} title="Couldn't read UserSettings" body={<span className="font-mono text-[12px]">{error}</span>} action={<Button icon={RefreshCw} onClick={load}>Retry</Button>} />
      </Card>
    );

  return (
    <div className="space-y-4 pb-20">
      <div className="flex flex-wrap items-center gap-3">
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "visual", label: "Visual editor", icon: SlidersHorizontal },
            { value: "raw", label: "Raw INI", icon: Code2 },
          ]}
        />
        {mode === "visual" && <Input icon={Search} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings" className="w-64" />}
        <div className="flex-1" />
        <span className="font-mono text-[11.5px] text-sand-500">{dir}</span>
        <IconButton icon={RefreshCw} label="Reload from server" onClick={load} />
      </div>

      {Object.keys(files).length === 0 && (
        <Callout kind="warn" icon={AlertTriangle} title="No INI files found in UserSettings">
          The folder is empty or the path is wrong. Fix the path under Instance → Paths. Funcom ships prefilled templates there after initial-setup.
        </Callout>
      )}

      {mode === "visual" ? (
        <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
          <div className="space-y-4">
            <Card className="p-2">
              {CATEGORIES.map((c) => {
                const n = c.id === "Advanced" ? discoveredShown.length + fieldsIn("Advanced").length : fieldsIn(c.id).length;
                return (
                  <button
                    key={c.id}
                    onClick={() => setCat(c.id)}
                    className={cx("flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left transition-colors", cat === c.id ? "bg-[var(--accent-soft)] text-sand-50" : "text-sand-300 hover:bg-white/[0.04]")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium">{c.id}</div>
                      <div className="truncate text-[11px] text-sand-500">{c.blurb}</div>
                    </div>
                    <span className="text-[11px] text-sand-500 tabular-nums">{n}</span>
                  </button>
                );
              })}
            </Card>
            <Card className="p-3">
              <div className="mb-2 flex items-center gap-1.5 px-1 text-[11px] font-semibold tracking-wider text-sand-500 uppercase">
                <Sparkles className="size-3.5 text-[var(--accent)]" /> Presets
              </div>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => applyPreset(p.id)} className="block w-full rounded-lg px-2.5 py-1.5 text-left hover:bg-white/[0.05]">
                  <div className="text-[12.5px] font-medium text-sand-100">{p.name}</div>
                  <div className="text-[11px] text-sand-500">{p.blurb}</div>
                </button>
              ))}
            </Card>
          </div>

          <Card className="p-5">
            <div className="mb-1 font-display text-[17px] font-semibold">{cat}</div>
            <div className="mb-4 text-[12.5px] text-sand-400">{CATEGORIES.find((c) => c.id === cat)?.blurb}. Changes apply to every game server after a restart.</div>
            <div className="divide-y divide-white/[0.05]">
              {fieldsIn(cat).map((def) => (
                <CuratedField key={def.file + def.key} def={def} file={files[def.file]} section={resolveSection(def)} mutate={mutate} />
              ))}
              {cat === "Advanced" &&
                discoveredShown.map((d) => (
                  <AutoField
                    key={`${d.file}|${d.section}|${d.key}`}
                    file={d.file}
                    section={d.section}
                    k={d.key}
                    value={d.value}
                    disabled={d.disabled}
                    array={d.array}
                    lines={files[d.file].lines}
                    mutate={mutate}
                  />
                ))}
              {fieldsIn(cat).length === 0 && !(cat === "Advanced" && discoveredShown.length) && <div className="py-10 text-center text-[13px] text-sand-500">Nothing here{q && " matches your search"}.</div>}
            </div>
          </Card>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex items-center gap-1 border-b hairline px-3 pt-2">
            {(Object.keys(files).length ? Object.keys(files) : [...FILES]).map((n) => (
              <button key={n} onClick={() => setRawFile(n)} className={cx("rounded-t-lg px-3 py-2 font-mono text-[12px]", rawFile === n ? "bg-white/[0.07] text-sand-50" : "text-sand-400 hover:text-sand-200")}>
                {n}
                {dirty.some(([d]) => d === n) && <span className="ml-1.5 text-[var(--accent)]">●</span>}
              </button>
            ))}
          </div>
          <Textarea
            mono
            spellCheck={false}
            value={files[rawFile] ? contentOf(files[rawFile]).replace(/\r\n/g, "\n") : ""}
            onChange={(e) => {
              const v = e.target.value;
              setFiles((fs) => ({ ...fs, [rawFile]: { ...(fs[rawFile] ?? { path: `${dir}/${rawFile}`, original: "", lines: [] }), raw: v } }));
            }}
            className="min-h-[540px] rounded-none border-0 bg-black/40 text-[12.5px] focus:ring-0"
          />
        </Card>
      )}

      <AnimatePresence>
        {(dirty.length > 0 || savedAt) && (
          <motion.div initial={{ y: 80, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 80, opacity: 0 }} className="fixed right-8 bottom-6 left-[300px] z-30 flex justify-center">
            <div className="glass-strong flex items-center gap-3 rounded-2xl px-4 py-3">
              {dirty.length > 0 ? (
                <>
                  <FileCog className="size-4 text-[var(--accent)]" />
                  <span className="text-[13px]">
                    {dirty.length} file{dirty.length > 1 ? "s" : ""} modified: <span className="font-mono text-[12px] text-sand-400">{dirty.map(([n]) => n).join(", ")}</span>
                  </span>
                  <Button size="sm" variant="ghost" icon={RotateCcw} onClick={load}>
                    Discard
                  </Button>
                  <Button size="sm" variant="primary" icon={Save} onClick={() => setReview(true)}>
                    Review & save
                  </Button>
                </>
              ) : (
                <>
                  <span className="text-[13px] text-ok">Saved. A timestamped .bak copy was kept on the server.</span>
                  <Button size="sm" onClick={() => wrapperAction(inst, ["apply-default-usersettings"], "Apply user settings")}>
                    Push to file broker
                  </Button>
                  <Button size="sm" variant="primary" onClick={() => restartInstance(inst).then(() => setSavedAt(null))}>
                    Restart to apply
                  </Button>
                  <IconButton icon={EyeOff} label="Dismiss" size="sm" onClick={() => setSavedAt(null)} />
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal open={review} onClose={() => setReview(false)} width={980}>
        <div className="flex max-h-[86vh] flex-col p-6">
          <div className="font-display text-lg font-semibold">Review changes</div>
          <div className="mb-4 text-[12.5px] text-sand-400">Each file is backed up as <span className="font-mono">*.dsm-&lt;timestamp&gt;.bak</span> next to the original before writing.</div>
          <div className="min-h-0 flex-1 space-y-4 overflow-auto">
            {dirty.map(([name, f]) => (
              <div key={name}>
                <div className="mb-1.5 font-mono text-[12px] text-sand-300">{name}</div>
                <div className="rounded-xl bg-black/45 p-3 font-mono text-[11.5px] leading-relaxed">
                  {diffLines(f.original, contentOf(f))
                    .filter((d, i, arr) => d.type !== "same" || arr.slice(Math.max(0, i - 2), i + 3).some((x) => x.type !== "same"))
                    .map((d, i) => (
                      <div key={i} className={cx("whitespace-pre-wrap", d.type === "add" && "bg-ok/10 text-ok", d.type === "del" && "bg-bad/10 text-[#ff9e9b] line-through decoration-bad/40", d.type === "same" && "text-sand-500")}>
                        {d.type === "add" ? "+ " : d.type === "del" ? "- " : "  "}
                        {d.text}
                      </div>
                    ))}
                </div>
              </div>
            ))}
          </div>
          <Callout kind="info" icon={Users2} className="mt-4">
            Stop the battlegroup before editing if you can. Settings apply on the next restart. Keys marked <b>client must match</b> also have to be set on every player’s client.
          </Callout>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setReview(false)}>
              Cancel
            </Button>
            <Button variant="primary" icon={Save} loading={saving} onClick={save}>
              Write {dirty.length} file{dirty.length > 1 ? "s" : ""}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

function FieldShell({ label, k, file, section, badges, isDefault, onReset, children, description }: { label: string; k: string; file: string; section: string | null; badges?: React.ReactNode; isDefault: boolean; onReset?: () => void; children: React.ReactNode; description?: string }) {
  return (
    <div className="grid gap-3 py-4 md:grid-cols-[1fr_minmax(260px,340px)]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[13.5px] font-medium text-sand-50">{label}</span>
          {!isDefault && <Badge color="#f08a24">custom</Badge>}
          {badges}
        </div>
        {description && <div className="mt-1 text-[12px] leading-snug text-sand-400">{description}</div>}
        <div className="mt-1 truncate font-mono text-[10.5px] text-sand-600" title={`${file} [${section ?? "?"}] ${k}`}>
          {file} · [{section ?? "not in file"}] · {k}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {onReset && !isDefault && <IconButton icon={RotateCcw} label="Comment out (use game default)" size="sm" onClick={onReset} />}
      </div>
    </div>
  );
}

function CuratedField({ def, file, section, mutate }: { def: FieldDef; file?: FileState; section: string | null; mutate: (file: string, fn: (l: IniLine[]) => IniLine[]) => void }) {
  const [reveal, setReveal] = useState(false);
  const lines = file ? (file.raw != null ? parseIni(file.raw) : file.lines) : [];
  const cur = section ? getValue(lines, def.key, section) : null;
  const active = !!cur && !cur.disabled;
  const raw = active ? cur!.value : cur?.value ?? def.default;
  const val = def.quote ? unquote(raw) : raw;
  const set = (v: string) => section && mutate(def.file, (l) => setValue(l, section, def.key, def.quote ? `"${v.replace(/"/g, "")}"` : v));
  const reset = () => section && mutate(def.file, (l) => disableKey(l, section, def.key));
  const badges = (
    <>
      {!def.verified && <Badge color="#9b7bf0">community-sourced</Badge>}
      {def.clientSide && <Badge color="#60a5fa">client must match</Badge>}
      {def.danger && <Badge color="#ef5350">destructive</Badge>}
    </>
  );

  if (!section)
    return (
      <FieldShell label={def.label} k={def.key} file={def.file} section={null} isDefault description={def.description} badges={badges}>
        <div className="text-[12px] text-sand-500 italic">Key not in file. Add it in Raw mode under the right section.</div>
      </FieldShell>
    );

  let control: React.ReactNode;
  switch (def.type) {
    case "bool":
      control = <Toggle checked={/^true$/i.test(val)} onChange={(v) => set(v ? "True" : "False")} />;
      break;
    case "boolLower":
      control = <Toggle checked={/^true$/i.test(val)} onChange={(v) => set(v ? "true" : "false")} />;
      break;
    case "bool01":
      control = <Toggle checked={val.trim() === "1"} onChange={(v) => set(v ? "1" : "0")} />;
      break;
    case "number":
    case "int":
      control =
        def.max != null && def.max - (def.min ?? 0) <= 200 ? (
          <Slider value={Number(val) || 0} min={def.min ?? 0} max={def.max} step={def.step ?? 1} onChange={(v) => set(def.type === "int" ? String(Math.round(v)) : v.toFixed(def.step && def.step < 1 ? 1 : 0))} />
        ) : (
          <Input type="number" mono value={val} min={def.min} max={def.max} onChange={(e) => set(e.target.value)} />
        );
      break;
    case "enum":
      control = <Select value={val} onChange={set} options={(def.options ?? []).map((o) => ({ value: o, label: o }))} />;
      break;
    case "secret":
      control = (
        <div className="flex gap-1.5">
          <Input type={reveal ? "text" : "password"} mono value={active ? val : ""} placeholder={active ? "" : def.key === "Bgd.ServerLoginPassword" ? "No password (open server)" : `Default: ${def.default}`} onChange={(e) => (e.target.value ? set(e.target.value) : reset())} className="flex-1" />
          <IconButton icon={reveal ? EyeOff : Eye} label={reveal ? "Hide" : "Show"} onClick={() => setReveal(!reveal)} />
        </div>
      );
      break;
    case "list": {
      const arr = getArray(lines, section, def.key);
      control = (
        <Input
          mono
          placeholder="Comma separated"
          defaultValue={arr.join(", ")}
          key={arr.join(",")}
          onBlur={(e) =>
            mutate(def.file, (l) =>
              setArray(
                l,
                section,
                def.key,
                e.target.value
                  .split(",")
                  .map((x) => x.trim())
                  .filter((x) => /^[A-Za-z0-9_.]+$/.test(x)),
              ),
            )
          }
        />
      );
      break;
    }
    case "partitions": {
      const arr = getArray(lines, section, def.key);
      control = (
        <Input
          mono
          placeholder="e.g. 3, 4"
          defaultValue={arr.join(", ")}
          key={arr.join(",")}
          onBlur={(e) =>
            mutate(def.file, (l) =>
              setArray(
                l,
                section,
                def.key,
                e.target.value
                  .split(/[,\s]+/)
                  .map((x) => x.trim())
                  .filter((x) => /^\d+$/.test(x)),
              ),
            )
          }
        />
      );
      break;
    }
    default:
      control = <Input value={val} onChange={(e) => set(e.target.value)} />;
  }
  return (
    <FieldShell label={def.label} k={def.key} file={def.file} section={section} isDefault={def.type === "partitions" || def.type === "list" ? getArray(lines, section, def.key).length === 0 : !active} onReset={def.type === "partitions" || def.type === "list" ? undefined : reset} description={def.description} badges={badges}>
      {control}
    </FieldShell>
  );
}

function AutoField({ file, section, k, value, disabled, array, lines, mutate }: { file: string; section: string; k: string; value: string; disabled: boolean; array: boolean; lines: IniLine[]; mutate: (file: string, fn: (l: IniLine[]) => IniLine[]) => void }) {
  const set = (v: string) => mutate(file, (l) => setValue(l, section, k, v));
  let control: React.ReactNode;
  if (array) {
    const arr = getArray(lines, section, k);
    control = <Input mono defaultValue={arr.join(", ")} key={arr.join("|")} onBlur={(e) => mutate(file, (l) => setArray(l, section, k, e.target.value.split(",").map((x) => x.trim()).filter(Boolean)))} />;
  } else if (isBoolValue(value)) control = <Toggle checked={/^true$/i.test(value) && !disabled} onChange={(v) => set(v ? "True" : "False")} />;
  else if (isNumValue(value)) control = <Input type="number" mono value={value} onChange={(e) => set(e.target.value)} />;
  else control = <Input mono value={value} onChange={(e) => set(e.target.value)} />;
  return (
    <FieldShell label={humanize(k)} k={k} file={file} section={section} isDefault={disabled} onReset={() => mutate(file, (l) => disableKey(l, section, k))} badges={disabled ? <Badge>commented out</Badge> : undefined}>
      {control}
    </FieldShell>
  );
}
