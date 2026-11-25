import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { localOnly } from './guard.js';
import {
  getSession,
  hostIdOf,
  listSessions,
  liveSessions,
  sessionState,
  sessionTimeline,
  trashSession,
  trashedSessions,
  type LiveSession,
  type SessionMeta,
} from './sessions.js';
import * as sessionBoard from './sessionBoard.js';
import { buildUsage } from './usage.js';
import * as board from './board.js';
import { activeCount, createRun, getRun, listRuns, stopRun, subscribe } from './agents.js';
import { deleteSummary, generateSummary, getSummary } from './summaries.js';
import { getFeed, refreshFeed } from './feed.js';
import { CLAUDE_DIR, ROOT_DIR } from './store.js';
import { discoverTools } from './claude.js';

const PORT = Number(process.env.CP_PORT || 4477);
const app = new Hono();
app.use('*', localOnly);

const api = new Hono();

const BOARD_WINDOW_MS = 14 * 86400_000;

function liveById(): Map<string, LiveSession> {
  return new Map(liveSessions().map((l) => [l.sessionId, l]));
}

/** A session as the sessions view shows it: metadata without usage buckets, plus its real state. */
function withState(s: SessionMeta, live: Map<string, LiveSession>) {
  const { buckets, ...meta } = s;
  const l = live.get(s.id);
  return { ...meta, state: sessionState(s, l), hostSessionId: l?.hostSessionId ?? hostIdOf(s.id) ?? null };
}

// ---------- overview ----------
api.get('/summary', (c) => {
  const u = buildUsage([...listSessions(), ...trashedSessions()], 30);
  const feed = getFeed();
  return c.json({
    today: u.totals.today,
    last7: u.totals.last7,
    ...(() => {
      const live = liveById();
      const states = [...live.values()].map((l) => {
        const meta = getSession(l.sessionId);
        return meta ? sessionState(meta, l) : l.status === 'busy' ? 'trabajando' : 'esperandote';
      });
      return {
        working: states.filter((x) => x === 'trabajando').length,
        waiting: states.filter((x) => x === 'esperandote' || x === 'pregunta').length,
      };
    })(),
    agentsActive: activeCount(),
    feed: {
      jira: feed.items.filter((i) => i.source === 'jira').length,
      slack: feed.items.filter((i) => i.source === 'slack').length,
    },
  });
});

// ---------- projects ----------
api.get('/projects', (c) => {
  const sessions = listSessions();
  const map = new Map<string, { id: string; cwd: string; sessions: number; lastActivity: string }>();
  for (const s of sessions) {
    const p = map.get(s.project) ?? { id: s.project, cwd: s.cwd, sessions: 0, lastActivity: s.end };
    p.sessions++;
    if (s.end > p.lastActivity) {
      p.lastActivity = s.end;
      p.cwd = s.cwd;
    }
    map.set(s.project, p);
  }
  const extras = board.allExtras();
  // Keys that start with "_" (like _general) hold extras that are not a project.
  for (const id of Object.keys(extras)) if (!id.startsWith('_') && !map.has(id)) map.set(id, { id, cwd: '', sessions: 0, lastActivity: '' });
  const list = [...map.values()]
    .map((p) => ({ ...p, extras: board.getExtras(p.id) }))
    .filter((p) => !p.extras.hidden)
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  return c.json(list);
});

api.get('/projects/:id/extras', (c) => c.json(board.getExtras(c.req.param('id'))));
api.patch('/projects/:id', async (c) => c.json(board.patchExtras(c.req.param('id'), await c.req.json())));

// ---------- sessions ----------
api.get('/sessions', (c) => {
  const project = c.req.query('project');
  const q = (c.req.query('q') ?? '').toLowerCase();
  let list = listSessions();
  if (project) list = list.filter((s) => s.project === project);
  if (q) list = list.filter((s) => `${s.title} ${s.firstPrompt} ${s.branch}`.toLowerCase().includes(q));
  return c.json(list.map(({ buckets, ...s }) => s));
});

api.get('/sessions/live', (c) => c.json(liveSessions()));

