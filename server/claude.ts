import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson } from './store.js';
// @ts-ignore plain ESM module shared with the hook script
import { CONNECTOR_PREFIX, isConnectorWrite } from './hooks/connector-policy.mjs';

export const HOOK_PATH = path.join(import.meta.dirname, 'hooks', 'block-connector-writes.mjs');

/**
 * Settings passed with --settings to every run: a PreToolUse hook that blocks any
 * claude.ai connector tool that does not read. It is the main write guard, because
 * the tool list from the init event can miss connectors that connect late.
 */
export function guardSettings(): string {
  if (!fs.existsSync(HOOK_PATH)) throw new Error(`Falta el hook de seguridad: ${HOOK_PATH}`);
  return JSON.stringify({
    hooks: {
      PreToolUse: [
        {
          matcher: `${CONNECTOR_PREFIX}.*`,
          hooks: [{ type: 'command', command: `${JSON.stringify(process.execPath)} ${JSON.stringify(HOOK_PATH)}` }],
        },
      ],
    },
  });
}

const LOCAL_BIN = path.join(os.homedir(), '.local/bin/claude');
export const CLAUDE_BIN = process.env.CLAUDE_BIN || (fs.existsSync(LOCAL_BIN) ? LOCAL_BIN : 'claude');

/** Variables that tie a process to a parent Claude Code session. A child run must not inherit them. */
const KEEP = new Set(['CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX']);
export function cleanEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (KEEP.has(key)) continue;
    if (
      key === 'CLAUDECODE' ||
      key.startsWith('CLAUDE_CODE_') ||
      key.startsWith('CLAUDE_AGENT_SDK') ||
      key.startsWith('CLAUDE_PREVIEW') ||
      ['CLAUDE_PID', 'CLAUDE_EFFORT', 'AI_AGENT', 'BAGGAGE'].includes(key)
    ) {
      delete env[key];
    }
  }
  return env;
}

export const NO_WRITE_PROMPT = [
  'You run from Claudiopiloto, a local dashboard, without a live chat with the user.',
  'Never write to Jira, Confluence, Slack, Monday, Gmail, Google Calendar or Google Drive:',
  'no comments, no transitions, no messages, no new or edited items.',
  'If the task needs such a write, end with a clear draft (target, exact text) so the user can approve and send it.',
  'Jira, Slack and Monday tools can take a few seconds to connect or show up as deferred tools: if you do not see them, find them with ToolSearch before you conclude they are unavailable.',
  'Answer in Spanish (Rioplatense), short and direct.',
].join(' ');

export interface RunHandle {
  child: ChildProcess;
  done: Promise<{ code: number | null; stderr: string; events: any[] }>;
}

/** Spawn `claude` with args, feed stdin, and parse stdout as JSON lines. */
export function runClaude(opts: {
  args: string[];
  cwd: string;
  stdin?: string;
  onEvent?: (event: any) => void;
}): RunHandle {
  const child = spawn(CLAUDE_BIN, opts.args, {
    cwd: opts.cwd,
    env: cleanEnv(),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const events: any[] = [];
  let stderr = '';
  let buf = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buf += chunk;
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try {
        const ev = JSON.parse(line);
        events.push(ev);
        opts.onEvent?.(ev);
      } catch {
        /* not JSON: ignore */
      }
    }
  });
  child.stderr!.setEncoding('utf8');
  child.stderr!.on('data', (c: string) => {
    stderr = (stderr + c).slice(-4000);
  });
  child.stdin!.on('error', () => {});
  child.stdin!.end(opts.stdin ?? '');
  const done = new Promise<{ code: number | null; stderr: string; events: any[] }>((resolve) => {
    child.on('error', (err) => {
      stderr += String(err);
      resolve({ code: -1, stderr, events });
    });
    child.on('close', (code) => {
      const rest = buf.trim();
      if (rest) {
        try {
          const ev = JSON.parse(rest);
          events.push(ev);
          opts.onEvent?.(ev);
        } catch {
          /* ignore */
        }
      }
      resolve({ code, stderr, events });
    });
  });
  return { child, done };
}

// ---------- tool lists ----------

interface ToolCache {
  at: number;
  tools: string[];
}

/**
 * Read the tool list from claude's init event, then kill the process
 * before it calls the API, so this costs no tokens. Cached for 12 hours.
 */
export async function discoverTools(force = false): Promise<string[]> {
  const cached = readJson<ToolCache | null>('tools.json', null);
  if (!force && cached && Date.now() - cached.at < 12 * 3600_000 && cached.tools.some((t) => t.startsWith(CONNECTOR_PREFIX))) return cached.tools;
  const tools = await new Promise<string[]>((resolve) => {
    let found: string[] = [];
    const h = runClaude({
      args: ['-p', '--output-format', 'stream-json', '--verbose', '--model', 'haiku', '--no-session-persistence'],
      cwd: os.homedir(),
      stdin: 'ok',
      onEvent: (ev) => {
        if (ev.type === 'system' && ev.subtype === 'init') {
          found = ev.tools ?? [];
          h.child.kill('SIGKILL');
        }
      },
    });
    const timer = setTimeout(() => h.child.kill('SIGKILL'), 90_000);
    h.done.then(() => {
      clearTimeout(timer);
      resolve(found);
    });
  });
  const hasConnectors = (list: string[]) => list.some((t) => t.startsWith(CONNECTOR_PREFIX));
  if (hasConnectors(tools)) writeJson('tools.json', { at: Date.now(), tools });
  return hasConnectors(tools) ? tools : cached?.tools ?? tools;
}

/** Split connector tools (mcp__claude_ai_*) into read and write. Every other tool is left alone. */
export function splitConnectorTools(tools: string[]) {
  const connector = tools.filter((t) => t.startsWith(CONNECTOR_PREFIX));
  return { read: connector.filter((t) => !isConnectorWrite(t)), write: connector.filter((t) => isConnectorWrite(t)) };
}

/** Second guard layer: connector write tools seen so far, for --disallowedTools. May be empty. */
export async function writeToolBlocklist(): Promise<string[]> {
  return splitConnectorTools(await discoverTools()).write;
}

/** Pull the final result event out of a `--output-format json` run. */
export function resultOf(events: any[]): any | undefined {
  return [...events].reverse().find((e) => e.type === 'result');
}
