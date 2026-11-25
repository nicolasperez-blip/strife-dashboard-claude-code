import type { ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import { NO_WRITE_PROMPT, guardSettings, runClaude, writeToolBlocklist } from './claude.js';
import { addCard, followAgent } from './board.js';
import { newId, readJson, writeJson } from './store.js';
import { projectOf } from './sessions.js';

export const MODELS = ['opus', 'sonnet', 'haiku'] as const;
export const PERMISSION_MODES = ['plan', 'acceptEdits', 'auto'] as const;
const MAX_PARALLEL = 3;
const MAX_LOG = 400;

export type RunStatus = 'queued' | 'running' | 'ok' | 'error' | 'stopped' | 'interrupted';

export interface LogItem {
  kind: 'text' | 'tool' | 'result' | 'error' | 'system';
  text: string;
  ts: number;
}

export interface Run {
  id: string;
  title: string;
  cwd: string;
  project: string;
  prompt: string;
  model: string;
  permissionMode: string;
  /** session id to continue with --resume */
  resume?: string;
  status: RunStatus;
  cardId: string;
  sessionId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  costUSD?: number;
  result?: string;
  error?: string;
  log: LogItem[];
}

let runs: Run[] = readJson<Run[]>('runs.json', []);
for (const r of runs) {
  if (r.status === 'running' || r.status === 'queued') {
    r.status = 'interrupted';
    r.endedAt = r.endedAt ?? Date.now();
    followAgent(r.cardId, 'finished');
  }
}

const procs = new Map<string, ChildProcess>();
const listeners = new Map<string, Set<(item: LogItem | { kind: 'status'; run: Run }) => void>>();

let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => writeJson('runs.json', runs.slice(0, 200)), 300);
}

export const listRuns = () => runs.map(({ log, ...r }) => ({ ...r, logSize: log.length }));
export const getRun = (id: string) => runs.find((r) => r.id === id);

export function subscribe(id: string, fn: (item: any) => void): () => void {
  const set = listeners.get(id) ?? new Set();
  set.add(fn);
  listeners.set(id, set);
  return () => set.delete(fn);
}

function emit(run: Run, item: LogItem | { kind: 'status'; run: Run }) {
  for (const fn of listeners.get(run.id) ?? []) fn(item);
}

function log(run: Run, kind: LogItem['kind'], text: string) {
  const item = { kind, text, ts: Date.now() };
  run.log.push(item);
  if (run.log.length > MAX_LOG) run.log.splice(0, run.log.length - MAX_LOG);
  emit(run, item);
}

function setStatus(run: Run, status: RunStatus) {
  run.status = status;
  const { log: _l, ...rest } = run;
  emit(run, { kind: 'status', run: rest as Run });
  save();
}

export interface NewRun {
  cwd: string;
  prompt: string;
  title?: string;
  model?: string;
  permissionMode?: string;
  resume?: string;
}

export function createRun(input: NewRun): Run {
  if (!input.prompt?.trim()) throw new Error('El prompt está vacío.');
  if (!fs.existsSync(input.cwd)) throw new Error(`La carpeta no existe: ${input.cwd}`);
  const model = MODELS.includes(input.model as any) ? input.model! : 'sonnet';
  const permissionMode = PERMISSION_MODES.includes(input.permissionMode as any) ? input.permissionMode! : 'plan';
  const title = (input.title || input.prompt.split('\n')[0]).slice(0, 60);
  const project = projectOf(input.cwd);
  const id = newId('run-');
  const card = addCard({ type: 'agent', title, project, refId: id });
  const run: Run = {
    id,
    title,
    cwd: input.cwd,
    project,
    prompt: input.prompt,
    model,
    permissionMode,
    resume: input.resume && /^[0-9a-f-]{36}$/.test(input.resume) ? input.resume : undefined,
    status: 'queued',
    cardId: card.id,
    createdAt: Date.now(),
    log: [],
  };
  runs.unshift(run);
  save();
  pump();
  return run;
}

