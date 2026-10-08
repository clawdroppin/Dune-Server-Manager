/**
 * Lossless Unreal-style INI document model. Preserves comments, ordering, blank lines,
 * repeated/array keys (+Key=, -Key=) and commented-out template entries (";Key=Value").
 */
export interface IniLine {
  raw: string;
  type: "section" | "kv" | "comment" | "blank";
  section: string;
  key?: string;
  value?: string;
  prefix?: string; // "+", "-", "." or ""
  disabled?: boolean; // commented-out kv
}

const KV_RE = /^\s*([;#]\s*)?([+\-.!]?)([A-Za-z0-9_.\[\]/:]+)\s*=\s*(.*)$/;

export function parseIni(text: string): IniLine[] {
  const lines: IniLine[] = [];
  let section = "";
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const t = raw.trim();
    if (!t) {
      lines.push({ raw, type: "blank", section });
      continue;
    }
    const sec = /^\[(.+)\]$/.exec(t);
    if (sec) {
      section = sec[1];
      lines.push({ raw, type: "section", section });
      continue;
    }
    const kv = KV_RE.exec(raw);
    if (kv) {
      const disabled = !!kv[1];
      // A commented line with spaces in the "key" is prose, not a disabled entry.
      lines.push({ raw, type: "kv", section, disabled, prefix: kv[2], key: kv[3], value: kv[4].trim() });
      continue;
    }
    lines.push({ raw, type: "comment", section });
  }
  if (lines.length && lines[lines.length - 1].type === "blank" && lines[lines.length - 1].raw === "") lines.pop();
  return lines;
}

export function serializeIni(lines: IniLine[]): string {
  return lines.map((l) => l.raw).join("\r\n") + "\r\n";
}

function render(l: IniLine): string {
  return `${l.disabled ? ";" : ""}${l.prefix ?? ""}${l.key}=${l.value}`;
}

export interface IniEntry {
  section: string;
  key: string;
  value: string;
  disabled: boolean;
  array: boolean;
  index: number;
}

/** Unique keys per section (array keys collapse to one entry with multiple values). */
export function entries(lines: IniLine[]): IniEntry[] {
  const out = new Map<string, IniEntry>();
  lines.forEach((l, index) => {
    if (l.type !== "kv" || !l.key) return;
    const id = `${l.section}\u0000${l.key}`;
    const array = l.prefix === "+" || l.prefix === "-";
    const prev = out.get(id);
    // An active line always wins over a disabled template line.
    if (!prev || (prev.disabled && !l.disabled)) out.set(id, { section: l.section, key: l.key, value: l.value ?? "", disabled: !!l.disabled, array, index });
    else if (prev && array) prev.array = true;
  });
  return [...out.values()];
}

export function getValue(lines: IniLine[], key: string, section?: string): { value: string; disabled: boolean; section: string } | null {
  let found: { value: string; disabled: boolean; section: string } | null = null;
  for (const l of lines) {
    if (l.type !== "kv" || l.key !== key || (section && l.section !== section)) continue;
    if (!found || (found.disabled && !l.disabled)) found = { value: l.value ?? "", disabled: !!l.disabled, section: l.section };
  }
  return found;
}

/** Set (and enable) a key. Reuses an active line, else uncomments a template line, else appends to the section. */
export function setValue(lines: IniLine[], section: string, key: string, value: string): IniLine[] {
  const next = lines.map((l) => ({ ...l }));
  const active = next.findIndex((l) => l.type === "kv" && l.key === key && l.section === section && !l.disabled && l.prefix !== "+" && l.prefix !== "-");
  const idx = active >= 0 ? active : next.findIndex((l) => l.type === "kv" && l.key === key && l.section === section && l.disabled && l.prefix !== "+");
  if (idx >= 0) {
    const l = next[idx];
    l.value = value;
    l.disabled = false;
    l.raw = render(l);
    return next;
  }
  return insert(next, section, { raw: "", type: "kv", section, key, value, prefix: "", disabled: false });
}

/** Comment a key out (revert to game default) without losing the template line. */
export function disableKey(lines: IniLine[], section: string, key: string): IniLine[] {
  return lines.map((l) => {
    if (l.type === "kv" && l.key === key && l.section === section && !l.disabled) {
      const n = { ...l, disabled: true };
      n.raw = render(n);
      return n;
    }
    return l;
  });
}

export function getArray(lines: IniLine[], section: string, key: string): string[] {
  return lines.filter((l) => l.type === "kv" && l.key === key && l.section === section && !l.disabled && l.prefix === "+").map((l) => l.value ?? "");
}

export function setArray(lines: IniLine[], section: string, key: string, values: string[]): IniLine[] {
  const firstIdx = lines.findIndex((l) => l.type === "kv" && l.key === key && l.section === section);
  let next = lines.filter((l) => !(l.type === "kv" && l.key === key && l.section === section && !l.disabled && (l.prefix === "+" || l.prefix === "")));
  const items: IniLine[] = values.map((v) => {
    const l: IniLine = { raw: "", type: "kv", section, key, value: v, prefix: "+", disabled: false };
    l.raw = render(l);
    return l;
  });
  if (items.length === 0) return next;
  if (firstIdx >= 0) {
    const at = Math.min(firstIdx, next.length);
    next.splice(at, 0, ...items);
    return next;
  }
  for (const it of items) next = insert(next, section, it);
  return next;
}

function insert(lines: IniLine[], section: string, line: IniLine): IniLine[] {
  line.raw = render(line);
  const secIdx = lines.findIndex((l) => l.type === "section" && l.section === section);
  if (secIdx < 0) {
    const tail: IniLine[] = [];
    if (lines.length && lines[lines.length - 1].type !== "blank") tail.push({ raw: "", type: "blank", section: lines[lines.length - 1]?.section ?? "" });
    tail.push({ raw: `[${section}]`, type: "section", section }, line);
    return [...lines, ...tail];
  }
  let end = secIdx + 1;
  while (end < lines.length && lines[end].type !== "section") end++;
  // Insert after the last non-blank line in the section.
  let at = end;
  while (at > secIdx + 1 && lines[at - 1].type === "blank") at--;
  const next = [...lines];
  next.splice(at, 0, line);
  return next;
}

export function sections(lines: IniLine[]): string[] {
  return [...new Set(lines.filter((l) => l.type === "section").map((l) => l.section))];
}

/** Minimal line diff for the review-before-save dialog. */
export function diffLines(a: string, b: string): { type: "same" | "add" | "del"; text: string }[] {
  const x = a.replace(/\r\n/g, "\n").split("\n");
  const y = b.replace(/\r\n/g, "\n").split("\n");
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = x[i] === y[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: { type: "same" | "add" | "del"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ type: "same", text: x[i] });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) out.push({ type: "del", text: x[i++] });
    else out.push({ type: "add", text: y[j++] });
  }
  while (i < n) out.push({ type: "del", text: x[i++] });
  while (j < m) out.push({ type: "add", text: y[j++] });
  return out;
}

export const isBoolValue = (v: string) => /^(true|false)$/i.test(v.trim());
export const isNumValue = (v: string) => /^-?\d+(\.\d+)?$/.test(v.trim());
export const unquote = (v: string) => v.replace(/^"(.*)"$/, "$1");
