import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resultOf, runClaude } from './claude.js';
import { DATA_DIR, addAuxCost } from './store.js';
import { getSession, sessionFile, sessionTimeline } from './sessions.js';

const DIR = path.join(DATA_DIR, 'summaries');
const MAX_CHARS = 120_000;
/** Bump when the summary format changes: older summaries regenerate when opened. */
const SUMMARY_VERSION = 2;

interface SummaryMeta {
  version?: number;
  generatedAt: number;
  transcriptMtime: number;
  costUSD?: number;
}

export interface SummaryState {
  status: 'none' | 'running' | 'ready' | 'error';
  markdown?: string;
  generatedAt?: number;
  stale?: boolean;
  error?: string;
}

const running = new Map<string, Promise<void>>();
const errors = new Map<string, string>();

const mdPath = (id: string) => path.join(DIR, `${id}.md`);
const metaPath = (id: string) => path.join(DIR, `${id}.json`);

export function getSummary(id: string): SummaryState {
  if (running.has(id)) return { status: 'running' };
  if (!fs.existsSync(mdPath(id))) {
    const error = errors.get(id);
    return error ? { status: 'error', error } : { status: 'none' };
  }
  let meta: SummaryMeta | undefined;
  try {
    meta = JSON.parse(fs.readFileSync(metaPath(id), 'utf8'));
  } catch {
    /* no meta */
  }
  // An older format counts as missing, so the drawer asks for a new one.
  if ((meta?.version ?? 1) < SUMMARY_VERSION) return { status: 'none' };
  const markdown = fs.readFileSync(mdPath(id), 'utf8');
  const file = sessionFile(id);
  const mtime = file ? fs.statSync(file).mtimeMs : 0;
  return {
    status: 'ready',
    markdown,
    generatedAt: meta?.generatedAt,
    stale: !!meta && mtime > meta.transcriptMtime + 1000,
  };
}

/** Condensed transcript: prompts, Claude's text and tool calls. Keeps the start and the end when too long. */
function condense(id: string): string {
  const lines = sessionTimeline(id, 2500).map((i) =>
    i.role === 'user' ? `\n[USUARIO] ${i.text}` : i.role === 'assistant' ? `[CLAUDE] ${i.text}` : `  -> ${i.text}`,
  );
  const all = lines.join('\n');
  if (all.length <= MAX_CHARS) return all;
  return `${all.slice(0, MAX_CHARS / 3)}\n\n[... recortado ...]\n\n${all.slice(-(MAX_CHARS * 2) / 3)}`;
}

const INSTRUCTIONS = `Sos el redactor de Claudiopiloto. Te paso el transcript condensado de una sesión de Claude Code
(prompts del usuario, respuestas de Claude y las tools que usó, marcadas con "->").
Escribí un documento en markdown, en español rioplatense, que le sirva al usuario para retomar el trabajo
sin releer la sesión. Usá exactamente estas secciones, en este orden:

## Resumen
Un párrafo de 4 a 6 oraciones: el objetivo, qué se hizo, el resultado y en qué estado quedó.

## Qué se hizo
Lista cronológica de 4 a 12 pasos concretos. Nombrá archivos, comandos, tickets, PRs o ramas cuando importen.

## Resultado
Qué quedó entregado o funcionando (código, PR, commit, documento, mensaje, informe), qué se verificó y cómo,
y qué no se pudo verificar.

## Decisiones
Cada decisión importante con su motivo. Si no hubo, poné "Ninguna registrada".

## Problemas
Errores, bloqueos o desvíos y cómo se resolvieron. Si no hubo, poné "Ninguno registrado".

## Pendientes
Próximos pasos concretos, cada uno accionable. Si no hay, poné "Nada pendiente".

## Contexto
Lista corta: repo, rama, tickets (claves tipo SKPT-123), archivos o áreas clave, servicios externos usados.

Reglas: no inventes nada que no esté en el transcript; si algo no está claro, decilo.
Usá \`código\` para archivos, comandos y ramas. Sin introducción ni cierre.`;

/** Remove a session's summary files (used when the session is deleted). */
export function deleteSummary(id: string): void {
  for (const f of [mdPath(id), metaPath(id)]) fs.rmSync(f, { force: true });
  errors.delete(id);
}

export function generateSummary(id: string): SummaryState {
  if (running.has(id)) return { status: 'running' };
  const file = sessionFile(id);
  const meta = getSession(id);
  if (!file || !meta) return { status: 'error', error: 'No encontré la sesión.' };
  errors.delete(id);
  const header = `Título: ${meta.title}\nProyecto: ${meta.project}\nRama: ${meta.branch || '-'}\nInicio: ${meta.start}\nFin: ${meta.end}\nArchivos editados: ${meta.files.join(', ') || '-'}\n`;
  const stdin = `${INSTRUCTIONS}\n\n---\n${header}\n---\n${condense(id)}`;
  const mtime = fs.statSync(file).mtimeMs;
  const job = (async () => {
    const h = runClaude({
      args: ['-p', '--model', 'haiku', '--output-format', 'json', '--no-session-persistence', '--strict-mcp-config', '--tools', ''],
      cwd: os.tmpdir(),
      stdin,
    });
    const { code, stderr, events } = await h.done;
    const res = resultOf(events);
    if (code !== 0 || !res || res.is_error || !res.result) {
      errors.set(id, (res?.result || stderr || `claude terminó con código ${code}`).slice(-500));
      return;
    }
    addAuxCost('summary', res.total_cost_usd);
    fs.writeFileSync(mdPath(id), String(res.result).trim() + '\n');
    const m: SummaryMeta = { version: SUMMARY_VERSION, generatedAt: Date.now(), transcriptMtime: mtime, costUSD: res.total_cost_usd };
    fs.writeFileSync(metaPath(id), JSON.stringify(m));
  })().finally(() => running.delete(id));
  running.set(id, job);
  return { status: 'running' };
}
