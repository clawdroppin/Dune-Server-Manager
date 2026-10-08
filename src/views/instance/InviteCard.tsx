import { ClipboardCopy, Eye, EyeOff, Send, UserPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import * as api from "../../lib/api";
import { getValue, parseIni, unquote } from "../../lib/ini";
import { useStore } from "../../lib/store";
import { Button, Card, CardHeader, IconButton, useCopy } from "../../components/ui";
import type { Instance } from "../../lib/types";

/** Builds a ready-to-paste invite from the live UserEngine.ini (name + join password). */
export function InviteCard({ inst }: { inst: Instance }) {
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const { copied, copy } = useCopy();
  // Select the stable array, derive afterwards (a fresh array from a selector would loop under zustand v5).
  const globalHooks = useStore((s) => s.settings.webhooks);
  const hooks = useMemo(() => [...inst.webhooks, ...globalHooks].filter((h) => h.enabled && h.url), [inst.webhooks, globalHooks]);

  useEffect(() => {
    const dir = inst.settingsDir || api.DEFAULT_SETTINGS_DIR;
    api
      .remoteRead(inst, `${dir}/UserEngine.ini`)
      .then((t) => {
        const lines = parseIni(t);
        const n = getValue(lines, "Bgd.ServerDisplayName");
        const p = getValue(lines, "Bgd.ServerLoginPassword");
        setName(n && !n.disabled ? unquote(n.value) : "");
        setPassword(p && !p.disabled ? unquote(p.value) : "");
      })
      .catch(() => {
        setName("");
        setPassword("");
      });
  }, [inst.id, inst.ssh.host]);

  const display = name || inst.name;
  const text = [
    `🏜️ Join **${display}** on Dune: Awakening`,
    `1. Launch the game → Play → Server browser → **Experimental** tab`,
    `2. Search for “${display}” and pick a Sietch`,
    password ? `3. Password: ||${password}||` : `3. No password needed`,
    inst.branch === "ptc" ? "⚠️ Requires the Public Test Client (PTC) build." : "Make sure your game is fully updated (server and client builds must match).",
  ].join("\n");

  return (
    <Card>
      <CardHeader icon={UserPlus} title="Invite players" subtitle="Copy-ready instructions built from your live server settings" />
      <div className="space-y-3 px-5 pb-5">
        <div className="grid grid-cols-2 gap-3 text-[12.5px]">
          <div className="rounded-xl bg-black/20 px-3 py-2">
            <div className="text-sand-500">Browser name</div>
            <div className="truncate text-sand-100">{name == null ? "…" : display}</div>
          </div>
          <div className="flex items-center rounded-xl bg-black/20 px-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="text-sand-500">Join password</div>
              <div className="truncate font-mono text-sand-100">{password == null ? "…" : password ? (reveal ? password : "••••••••") : "none (open)"}</div>
            </div>
            {password && <IconButton icon={reveal ? EyeOff : Eye} label={reveal ? "Hide" : "Show"} size="sm" onClick={() => setReveal(!reveal)} />}
          </div>
        </div>
        <div className="flex gap-2">
          <Button size="sm" icon={ClipboardCopy} onClick={() => copy(text, "invite")}>
            {copied === "invite" ? "Copied!" : "Copy invite"}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={Send}
            disabled={hooks.length === 0}
            onClick={async () => {
              const res = await Promise.allSettled(hooks.map((h) => api.webhookSend(h, `Join ${display}`, text.split("\n").slice(1).join("\n"), 0xf08a24)));
              const ok = res.filter((r) => r.status === "fulfilled").length;
              useStore.getState().toast({ kind: ok ? "success" : "error", title: `Invite posted to ${ok}/${hooks.length} webhooks` });
            }}
          >
            Post to Discord
          </Button>
        </div>
      </div>
    </Card>
  );
}
