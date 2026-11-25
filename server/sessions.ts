import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CLAUDE_DIR, PROJECTS_DIR, localDate, readJson, writeJson } from './store.js';

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
}

/** Usage of one session on one day with one model. `weight` approximates relative price. */
export interface Bucket {
  date: string;
  model: string;
  weight: number;
  tokens: number;
}

export interface SessionMeta {
  id: string;
  cwd: string;
  project: string;
  title: string;
  firstPrompt: string;
  lastPrompt: string;
  branch: string;
  entrypoint: string;
  start: string;
  end: string;
  userTurns: number;
  assistantTurns: number;
  models: string[];
  tokens: Tokens;
  costUSD: number | null;
  tools: string[];
  files: string[];
  subagents: number;
  buckets: Bucket[];
  /** Last line Claude wrote, to see where the session stopped. */
  lastClaudeText: string;
  /** A question or plan approval Claude asked and nobody answered yet. */
  pendingQuestion: string | null;
  /** Ticket keys (like SKPT-123) seen in the title, prompts or branch. */
  tickets: string[];
}

const INDEX_VERSION = 5;
const TICKET_RE = /\b[A-Z][A-Z0-9]+-\d+\b/g;
const QUESTION_TOOLS = new Set(['AskUserQuestion', 'ExitPlanMode']);
interface IndexFile {
  version: number;
  entries: Record<string, { sig: string; meta: SessionMeta | null }>;
}

let index: IndexFile = readJson<IndexFile>('index.json', { version: INDEX_VERSION, entries: {} });
if (index.version !== INDEX_VERSION) index = { version: INDEX_VERSION, entries: {} };

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);

/** Repo root for a cwd: drop worktree suffixes so a worktree counts as its repo. */
export function projectOf(cwd: string): string {
  const root = cwd.split('/.claude/worktrees/')[0];
  return path.basename(root) || root;
}

function textOf(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
  return '';
}

/** A user record typed by a person (not a tool result, reminder or command echo). */
export function humanText(d: any): string | null {
  if (d.type !== 'user' || d.isMeta || d.isSidechain) return null;
  if (d.origin && d.origin.kind && d.origin.kind !== 'human') return null;
  const c = d.message?.content;
  if (Array.isArray(c) && c.some((b: any) => b?.type === 'tool_result')) return null;
  const t = textOf(c).trim();
  if (!t || t.startsWith('<')) return null;
  return t;
}

function readLines(file: string): any[] {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return [];
  }
  const out: any[] = [];
  for (const line of raw.split('\n')) {
    if (!line) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* partial line while a session is writing */
    }
  }
  return out;
}

function emptyMeta(id: string): SessionMeta {
  return {
    id,
    cwd: '',
    project: '',
    title: '',
    firstPrompt: '',
    lastPrompt: '',
    branch: '',
    entrypoint: '',
    start: '',
    end: '',
    userTurns: 0,
    assistantTurns: 0,
    models: [],
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreate: 0 },
    costUSD: null,
    tools: [],
    files: [],
    subagents: 0,
    buckets: [],
    lastClaudeText: '',
    pendingQuestion: null,
    tickets: [],
  };
}

function questionText(b: any): string {
  if (b.name === 'ExitPlanMode') return 'Aprobar el plan';
  const q = b.input?.questions?.[0]?.question;
  return typeof q === 'string' ? q.slice(0, 200) : 'Te hizo una pregunta';
}

/** Count which child folder of `meta.cwd` each tool call points at, to find the repo a session worked on. */
function countRepoHit(hits: Map<string, number>, cwd: string, input: any) {
  if (!cwd || !input) return;
  const candidates = [input.file_path, input.path, input.notebook_path];
  if (typeof input.command === 'string') {
    const m = input.command.match(new RegExp(`${cwd.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/([\\w.-]+)`));
    if (m) candidates.push(`${cwd}/${m[1]}/`);
    const cd = input.command.match(/(?:^|&&|;)\s*cd\s+([\w./-]+)/);
    if (cd && !cd[1].startsWith('/')) candidates.push(`${cwd}/${cd[1]}/`);
  }
  for (const c of candidates) {
    if (typeof c !== 'string' || !c.startsWith(cwd + '/')) continue;
    const seg = c.slice(cwd.length + 1).split('/')[0];
    if (seg && !seg.startsWith('.')) hits.set(seg, (hits.get(seg) ?? 0) + 1);
  }
}

const repoHitsByMeta = new WeakMap<SessionMeta, Map<string, number>>();

