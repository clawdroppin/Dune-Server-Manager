import { useState } from "react";
import { MonitorDown, Power } from "lucide-react";
import { hideToTray, quitApp, useCloseDialog } from "../lib/close";
import { useStore } from "../lib/store";
import { cx, Modal } from "./ui";

export function CloseDialog() {
  const { open, setOpen } = useCloseDialog();
  const [remember, setRemember] = useState(false);
  const automationOn = useStore((s) => s.instances.some((i) => i.mode === "real"));

  const choose = (choice: "tray" | "quit") => {
    setOpen(false);
    if (remember) useStore.getState().updateSettings({ closeBehavior: choice });
    if (choice === "tray") hideToTray();
    else quitApp();
  };

  const Option = ({ id, icon: Icon, title, body, primary }: { id: "tray" | "quit"; icon: React.ElementType; title: string; body: string; primary?: boolean }) => (
    <button
      onClick={() => choose(id)}
      autoFocus={primary}
      className={cx(
        "flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]/60",
        primary ? "border-[var(--accent)]/50 bg-[var(--accent-soft)] hover:brightness-110" : "border-white/[0.08] bg-black/20 hover:border-white/[0.16]",
      )}
    >
      <Icon className={cx("mt-0.5 size-5 shrink-0", primary ? "text-[var(--accent-2)]" : "text-sand-400")} />
      <div>
        <div className="text-[14px] font-semibold text-sand-50">{title}</div>
        <div className="mt-0.5 text-[12.5px] leading-snug text-sand-400">{body}</div>
      </div>
    </button>
  );

  return (
    <Modal open={open} onClose={() => setOpen(false)} width={460}>
      <div className="p-6">
        <div className="font-display text-lg font-semibold">Close Dune Server Manager?</div>
        <div className="mt-1 text-[13px] text-sand-400">Your battlegroups keep running either way. They live in the Hyper-V VM, not in this app.</div>
        <div className="mt-5 space-y-2.5">
          <Option
            id="tray"
            icon={MonitorDown}
            primary
            title="Minimize to tray"
            body={`Keeps ${automationOn ? "crash alerts, scheduled restarts, backups and update checks" : "automation"} running in the background. Right-click the tray icon to quit later.`}
          />
          <Option id="quit" icon={Power} title="Quit completely" body="Closes the app and stops all automation until you open it again." />
        </div>
        <label className="mt-5 flex cursor-pointer items-center gap-2.5 text-[12.5px] text-sand-300">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="size-4 accent-[var(--accent)]" />
          Remember my choice (change it later in Settings → General)
        </label>
      </div>
    </Modal>
  );
}
