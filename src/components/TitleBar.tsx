import { requestClose } from "../lib/close";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bell, Copy, ListChecks, Minus, Search, ShieldAlert, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { isTauri, invoke } from "../lib/tauri";
import { useStore } from "../lib/store";
import { useJobs } from "../lib/jobs";
import { Kbd, cx } from "./ui";

export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" aria-hidden>
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--accent-2)" />
          <stop offset="0.6" stopColor="var(--accent)" />
          <stop offset="1" stopColor="#7a2e10" />
        </linearGradient>
      </defs>
      <rect width="512" height="512" rx="120" fill="#1a1411" />
      <circle cx="256" cy="200" r="88" fill="url(#lg)" />
      <path d="M40 400 C140 340 240 380 320 395 C390 408 440 385 472 365 L472 472 L40 472 Z" fill="url(#lg)" />
      <path d="M40 360 C150 300 230 330 300 350 C370 370 430 340 472 310 L472 400 L40 420 Z" fill="var(--accent)" opacity="0.28" />
    </svg>
  );
}

export function TitleBar({ elevated }: { elevated: boolean | null }) {
  const [max, setMax] = useState(false);
  const setPalette = useStore((s) => s.setPalette);
  const unread = useStore((s) => s.unread);
  const setActivityOpen = useStore((s) => s.setActivityOpen);
  const closeBehavior = useStore((s) => s.settings.closeBehavior);
  const running = useJobs((s) => s.jobs.filter((j) => j.status === "running").length);
  const setJobs = useJobs((s) => s.setOpen);

  useEffect(() => {
    if (!isTauri) return;
    const w = getCurrentWindow();
    w.isMaximized().then(setMax);
    const un = w.onResized(() => w.isMaximized().then(setMax));
    return () => {
      un.then((f) => f());
    };
  }, []);

  const win = isTauri ? getCurrentWindow() : null;

  return (
    <div className="drag relative z-30 flex h-11 shrink-0 items-center border-b hairline pl-4" onDoubleClick={() => win?.toggleMaximize()}>
      <div className="flex items-center gap-2.5">
        <Logo />
        <div className="font-display text-[13.5px] font-semibold tracking-tight text-sand-100">
          Dune <span className="accent-text">Server Manager</span>
        </div>
      </div>

      <div className="flex flex-1 justify-center px-6">
        <button
          onClick={() => setPalette(true)}
          className="no-drag flex h-7 w-full max-w-[420px] items-center gap-2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 text-[12.5px] text-sand-400 transition hover:border-white/[0.12] hover:text-sand-200"
        >
          <Search className="size-3.5" />
          <span className="flex-1 text-left">Search servers, actions, settings…</span>
          <Kbd>Ctrl K</Kbd>
        </button>
      </div>

      <div className="no-drag flex items-center gap-1 pr-1">
        {elevated === false && isTauri && (
          <button
            onClick={() => invoke("relaunch_elevated").catch(() => {})}
            title="Hyper-V control needs Administrator (or Hyper-V Administrators membership). Click to relaunch elevated."
            className="mr-1 flex h-7 items-center gap-1.5 rounded-lg border border-warn/25 bg-warn/10 px-2 text-[11.5px] font-medium text-warn hover:bg-warn/20"
          >
            <ShieldAlert className="size-3.5" /> Run as admin
          </button>
        )}
        <button onClick={() => setJobs(true)} className="relative grid size-8 place-items-center rounded-lg text-sand-400 hover:bg-white/[0.07] hover:text-sand-100" title="Operations">
          <ListChecks className="size-4" />
          {running > 0 && <span className="absolute top-1 right-1 grid size-3.5 place-items-center rounded-full bg-info text-[9px] font-bold text-black">{running}</span>}
        </button>
        <button onClick={() => setActivityOpen(true)} className="relative grid size-8 place-items-center rounded-lg text-sand-400 hover:bg-white/[0.07] hover:text-sand-100" title="Activity">
          <Bell className="size-4" />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-3.5 rounded-full bg-[var(--accent)] px-1 text-[9px] leading-[14px] font-bold text-black">{unread > 99 ? "99+" : unread}</span>}
        </button>
        {isTauri && (
          <div className="ml-2 flex items-center">
            <WinBtn onClick={() => win?.minimize()} label="Minimize">
              <Minus className="size-4" />
            </WinBtn>
            <WinBtn onClick={() => win?.toggleMaximize()} label={max ? "Restore" : "Maximize"}>
              {max ? <Copy className="size-3.5 -scale-x-100" /> : <Square className="size-3.5" />}
            </WinBtn>
            <WinBtn onClick={requestClose} label={closeBehavior === "quit" ? "Quit" : closeBehavior === "tray" ? "Close to tray" : "Close"} danger>
              <X className="size-4" />
            </WinBtn>
          </div>
        )}
      </div>
    </div>
  );
}

function WinBtn({ children, onClick, label, danger }: { children: React.ReactNode; onClick: () => void; label: string; danger?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} className={cx("grid h-11 w-11 place-items-center text-sand-300 transition-colors", danger ? "hover:bg-[#c42b1c] hover:text-white" : "hover:bg-white/[0.08]")}>
      {children}
    </button>
  );
}