// Recent sessions (14 days), the ones placed in a column and the open ones, minus hidden ones.
api.get('/sessions/board', (c) => {
  const live = liveById();
  const placed = sessionBoard.placedIds();
  const since = Date.now() - BOARD_WINDOW_MS;
  const list = listSessions().filter(
    (s) => !sessionBoard.isHidden(s.id) && (placed.has(s.id) || live.has(s.id) || new Date(s.end).getTime() >= since),
  );
  return c.json(list.map((s) => withState(s, live)));
});

api.get('/sessions/:id', (c) => {
  const s = getSession(c.req.param('id'));
  if (!s) return c.json({ error: 'No encontré la sesión.' }, 404);
  const timeline = sessionTimeline(s.id, 600).filter((i) => i.role !== 'tool');
  return c.json({ ...withState(s, liveById()), prompts: timeline.filter((i) => i.role === 'user').slice(0, 60) });
});

api.delete('/sessions/:id', (c) => {
  const id = c.req.param('id');
  const res = trashSession(id);
  if (!res.ok) return c.json({ error: res.error }, 400);
  deleteSummary(id);
  board.removeSessionCards(id);
  sessionBoard.removeSession(id);
  return c.json({ ok: true });
});

api.get('/sessions/:id/summary', (c) => c.json(getSummary(c.req.param('id'))));
api.post('/sessions/:id/summary', (c) => c.json(generateSummary(c.req.param('id'))));

// ---------- session board (my columns) ----------
api.get('/session-board', (c) => c.json(sessionBoard.getSessionBoard()));
api.post('/session-board/move', async (c) => {
  const b = await c.req.json();
  sessionBoard.moveSession(String(b.sessionId), String(b.columnId), b.beforeId ?? null);
  return c.json(sessionBoard.getSessionBoard());
});
api.post('/session-board/hide/:id', (c) => {
  sessionBoard.hideSession(c.req.param('id'));
  return c.json(sessionBoard.getSessionBoard());
});
api.post('/session-board/unhide/:id', (c) => {
  sessionBoard.unhideSession(c.req.param('id'));
  return c.json(sessionBoard.getSessionBoard());
});
api.post('/session-board/columns', async (c) => {
  const b = await c.req.json();
  if (!b.name?.trim()) return c.json({ error: 'Falta el nombre.' }, 400);
  return c.json(sessionBoard.addSessionColumn(b.name.trim().slice(0, 40), b.afterId));
});
api.patch('/session-board/columns/:id', async (c) => {
  const b = await c.req.json();
  if (b.move === -1 || b.move === 1) sessionBoard.moveSessionColumn(c.req.param('id'), b.move);
  else if (b.name?.trim()) sessionBoard.renameSessionColumn(c.req.param('id'), b.name.trim().slice(0, 40));
  return c.json(sessionBoard.getSessionBoard());
});
api.delete('/session-board/columns/:id', (c) => {
  sessionBoard.deleteSessionColumn(c.req.param('id'));
  return c.json(sessionBoard.getSessionBoard());
});

// ---------- usage ----------
api.get('/usage', (c) => c.json(buildUsage([...listSessions(), ...trashedSessions()], Math.min(90, Number(c.req.query('days') || 30)))));

// ---------- board ----------
api.get('/board', (c) => c.json(board.getBoard()));
api.post('/board/cards', async (c) => {
  const b = await c.req.json();
  if (!b.title?.trim()) return c.json({ error: 'Falta el título.' }, 400);
  if (!['task', 'session'].includes(b.type)) return c.json({ error: 'Tipo inválido.' }, 400);
  return c.json(board.addCard({ type: b.type, title: b.title.trim(), project: b.project ?? null, refId: b.refId, note: b.note }, b.columnId));
});
api.patch('/board/cards/:id', async (c) => c.json(board.updateCard(c.req.param('id'), await c.req.json()) ?? null));
api.delete('/board/cards/:id', (c) => {
  board.deleteCard(c.req.param('id'));
  return c.json({ ok: true });
});
api.post('/board/move', async (c) => {
  const b = await c.req.json();
  board.moveCard(b.cardId, b.columnId, b.beforeId ?? null);
  return c.json(board.getBoard());
});
api.post('/board/columns', async (c) => {
  const b = await c.req.json();
  if (!b.name?.trim()) return c.json({ error: 'Falta el nombre.' }, 400);
  const role = ['queue', 'running', 'done'].includes(b.role) ? b.role : null;
  return c.json(board.addColumn(b.name.trim().slice(0, 40), { role, afterId: b.afterId }));
});
api.patch('/board/columns/:id', async (c) => {
  const b = await c.req.json();
  if (b.move === -1 || b.move === 1) board.moveColumn(c.req.param('id'), b.move);
  else board.updateColumn(c.req.param('id'), b);
  return c.json(board.getBoard());
});
api.delete('/board/columns/:id', (c) => {
  board.deleteColumn(c.req.param('id'));
  return c.json(board.getBoard());
});

