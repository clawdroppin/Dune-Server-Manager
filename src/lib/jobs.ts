import { create } from "zustand";
import { useStore } from "./store";
const useStoreBusy = (id: string) => useStore((s) => s.busy.includes(id));
import { onStream } from "./tauri";
import { uid } from "./format";

export interface Job {
  id: string;
  instanceId: string | null;
  title: string;
  status: "running" | "ok" | "error" | "cancelled";
  lines: { t: string; err: boolean }[];
  progress: number | null;
  started: number;
  ended: number | null;
  streamId: string | null;
}

interface JobState {
  jobs: Job[];
  open: boolean;
  focus: string | null;
  setOpen: (o: boolean, focus?: string | null) => void;
  clearFinished: () => void;
}

export const useJobs = create<JobState>((set) => ({
  jobs: [],
  open: false,
  focus: null,
  setOpen: (open, focus = null) => set({ open, focus }),
  clearFinished: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === "running") })),
}));

const MAX_LINES = 3000;
const PROGRESS_RE = /progress:\s*([\d.]+)/i;

function patch(id: string, p: Partial<Job> | ((j: Job) => Partial<Job>)) {
  useJobs.setState((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...(typeof p === "function" ? p(j) : p) } : j)) }));
}

// Line batching keeps React renders bounded even for chatty streams (SteamCMD, kubectl logs).
const pending = new Map<string, { t: string; err: boolean }[]>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function queueLine(jobId: string, t: string, err: boolean) {
  const arr = pending.get(jobId) ?? [];
  arr.push({ t, err });
  pending.set(jobId, arr);
  if (!flushTimer)
    flushTimer = setTimeout(() => {
      flushTimer = null;
      const batch = new Map(pending);
      pending.clear();
      useJobs.setState((s) => ({
        jobs: s.jobs.map((j) => {
          const add = batch.get(j.id);
          if (!add) return j;
          let progress = j.progress;
          for (const l of add) {
            const m = PROGRESS_RE.exec(l.t);
            if (m) progress = Math.min(100, parseFloat(m[1]));
          }
          return { ...j, progress, lines: [...j.lines, ...add].slice(-MAX_LINES) };
        }),
      }));
    }, 80);
}

/**
 * Run a streamed operation as a tracked job. `start` receives the stream id and must begin streaming.
 * Resolves with the exit code once the stream ends.
 */
export function runJob(title: string, instanceId: string | null, start: (streamId: string) => Promise<unknown>, opts: { open?: boolean } = {}): Promise<number> {
  const id = uid("job-");
  const sid = uid("st-");
  const job: Job = { id, instanceId, title, status: "running", lines: [], progress: null, started: Date.now(), ended: null, streamId: sid };
  useJobs.setState((s) => ({ jobs: [job, ...s.jobs].slice(0, 40), ...(opts.open ? { open: true, focus: id } : {}) }));
  return new Promise((resolve) => {
    onStream(
      sid,
      (line, err) => queueLine(id, line, err),
      (code) => {
        setTimeout(() => {
          patch(id, (j) => ({ status: code === 0 ? "ok" : code === -9 ? "cancelled" : "error", ended: Date.now(), progress: code === 0 && j.progress != null ? 100 : j.progress }));
          resolve(code);
        }, 120);
      },
    );
    start(sid).catch((e) => {
      queueLine(id, String(e), true);
      setTimeout(() => {
        patch(id, { status: "error", ended: Date.now() });
        resolve(-1);
      }, 120);
    });
  });
}

/** Track a non-streamed async task as a job too (e.g. backups), with step updates. */
export async function runTask<T>(title: string, instanceId: string | null, fn: (step: (s: string) => void) => Promise<T>): Promise<T> {
  const id = uid("job-");
  const job: Job = { id, instanceId, title, status: "running", lines: [], progress: null, started: Date.now(), ended: null, streamId: null };
  useJobs.setState((s) => ({ jobs: [job, ...s.jobs].slice(0, 40) }));
  try {
    const r = await fn((s) => queueLine(id, s, false));
    setTimeout(() => patch(id, { status: "ok", ended: Date.now() }), 100);
    return r;
  } catch (e) {
    queueLine(id, String(e), true);
    setTimeout(() => patch(id, { status: "error", ended: Date.now() }), 100);
    throw e;
  }
}

/** An instance is busy while the automation engine or a UI-launched operation is working on it. */
export function useBusy(instanceId: string): boolean {
  const engine = useStoreBusy(instanceId);
  const ui = useJobs((s) => s.jobs.some((j) => j.status === "running" && j.instanceId === instanceId));
  return engine || ui;
}
