import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects');

fs.mkdirSync(path.join(DATA_DIR, 'summaries'), { recursive: true });

export function readJson<T>(name: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** Write JSON atomically: write a temp file, then rename over the target. */
export function writeJson(name: string, value: unknown): void {
  const file = path.join(DATA_DIR, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

export function newId(prefix = ''): string {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/** Local calendar date as YYYY-MM-DD. */
export function localDate(ts: number | string | Date): string {
  return new Date(ts).toLocaleDateString('sv-SE');
}

/**
 * Costs of Claude runs that do not leave a session file behind
 * (summaries and the Jira/Slack feed run with --no-session-persistence).
 */
export interface AuxCost {
  date: string;
  kind: 'summary' | 'feed';
  costUSD: number;
}

export function addAuxCost(kind: AuxCost['kind'], costUSD: number | undefined): void {
  if (!costUSD) return;
  const list = readJson<AuxCost[]>('aux-costs.json', []);
  list.push({ date: localDate(Date.now()), kind, costUSD });
  writeJson('aux-costs.json', list);
}
