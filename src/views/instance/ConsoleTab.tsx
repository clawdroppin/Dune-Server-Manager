import { CornerDownLeft, Eraser, Info, Square, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useStore } from "../../lib/store";
import { pickBattlegroup } from "../../lib/health";
import * as api from "../../lib/api";
import { onStream, streamId } from "../../lib/tauri";
import { Badge, Button, Card, cx, IconButton, Segmented } from "../../components/ui";
import type { Instance } from "../../lib/types";

type Mode = "shell" | "kubectl" | "battlegroup";
interface Line {
  t: string;
  kind: "cmd" | "out" | "err" | "sys";
}

const QUICK: Record<Mode, string[]> = {
  shell: ["uptime", "free -m", "df -h /", "top -b -n1 | head -20", "cat /home/dune/.dune/settings.conf", "ls -la /home/dune/.dune/backups 2>/dev/null"],
  kubectl: ["get pods -A", "get battlegroups -A", "get serverstats -A", "top pods -A", "get events -A --sort-by=.lastTimestamp | tail -30", "get svc -A"],
  battlegroup: ["status", "start", "stop", "restart", "apply-default-usersettings", "logs-export"],
};

const KPRE = "K='sudo -n kubectl'; $K version --client >/dev/null 2>&1 || K='kubectl'\n";
const histories: Record<string, string[]> = {};

export function ConsoleTab({ inst }: { inst: Instance }) {
  const tel = useStore((s) => s.telemetry[inst.id]);
  const bg = pickBattlegroup(inst, tel);
  const [mode, setMode] = useState<Mode>("shell");
  const [input, setInput] = useState("");
  const [lines, setLines] = useState<Line[]>([
    { t: `Connected target: ${inst.ssh.user}@${inst.ssh.host || "?"}  (non-interactive SSH; each command runs in a fresh shell)`, kind: "sys" },
  ]);
  const [running, setRunning] = useState<string | null>(null);
  const hist = (histories[inst.id] ??= []);
  const [hIdx, setHIdx] = useState(-1);
  const box = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef<Line[]>([]);

  useEffect(() => {
    const t = setInterval(() => {
      if (!pending.current.length) return;
      const add = pending.current;
      pending.current = [];
      setLines((l) => [...l, ...add].slice(-4000));
    }, 60);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [lines]);

  const run = async (raw: string) => {
    const cmd = raw.trim();
    if (!cmd || running) return;
    if (cmd === "clear" || cmd === "cls") return setLines([]);
    hist.push(cmd);
    setHIdx(-1);
    setInput("");
    const prompt = mode === "shell" ? "$" : mode === "kubectl" ? "kubectl" : "battlegroup";
    pending.current.push({ t: `${prompt} ${cmd}`, kind: "cmd" });
    const id = streamId("con");
    setRunning(id);
    const started = Date.now();
    onStream(
      id,
      (l, err) => pending.current.push({ t: l, kind: err ? "err" : "out" }),
      (code) => {
        pending.current.push({ t: `exit ${code} · ${((Date.now() - started) / 1000).toFixed(1)}s`, kind: "sys" });
        setRunning(null);
        setTimeout(() => inputRef.current?.focus(), 50);
      },
    );
    try {
      if (mode === "battlegroup") {
        const args = cmd.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, "")) ?? [];
        await api.wrapperStream(inst, bg?.namespace || inst.namespace, args, id);
      } else if (mode === "kubectl") {
        await api.shellStream(inst, `${KPRE}$K ${cmd}\n`, id);
      } else {
        await api.shellStream(inst, cmd + "\n", id);
      }
    } catch (e) {
      pending.current.push({ t: String(e), kind: "err" });
      setRunning(null);
    }
  };

  return (
    <Card className="flex h-[calc(100vh-290px)] min-h-[460px] flex-col overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b hairline px-4 py-3">
        <SquareTerminal className="size-4 text-[var(--accent)]" />
        <Segmented
          value={mode}
          onChange={setMode}
          options={[
            { value: "shell", label: "VM shell" },
            { value: "kubectl", label: "kubectl" },
            { value: "battlegroup", label: "battlegroup CLI" },
          ]}
        />
        <div className="flex flex-wrap gap-1.5 pl-2">
          {QUICK[mode].map((q) => (
            <button key={q} onClick={() => run(q)} disabled={!!running} className="rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-0.5 font-mono text-[11px] text-sand-300 hover:border-[var(--accent)]/40 hover:text-sand-50 disabled:opacity-40">
              {q.length > 28 ? q.slice(0, 26) + "…" : q}
            </button>
          ))}
        </div>
        <div className="flex-1" />
        {running && <Badge color="#60a5fa">running</Badge>}
        <IconButton icon={Eraser} label="Clear" onClick={() => setLines([])} />
      </div>
      <div ref={box} onClick={() => inputRef.current?.focus()} className="min-h-0 flex-1 overflow-auto bg-black/45 px-4 py-3 font-mono text-[12px] leading-[1.6] selectable">
        {lines.map((l, i) => (
          <div
            key={i}
            className={cx(
              "break-all whitespace-pre-wrap",
              l.kind === "cmd" && "mt-2 text-[var(--accent-2)]",
              l.kind === "err" && "text-[#ff9e9b]",
              l.kind === "sys" && "text-[11px] text-sand-500 italic",
              l.kind === "out" && "text-sand-200",
            )}
          >
            {l.t}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2 border-t hairline bg-black/30 px-4 py-2.5">
        <span className="font-mono text-[12.5px] text-[var(--accent)]">{mode === "shell" ? "$" : mode === "kubectl" ? "kubectl" : "battlegroup"}</span>
        <input
          ref={inputRef}
          autoFocus
          value={input}
          disabled={!!running}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") run(input);
            else if (e.key === "ArrowUp") {
              e.preventDefault();
              const i = hIdx < 0 ? hist.length - 1 : Math.max(0, hIdx - 1);
              if (hist[i] != null) {
                setHIdx(i);
                setInput(hist[i]);
              }
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              const i = hIdx + 1;
              if (hIdx >= 0 && i < hist.length) {
                setHIdx(i);
                setInput(hist[i]);
              } else {
                setHIdx(-1);
                setInput("");
              }
            }
          }}
          placeholder={running ? "Running… (Stop to cancel)" : mode === "battlegroup" ? "status | update | backup <name> | import <name> …" : "Type a command and press Enter"}
          spellCheck={false}
          className="flex-1 bg-transparent font-mono text-[12.5px] text-sand-50 placeholder:text-sand-600 outline-none"
        />
        {running ? (
          <Button size="sm" variant="danger" icon={Square} onClick={() => api.killStream(running)}>
            Stop
          </Button>
        ) : (
          <Button size="sm" variant="ghost" icon={CornerDownLeft} onClick={() => run(input)}>
            Run
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2 border-t hairline px-4 py-1.5 text-[11px] text-sand-500">
        <Info className="size-3" /> The battlegroup CLI is Funcom’s <span className="font-mono">~/.dune/bin/battlegroup</span>. Battlegroup selection and confirmation prompts are answered automatically.
      </div>
    </Card>
  );
}