/** Add usage records from one transcript file (main or subagent) to meta. */
function accumulate(meta: SessionMeta, records: any[], isMain: boolean) {
  const hits = repoHitsByMeta.get(meta) ?? new Map<string, number>();
  repoHitsByMeta.set(meta, hits);
  const seen = new Set<string>();
  const buckets = new Map(meta.buckets.map((b) => [`${b.date}|${b.model}`, b]));
  const tools = new Set(meta.tools);
  const files = new Set(meta.files);
  const models = new Set(meta.models);
  let customTitle = '';
  let agentName = '';
  const tickets = new Set(meta.tickets);
  let pending: { id: string; text: string } | null = null;

  for (const d of records) {
    const ts: string | undefined = d.timestamp;
    if (ts && isMain) {
      if (!meta.start || ts < meta.start) meta.start = ts;
      if (!meta.end || ts > meta.end) meta.end = ts;
    }
    if (!isMain) {
      if (d.type !== 'assistant') continue;
    }
    switch (d.type) {
      case 'custom-title':
        customTitle = d.customTitle || customTitle;
        break;
      case 'agent-name':
        agentName = d.agentName || agentName;
        break;
      case 'cost-state':
        if (typeof d.totalCostUSD === 'number') meta.costUSD = d.totalCostUSD;
        break;
      case 'user': {
        if (!meta.cwd && d.cwd) meta.cwd = d.cwd;
        if (d.gitBranch && d.gitBranch !== 'HEAD') meta.branch = d.gitBranch;
        if (!meta.entrypoint && d.entrypoint) meta.entrypoint = d.entrypoint;
        const c = d.message?.content;
        if (pending && Array.isArray(c) && c.some((b: any) => b?.type === 'tool_result' && b.tool_use_id === pending!.id)) pending = null;
        const t = humanText(d);
        if (t) {
          pending = null;
          for (const k of t.toUpperCase().match(TICKET_RE) ?? []) tickets.add(k);
          meta.userTurns++;
          if (!meta.firstPrompt) meta.firstPrompt = t.slice(0, 300);
          meta.lastPrompt = t.slice(0, 300);
        }
        break;
      }
      case 'assistant': {
        const m = d.message;
        if (!m) break;
        for (const b of m.content ?? []) {
          if (isMain && !d.isSidechain && b?.type === 'text' && b.text?.trim()) {
            const lines = b.text.trim().split('\n').filter((l: string) => l.trim());
            meta.lastClaudeText = lines[lines.length - 1].replace(/[*`#>]/g, '').trim().slice(0, 160);
          }
          if (isMain && !d.isSidechain && b?.type === 'tool_use' && QUESTION_TOOLS.has(b.name)) {
            pending = { id: b.id, text: questionText(b) };
          }
          if (b?.type === 'tool_use') {
            tools.add(b.name);
            countRepoHit(hits, meta.cwd || d.cwd || '', b.input);
            const fp = b.input?.file_path || b.input?.notebook_path;
            if (EDIT_TOOLS.has(b.name) && typeof fp === 'string') files.add(fp);
          }
        }
        const key = m.id || d.uuid;
        if (!key || seen.has(key)) break;
        seen.add(key);
        if (isMain) meta.assistantTurns++;
        const u = m.usage;
        if (!u || !m.model || m.model === '<synthetic>') break;
        models.add(m.model);
        const input = u.input_tokens ?? 0;
        const output = u.output_tokens ?? 0;
        const cacheRead = u.cache_read_input_tokens ?? 0;
        const cacheCreate = u.cache_creation_input_tokens ?? 0;
        meta.tokens.input += input;
        meta.tokens.output += output;
        meta.tokens.cacheRead += cacheRead;
        meta.tokens.cacheCreate += cacheCreate;
        const date = localDate(ts ?? Date.now());
        const bk = `${date}|${m.model}`;
        const b = buckets.get(bk) ?? { date, model: m.model, weight: 0, tokens: 0 };
        // Relative prices: output 5x input, cache write 1.25x, cache read 0.1x.
        b.weight += input + 5 * output + 1.25 * cacheCreate + 0.1 * cacheRead;
        b.tokens += input + output + cacheRead + cacheCreate;
        buckets.set(bk, b);
        break;
      }
    }
  }
  if (isMain) {
    meta.title = customTitle || agentName || meta.firstPrompt.split('\n')[0].slice(0, 80) || '(sin título)';
    for (const k of `${meta.title} ${meta.branch}`.toUpperCase().match(TICKET_RE) ?? []) tickets.add(k);
    // Keep only keys from known Jira projects, so things like UTF-8 do not count.
    meta.tickets = [...tickets].filter((k) => /^(SKPT|SK)-\d+$/.test(k));
    meta.pendingQuestion = pending?.text ?? null;
  }
  meta.buckets = [...buckets.values()];
  meta.tools = [...tools].sort();
  meta.files = [...files].sort();
  meta.models = [...models];
}

function sigOf(files: string[]): string {
  return files
    .map((f) => {
      try {
        const s = fs.statSync(f);
        return `${s.size}:${Math.round(s.mtimeMs)}`;
      } catch {
        return 'x';
      }
    })
    .join('|');
}

function subagentFiles(mainFile: string): string[] {
  const dir = path.join(mainFile.replace(/\.jsonl$/, ''), 'subagents');
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

function mainFiles(): string[] {
  const out: string[] = [];
  for (const dir of fs.readdirSync(PROJECTS_DIR, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const full = path.join(PROJECTS_DIR, dir.name);
    for (const f of fs.readdirSync(full)) if (f.endsWith('.jsonl')) out.push(path.join(full, f));
  }
  return out;
}

export function parseSession(file: string): SessionMeta | null {
  const id = path.basename(file, '.jsonl');
  const meta = emptyMeta(id);
  accumulate(meta, readLines(file), true);
  const subs = subagentFiles(file);
  meta.subagents = subs.length;
  for (const s of subs) accumulate(meta, readLines(s), false);
  if (!meta.userTurns && !meta.assistantTurns) return null;
  if (!meta.cwd) meta.cwd = path.basename(path.dirname(file));
  meta.project = projectOf(meta.cwd);
  // A session started in a folder of repos (like ~/Repos) belongs to the repo it touched most.
  const hits = repoHitsByMeta.get(meta);
  if (hits?.size && !fs.existsSync(path.join(meta.cwd, '.git'))) {
    const [top] = [...hits.entries()].sort((a, b) => b[1] - a[1])[0];
    if (fs.existsSync(path.join(meta.cwd, top, '.git'))) {
      meta.project = top;
      meta.cwd = path.join(meta.cwd, top);
    }
  }
  return meta;
}

const fileById = new Map<string, string>();
let lastScan = 0;
let cachedList: SessionMeta[] = [];

/** All sessions, newest first. Reparses only files whose size or mtime changed. */
export function listSessions(): SessionMeta[] {
  if (Date.now() - lastScan < 2000) return cachedList;
  const entries: IndexFile['entries'] = {};
  let changed = false;
  for (const file of mainFiles()) {
    const sig = sigOf([file, ...subagentFiles(file)]);
    const prev = index.entries[file];
    if (prev && prev.sig === sig) {
      entries[file] = prev;
    } else {
      entries[file] = { sig, meta: parseSession(file) };
      changed = true;
    }
    fileById.set(path.basename(file, '.jsonl'), file);
  }
  if (changed || Object.keys(entries).length !== Object.keys(index.entries).length) {
    index = { version: INDEX_VERSION, entries };
    writeJson('index.json', index);
  }
  cachedList = Object.values(entries)
    .map((e) => e.meta)
    .filter((m): m is SessionMeta => !!m)
    .sort((a, b) => b.end.localeCompare(a.end));
  lastScan = Date.now();
  return cachedList;
}

export function sessionFile(id: string): string | undefined {
  if (!fileById.size) listSessions();
  return fileById.get(id);
}

export function getSession(id: string): SessionMeta | undefined {
  return listSessions().find((s) => s.id === id);
}

/** Sessions moved to the Trash. Kept so the usage page still counts what they cost. */
export function trashedSessions(): SessionMeta[] {
  return readJson<SessionMeta[]>('trashed.json', []);
}

/**
 * Move a session's transcript (and its folder with subagents and tool results) to
 * ~/.Trash, so it can be put back from Finder. Open sessions are refused.
 */
export function trashSession(id: string): { ok: true } | { ok: false; error: string } {
  if (!/^[0-9a-f-]{36}$/.test(id)) return { ok: false, error: 'Id de sesión inválido.' };
  const meta = getSession(id);
  const file = sessionFile(id);
  if (!meta || !file || !fs.existsSync(file)) return { ok: false, error: 'No encontré la sesión.' };
  if (liveSessions().some((l) => l.sessionId === id)) {
    return { ok: false, error: 'La sesión está abierta. Cerrala en Claude antes de eliminarla.' };
  }
  const dest = path.join(os.homedir(), '.Trash', `claudiopiloto-${new Date().toISOString().slice(0, 10)}-${id}`);
  fs.mkdirSync(dest, { recursive: true });
  fs.renameSync(file, path.join(dest, path.basename(file)));
  const dir = file.replace(/\.jsonl$/, '');
  if (fs.existsSync(dir)) fs.renameSync(dir, path.join(dest, path.basename(dir)));
  writeJson('trashed.json', [...trashedSessions().filter((s) => s.id !== id), meta]);
  fileById.delete(id);
  lastScan = 0;
  return { ok: true };
}

export interface TimelineItem {
  role: 'user' | 'assistant' | 'tool';
  text: string;
  ts?: string;
}

/** Human prompts, Claude's text and tool calls, in order, for the drawer and the summary. */
export function sessionTimeline(id: string, maxText = 2000): TimelineItem[] {
  const file = sessionFile(id);
  if (!file) return [];
  const items: TimelineItem[] = [];
  const seenText = new Set<string>();
  for (const d of readLines(file)) {
    const h = humanText(d);
    if (h) {
      items.push({ role: 'user', text: h.slice(0, maxText), ts: d.timestamp });
      continue;
    }
    if (d.type !== 'assistant' || d.isSidechain) continue;
    for (const b of d.message?.content ?? []) {
      if (b?.type === 'text' && b.text?.trim()) {
        const key = `${d.message.id}:${b.text.slice(0, 50)}`;
        if (seenText.has(key)) continue;
        seenText.add(key);
        items.push({ role: 'assistant', text: b.text.trim().slice(0, maxText), ts: d.timestamp });
      } else if (b?.type === 'tool_use') {
        const i = b.input ?? {};
        const arg = i.file_path || i.command || i.pattern || i.description || i.url || i.query || '';
        items.push({ role: 'tool', text: `${b.name}${arg ? ` ${String(arg).slice(0, 160)}` : ''}`, ts: d.timestamp });
      }
    }
  }
  return items;
}

export interface LiveSession {
  pid: number;
  sessionId: string;
  cwd: string;
  project: string;
  kind: string;
  entrypoint: string;
  startedAt: number;
  /** busy: Claude is working. idle: waiting for the user. */
  status: string;
  statusUpdatedAt: number;
  /** Desktop app session id (local_...), used for claude://code/continue links. */
  hostSessionId?: string;
}

/** sessionId -> desktop host id, remembered so closed desktop sessions can still be opened in the app. */
let hostIds: Record<string, string> = readJson('host-ids.json', {});
export const hostIdOf = (sessionId: string): string | undefined => hostIds[sessionId];

export type SessionState = 'trabajando' | 'pregunta' | 'esperandote' | 'abierta_sin_uso' | 'cerrada';

/** Two hours without activity moves an open, idle session from "waiting for you" to "open, unused". */
const WAITING_WINDOW_MS = 2 * 3600_000;

export function sessionState(meta: Pick<SessionMeta, 'end' | 'pendingQuestion'>, live?: LiveSession): SessionState {
  if (!live) return 'cerrada';
  if (live.status === 'busy') return 'trabajando';
  if (meta.pendingQuestion) return 'pregunta';
  const last = Math.max(new Date(meta.end).getTime() || 0, live.statusUpdatedAt || 0);
  return Date.now() - last < WAITING_WINDOW_MS ? 'esperandote' : 'abierta_sin_uso';
}

/** Claude processes running now, from ~/.claude/sessions/<pid>.json. */
export function liveSessions(): LiveSession[] {
  const dir = path.join(CLAUDE_DIR, 'sessions');
  const out: LiveSession[] = [];
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir).filter((f) => /^\d+\.json$/.test(f));
  } catch {
    return out;
  }
  for (const n of names) {
    try {
      const s = JSON.parse(fs.readFileSync(path.join(dir, n), 'utf8'));
      process.kill(s.pid, 0);
      out.push({
        pid: s.pid,
        sessionId: s.sessionId,
        cwd: s.cwd,
        project: projectOf(s.cwd ?? ''),
        kind: s.kind,
        entrypoint: s.entrypoint,
        startedAt: s.startedAt,
        status: s.status ?? 'idle',
        statusUpdatedAt: s.statusUpdatedAt ?? s.updatedAt ?? s.startedAt,
        hostSessionId: s.hostSessionId,
      });
      if (s.hostSessionId && hostIds[s.sessionId] !== s.hostSessionId) {
        hostIds = { ...hostIds, [s.sessionId]: s.hostSessionId };
        writeJson('host-ids.json', hostIds);
      }
    } catch {
      /* dead process or bad file */
    }
  }
  return out;
}
