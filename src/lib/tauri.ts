import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri) return Promise.reject(new Error(`Native command "${cmd}" is only available in the desktop app`));
  return tauriInvoke<T>(cmd, args);
}

type LineFn = (line: string, err: boolean) => void;
type ExitFn = (code: number) => void;
interface Sub {
  line: LineFn;
  exit: ExitFn;
}

/** Single global dispatcher for `proc://line` / `proc://exit` events, fanned out per stream id. */
const subs = new Map<string, Sub>();
const early = new Map<string, { lines: [string, boolean][]; code?: number }>();
let wired = false;

// Events for streams nobody is listening to (e.g. already cancelled) are buffered briefly, bounded.
function remember(id: string): { lines: [string, boolean][]; code?: number } {
  let e = early.get(id);
  if (!e) {
    if (early.size >= 32) early.delete(early.keys().next().value!);
    e = { lines: [] };
    early.set(id, e);
  }
  return e;
}

function deliverLine(id: string, line: string, err: boolean) {
  const s = subs.get(id);
  if (s) s.line(line, err);
  else {
    const e = remember(id);
    if (e.lines.length < 500) e.lines.push([line, err]);
  }
}
function deliverExit(id: string, code: number) {
  const s = subs.get(id);
  if (s) {
    subs.delete(id);
    s.exit(code);
  } else {
    remember(id).code = code;
  }
}

export async function wireProcEvents() {
  if (wired || !isTauri) return;
  wired = true;
  await listen<{ id: string; line: string; err: boolean }>("proc://line", (e) => deliverLine(e.payload.id, e.payload.line, e.payload.err));
  await listen<{ id: string; code: number }>("proc://exit", (e) => deliverExit(e.payload.id, e.payload.code));
}

/** Local (simulated) streams use the same bus. */
export const localBus = { line: deliverLine, exit: deliverExit };

export function onStream(id: string, line: LineFn, exit: ExitFn): () => void {
  subs.set(id, { line, exit });
  const e = early.get(id);
  if (e) {
    early.delete(id);
    e.lines.forEach(([l, er]) => line(l, er));
    if (e.code !== undefined) {
      subs.delete(id);
      exit(e.code);
    }
  }
  return () => subs.delete(id);
}

export function streamId(prefix = "s") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Run a stream to completion, collecting output. */
export function collectStream(start: (id: string) => Promise<void>, onLine?: LineFn): Promise<{ code: number; output: string[] }> {
  const id = streamId();
  const output: string[] = [];
  return new Promise((resolve, reject) => {
    onStream(
      id,
      (l, err) => {
        output.push(l);
        onLine?.(l, err);
      },
      (code) => resolve({ code, output }),
    );
    start(id).catch((e) => {
      subs.delete(id);
      reject(e);
    });
  });
}

export { listen };