// ---------- todos ----------
api.get('/todos', (c) => c.json(board.getTodos()));
api.post('/todos', async (c) => {
  const b = await c.req.json();
  if (!b.text?.trim()) return c.json({ error: 'El todo está vacío.' }, 400);
  return c.json(board.addTodo({ text: b.text.trim(), project: b.project ?? null, source: b.source }));
});
api.patch('/todos/:id', async (c) => c.json(board.updateTodo(c.req.param('id'), await c.req.json()) ?? null));
api.delete('/todos/:id', (c) => {
  board.deleteTodo(c.req.param('id'));
  return c.json({ ok: true });
});

// ---------- agents ----------
api.get('/agents', (c) => c.json(listRuns()));
api.get('/agents/:id', (c) => {
  const r = getRun(c.req.param('id'));
  return r ? c.json(r) : c.json({ error: 'No encontré la corrida.' }, 404);
});
api.post('/agents', async (c) => {
  try {
    const run = createRun(await c.req.json());
    const { log, ...rest } = run;
    return c.json(rest);
  } catch (e: any) {
    return c.json({ error: e.message }, 400);
  }
});
api.post('/agents/:id/stop', (c) => c.json({ ok: stopRun(c.req.param('id')) }));
api.get('/agents/:id/stream', (c) => {
  const run = getRun(c.req.param('id'));
  if (!run) return c.json({ error: 'No encontré la corrida.' }, 404);
  return streamSSE(c, async (stream) => {
    for (const item of run.log) await stream.writeSSE({ event: 'log', data: JSON.stringify(item) });
    const { log, ...rest } = run;
    await stream.writeSSE({ event: 'status', data: JSON.stringify(rest) });
    const queue: any[] = [];
    let wake: (() => void) | null = null;
    const off = subscribe(run.id, (item) => {
      queue.push(item);
      wake?.();
    });
    stream.onAbort(off);
    while (!stream.aborted) {
      if (!queue.length) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, 15_000);
        });
        wake = null;
        if (!queue.length) {
          await stream.writeSSE({ event: 'ping', data: '' });
          continue;
        }
      }
      const item = queue.shift();
      if (item.kind === 'status') await stream.writeSSE({ event: 'status', data: JSON.stringify(item.run) });
      else await stream.writeSSE({ event: 'log', data: JSON.stringify(item) });
    }
    off();
  });
});

// ---------- skills ----------
api.get('/skills', (c) => {
  const dir = path.join(CLAUDE_DIR, 'skills');
  const out: { name: string; description: string }[] = [];
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const f = path.join(dir, name, 'SKILL.md');
    if (!fs.existsSync(f)) continue;
    const head = fs.readFileSync(f, 'utf8').slice(0, 2000);
    const desc = head.match(/^description:\s*(.+)$/m)?.[1] ?? '';
    out.push({ name, description: desc.slice(0, 200) });
  }
  return c.json(out);
});

// ---------- feed ----------
api.get('/feed', (c) => c.json(getFeed()));
api.post('/feed/refresh', (c) => c.json(refreshFeed()));

app.route('/api', api);

// Production: serve the built frontend.
const dist = path.join(ROOT_DIR, 'web/dist');
if (process.env.NODE_ENV === 'production' && fs.existsSync(dist)) {
  const root = path.relative(process.cwd(), dist);
  app.use('/*', serveStatic({ root }));
  app.get('*', serveStatic({ path: path.join(root, 'index.html') }));
}

serve({ fetch: app.fetch, hostname: '127.0.0.1', port: PORT }, (info) => {
  console.log(`claudiopiloto escuchando en http://127.0.0.1:${info.port} (${os.userInfo().username})`);
});

// Warm the session index and the tool list in the background.
setTimeout(() => {
  listSessions();
  discoverTools().catch(() => {});
}, 100);