function pump() {
  const running = runs.filter((r) => r.status === 'running').length;
  const next = runs.filter((r) => r.status === 'queued').reverse();
  for (const r of next.slice(0, Math.max(0, MAX_PARALLEL - running))) void start(r);
}

function describeTool(b: any): string {
  const i = b.input ?? {};
  const arg = i.file_path || i.command || i.pattern || i.description || i.url || i.query || i.skill || '';
  return `${b.name}${arg ? ` ${String(arg).slice(0, 200)}` : ''}`;
}

async function start(run: Run) {
  run.status = 'running';
  run.startedAt = Date.now();
  setStatus(run, 'running');
  followAgent(run.cardId, 'running');
  let settings: string;
  try {
    settings = guardSettings();
  } catch (e: any) {
    // Without the hook there is no guard against connector writes, so do not start.
    run.error = `${e.message}. La corrida no arrancó.`;
    log(run, 'error', run.error);
    run.endedAt = Date.now();
    setStatus(run, 'error');
    followAgent(run.cardId, 'finished');
    pump();
    return;
  }
  const blocked = await writeToolBlocklist().catch(() => [] as string[]);
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', run.model,
    '--permission-mode', run.permissionMode,
    ...(run.resume ? ['--resume', run.resume] : ['--name', `cp: ${run.title}`]),
    '--append-system-prompt', NO_WRITE_PROMPT,
    '--settings', settings,
    ...(blocked.length ? ['--disallowedTools', ...blocked] : []),
  ];
  log(run, 'system', `claude -p · ${run.model} · ${run.permissionMode} · ${run.cwd}`);
  const h = runClaude({
    args,
    cwd: run.cwd,
    stdin: run.prompt,
    onEvent: (ev) => {
      if (ev.type === 'system' && ev.subtype === 'init') {
        run.sessionId = ev.session_id;
        save();
      } else if (ev.type === 'assistant') {
        for (const b of ev.message?.content ?? []) {
          if (b.type === 'text' && b.text?.trim()) log(run, 'text', b.text.trim());
          else if (b.type === 'tool_use') log(run, 'tool', describeTool(b));
        }
      } else if (ev.type === 'user') {
        for (const b of ev.message?.content ?? []) {
          if (b.type === 'tool_result' && b.is_error) {
            const t = typeof b.content === 'string' ? b.content : JSON.stringify(b.content);
            log(run, 'error', t.slice(0, 400));
          }
        }
      } else if (ev.type === 'result') {
        run.costUSD = ev.total_cost_usd;
        run.result = ev.result;
        if (ev.is_error) run.error = ev.result || ev.subtype;
        log(run, ev.is_error ? 'error' : 'result', ev.result || ev.subtype || '');
      }
    },
  });
  procs.set(run.id, h.child);
  const { code, stderr } = await h.done;
  procs.delete(run.id);
  run.endedAt = Date.now();
  if ((run.status as RunStatus) === 'stopped') {
    /* keep */
  } else if (code === 0 && !run.error) {
    run.status = 'ok';
  } else {
    run.status = 'error';
    if (!run.error) run.error = stderr.trim().slice(-600) || `claude terminó con código ${code}`;
    if (stderr.trim()) log(run, 'error', stderr.trim().slice(-600));
  }
  setStatus(run, run.status);
  followAgent(run.cardId, 'finished');
  pump();
}

export function stopRun(id: string): boolean {
  const run = getRun(id);
  if (!run) return false;
  if (run.status === 'queued') {
    run.status = 'stopped';
    run.endedAt = Date.now();
    setStatus(run, 'stopped');
    followAgent(run.cardId, 'finished');
    return true;
  }
  const p = procs.get(id);
  if (!p) return false;
  run.status = 'stopped';
  log(run, 'system', 'Frenado desde el panel.');
  p.kill('SIGTERM');
  setTimeout(() => p.exitCode === null && p.kill('SIGKILL'), 5000);
  return true;
}

export const activeCount = () => runs.filter((r) => r.status === 'running' || r.status === 'queued').length;
