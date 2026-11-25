import os from 'node:os';
import { guardSettings, resultOf, runClaude, writeToolBlocklist } from './claude.js';
import { addAuxCost, readJson, writeJson } from './store.js';

export interface FeedItem {
  source: 'jira' | 'slack';
  kind: string;
  title: string;
  summary: string;
  url: string;
  when: string;
  project: string | null;
}

export interface Feed {
  updatedAt: number | null;
  items: FeedItem[];
  status: 'idle' | 'running' | 'error';
  error?: string;
  /** Last run's final text and denied tools, to find out why a run came back empty. */
  debug?: { result?: string; denied?: string[] };
}

let feed: Feed = { ...readJson<Feed>('feed.json', { updatedAt: null, items: [], status: 'idle' }), status: 'idle' };
let job: Promise<void> | null = null;

export const getFeed = (): Feed => feed;

const PROMPT = `Armá las novedades para Claudiopiloto, el panel personal del usuario. Solo lectura: no escribas nada en ningún lado.

Las tools de Atlassian y Slack pueden tardar unos segundos en conectarse o aparecer como diferidas. Si no las ves, buscalas con ToolSearch (por ejemplo "searchJiraIssuesUsingJql" y "slack_search_public_and_private") y reintentá hasta 3 veces. Si después de eso no están, respondé exactamente: CONECTORES_NO_DISPONIBLES

Primero leé ~/.claude/skills/triage/sources.md: ahí están el cloudId, el proyecto de Jira, el JQL y los canales de Slack de Sanskrit.

1. Jira: tickets del proyecto SKPT actualizados en los últimos 3 días donde el usuario actual es assignee, reporter o watcher, y tickets SKPT creados en los últimos 2 días sin asignar. Máximo 15.
2. Slack: menciones al usuario y mensajes directos de las últimas 24 horas, y mensajes nuevos de las últimas 24 horas en los canales de Sanskrit de sources.md. Máximo 15. Saltá anuncios y bots.

Para cada item:
- source: "jira" o "slack".
- kind: una palabra: asignado, mencion, dm, nuevo, cambio, comentario.
- title: corto (para Jira, "SKPT-123 título").
- summary: una oración en español sobre qué pasó y si te piden algo.
- url: link directo al ticket o al mensaje.
- when: fecha y hora ISO 8601 del último cambio.
- project: "mediamonks-sanskrit" si es backend, "mediamonks-sanskrit-frontend" si es frontend, null si no se sabe.

Ordená del más nuevo al más viejo.

Respondé solo con un array JSON de items, sin texto antes ni después.`;

/** Find the JSON array of items in the final answer (bare, fenced, or wrapped in {items}). */
export function parseItems(text: string): FeedItem[] | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.search(/[[{]/);
  if (start < 0) return undefined;
  try {
    const parsed = JSON.parse(body.slice(start, Math.max(body.lastIndexOf(']'), body.lastIndexOf('}')) + 1));
    const items = Array.isArray(parsed) ? parsed : parsed?.items;
    return Array.isArray(items) ? items.filter((i) => i && i.title && i.url) : undefined;
  } catch {
    return undefined;
  }
}

export function refreshFeed(): Feed {
  if (job) return feed;
  feed = { ...feed, status: 'running', error: undefined };
  job = (async () => {
    // Whole servers are allowed here; the hook in guardSettings() blocks their write tools.
    const allowed = ['mcp__claude_ai_Atlassian_MCP', 'mcp__claude_ai_Slack', 'Read', 'ToolSearch'];
    const settings = guardSettings();
    const write = await writeToolBlocklist().catch(() => [] as string[]);
    for (let attempt = 1; attempt <= 2; attempt++) {
      const h = runClaude({
        args: [
          '-p',
          '--model', 'sonnet',
          '--output-format', 'json',
          '--no-session-persistence',
          '--permission-mode', 'dontAsk',
          '--tools', 'Read,ToolSearch',
          '--settings', settings,
          '--allowedTools', ...allowed,
          ...(write.length ? ['--disallowedTools', ...write] : []),
        ],
        cwd: os.homedir(),
        stdin: PROMPT,
      });
      const timer = setTimeout(() => h.child.kill('SIGTERM'), 8 * 60_000);
      const { code, stderr, events } = await h.done;
      clearTimeout(timer);
      const res = resultOf(events);
      addAuxCost('feed', res?.total_cost_usd);
      const text = typeof res?.result === 'string' ? res.result : '';
      if (text.includes('CONECTORES_NO_DISPONIBLES')) {
        if (attempt < 2) {
          await new Promise((r) => setTimeout(r, 20_000));
          continue;
        }
        // Keep the previous items: an empty list here would hide real news.
        feed = { ...feed, status: 'error', error: 'Jira y Slack no estaban conectados en esta corrida. Probá actualizar de nuevo en un rato.' };
        return;
    }
    const items = text ? parseItems(text) : undefined;
    if (code !== 0 || !items) {
      feed = { ...feed, status: 'error', error: (res?.result || stderr || `claude terminó con código ${code}`).slice(-500) };
      return;
    }
    items.sort((a, b) => (b.when || '').localeCompare(a.when || ''));
    const debug = {
      result: typeof res?.result === 'string' ? res.result.slice(0, 2000) : undefined,
      denied: (res?.permission_denials ?? []).map((d: any) => d.tool_name),
    };
    feed = { updatedAt: Date.now(), items, status: 'idle', debug };
    writeJson('feed.json', feed);
    return;
    }
  })()
    .catch((e) => {
      feed = { ...feed, status: 'error', error: String(e) };
    })
    .finally(() => {
      job = null;
    });
  return feed;
}
