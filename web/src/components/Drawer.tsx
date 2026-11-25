import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import Markdown from 'react-markdown';
import {
  ago,
  api,
  compact,
  duration,
  shortDate,
  useBoard,
  useProjects,
  type LogItem,
  type Run,
  type SessionDetail,
  type Summary,
} from '../api';
import { projectLabel, useUi, type DrawerTarget } from '../ui';
import { trashSessionWithConfirm } from '../sessionActions';
import { STATE_LABEL, appLink } from './SessionsBoard';
import { useResizable } from '../useResizable';

const DRAWER_MAX = () => Math.max(400, window.innerWidth - 120);

export function Drawer({ target, onClose }: { target: NonNullable<DrawerTarget>; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useResizable('cp.drawerW', 560, 360, DRAWER_MAX);
  useEffect(() => ref.current?.focus(), [target]);
  const w = `min(${size.width}px, 100vw)`;
  return (
    <>
      <div
        className="resize-handle drawer-handle"
        style={{ right: w }}
        role="separator"
        aria-orientation="vertical"
        aria-label="Ajustar el ancho del detalle"
        aria-valuenow={size.width}
        tabIndex={0}
        onPointerDown={size.onPointerDown}
        onKeyDown={size.onKeyDown}
      />
      <div className="drawer" role="dialog" aria-modal="false" aria-label="Detalle" tabIndex={-1} ref={ref} style={{ width: w }}>
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="link" onClick={onClose} aria-label="Cerrar">[x]</button>
        </div>
        {target.kind === 'session' && <SessionView id={target.id} onDeleted={onClose} />}
        {target.kind === 'run' && <RunView id={target.id} />}
        {target.kind === 'task' && <TaskView id={target.id} onDeleted={onClose} />}
      </div>
    </>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          window.prompt('Copiá el comando', text);
        }
      }}
    >
      {done ? 'copiado' : label}
    </button>
  );
}

function SessionView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const { openAgent } = useUi();
  const qc = useQueryClient();
  const detail = useQuery({ queryKey: ['session', id], queryFn: () => api<SessionDetail>(`/sessions/${id}`) });
  const summary = useQuery({
    queryKey: ['summary', id],
    queryFn: () => api<Summary>(`/sessions/${id}/summary`),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 2000 : false),
  });
  const asked = useRef(false);

  const generate = async () => {
    await api(`/sessions/${id}/summary`, { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['summary', id] });
  };

  // Generate the summary the first time a session is opened (or when its format is outdated).
  useEffect(() => {
    if (summary.data?.status === 'none' && !asked.current) {
      asked.current = true;
      generate();
    }
  }, [summary.data?.status]);

  const s = detail.data;
  if (detail.isError) return <p className="err">No encontré la sesión.</p>;
  if (!s) return <p className="mut">cargando…</p>;
  const isLive = s.state !== 'cerrada';
  const totalTokens = s.tokens.input + s.tokens.output + s.tokens.cacheRead + s.tokens.cacheCreate;
  const sum = summary.data;

  const addTodo = async () => {
    await api('/todos', { method: 'POST', body: { text: `Seguir: ${s.title}`, project: s.project } });
    qc.invalidateQueries({ queryKey: ['todos'] });
  };
  const addCard = async () => {
    await api('/board/cards', { method: 'POST', body: { type: 'session', title: s.title, project: s.project, refId: s.id } });
    qc.invalidateQueries({ queryKey: ['board'] });
  };
  const remove = async () => {
    if (await trashSessionWithConfirm(s, qc)) onDeleted();
  };

  return (
    <article>
      <div className="hl" style={{ fontSize: '1.15em' }}>&gt; {s.title}</div>
      <div className="mut">
        {projectLabel(s.project)} · {s.branch || 'sin rama'} · {shortDate(s.start)} → {shortDate(s.end)}
      </div>
      <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className={`st st-${s.state}`}>{STATE_LABEL[s.state]}</span>
        {s.tickets.length > 0 && <span className="mut">{s.tickets.join(' ')}</span>}
        {appLink(s) && <a href={appLink(s)!} className="mut">[abrir en la app]</a>}
      </div>
      {s.state === 'pregunta' && s.pendingQuestion && <div className="question">? {s.pendingQuestion}</div>}
      <div className="btns" style={{ marginTop: 10 }}>
        <CopyButton text={`cd ${JSON.stringify(s.cwd)} && claude --resume ${s.id}`} label="copiar claude --resume" />
        <button onClick={() => openAgent({ cwd: s.cwd, resume: s.id, title: `seguir: ${s.title}`, prompt: '' })}>seguir como agente</button>
        <button onClick={addTodo}>crear todo</button>
        <button onClick={addCard}>agregar al tablero</button>
        <button onClick={remove} className="danger" disabled={isLive} title={isLive ? 'Cerrá la sesión en Claude para poder eliminarla' : undefined}>
          eliminar sesión
        </button>
      </div>
      <hr className="sep" />

      {(sum?.status === 'running' || sum?.status === 'none' || !sum) && (
        <p className="mut" style={{ marginTop: 14 }}>generando el documento de la sesión…</p>
      )}
      {sum?.status === 'error' && (
        <p className="err" style={{ marginTop: 14 }}>
          No pude generar el documento: {sum.error} <button className="link" onClick={generate}>[reintentar]</button>
        </p>
      )}
      {sum?.status === 'ready' && (
        <>
          <div className="md">
            <Markdown>{sum.markdown}</Markdown>
          </div>
          <div className="mut" style={{ fontSize: '0.85em', marginTop: 6 }}>
            generado {ago(sum.generatedAt)}
            {sum.stale && ' · la sesión siguió después'} ·{' '}
            <button className="link" onClick={generate}>[regenerar]</button>
          </div>
        </>
      )}

      <details className="tech">
        <summary>detalles técnicos</summary>
        <div className="kv" style={{ marginTop: 8 }}>
          <span>modelo</span>
          <span>{s.models.join(', ') || '-'}</span>
          <span>tokens</span>
          <span>
            {compact(totalTokens)} <span className="mut">(in {compact(s.tokens.input)} · out {compact(s.tokens.output)} · cache {compact(s.tokens.cacheRead + s.tokens.cacheCreate)})</span>
          </span>
          <span>duración</span>
          <span>{duration(new Date(s.end).getTime() - new Date(s.start).getTime())}</span>
          <span>turnos</span>
          <span>{s.userTurns} prompts · {s.assistantTurns} respuestas</span>
          <span>subagentes</span>
          <span>{s.subagents}</span>
          <span>origen</span>
          <span>{s.entrypoint || '-'}</span>
          <span>carpeta</span>
          <span style={{ overflowWrap: 'anywhere' }}>{s.cwd}</span>
          <span>id</span>
          <span style={{ overflowWrap: 'anywhere' }}>{s.id}</span>
          <span>tools</span>
          <span>{s.tools.filter((t) => !t.startsWith('mcp__ccd')).join(', ') || '-'}</span>
        </div>
        {s.files.length > 0 && (
          <>
            <div className="mut" style={{ marginTop: 10 }}>archivos editados ({s.files.length})</div>
            <div className="files">
              {s.files.map((f) => (
                <div key={f}>{f.replace(s.cwd + '/', '')}</div>
              ))}
            </div>
          </>
        )}
        <div className="mut" style={{ marginTop: 10 }}>prompts ({s.prompts.length})</div>
        {s.prompts.map((p, i) => (
          <div key={i} style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>
            <span className="mut">{p.ts ? shortDate(p.ts) : ''} &gt;</span> {p.text.slice(0, 400)}
          </div>
        ))}
      </details>
    </article>
  );
}

const STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  running: 'corriendo',
  ok: 'terminó ok',
  error: 'terminó con error',
  stopped: 'frenado',
  interrupted: 'interrumpido (se reinició el servidor)',
};

function RunView({ id }: { id: string }) {
  const { openDrawer } = useUi();
  const qc = useQueryClient();
  const [run, setRun] = useState<Run | null>(null);
  const [log, setLog] = useState<LogItem[]>([]);
  const [missing, setMissing] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setLog([]);
    setRun(null);
    setMissing(false);
    const es = new EventSource(`/api/agents/${id}/stream`);
    es.addEventListener('log', (e) => setLog((l) => [...l, JSON.parse((e as MessageEvent).data)]));
    es.addEventListener('status', (e) => {
      setRun(JSON.parse((e as MessageEvent).data));
      qc.invalidateQueries({ queryKey: ['runs'] });
      qc.invalidateQueries({ queryKey: ['board'] });
    });
    es.onerror = () => {
      if (!run) api(`/agents/${id}`).catch(() => setMissing(true));
    };
    return () => es.close();
  }, [id]);

  useEffect(() => {
    const el = logRef.current;
    if (el && el.scrollHeight - el.scrollTop - el.clientHeight < 80) el.scrollTop = el.scrollHeight;
  }, [log]);

  if (missing) return <p className="err">No encontré la corrida.</p>;
  if (!run) return <p className="mut">conectando…</p>;
  const active = run.status === 'running' || run.status === 'queued';

  const stop = async () => {
    await api(`/agents/${id}/stop`, { method: 'POST' });
  };
  const removeCard = async () => {
    if (!window.confirm('¿Sacar esta tarjeta del tablero? La corrida y su sesión quedan en el historial.')) return;
    await api(`/board/cards/${run.cardId}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['board'] });
  };

  return (
    <article>
      <div className="hl" style={{ fontSize: '1.15em' }}>&gt; {run.title}</div>
      <div className="mut">
        {projectLabel(run.project)} · {run.model} · {run.permissionMode}
        {run.resume && ' · continúa una sesión'}
      </div>
      <div style={{ marginTop: 6 }}>
        <span className={`badge ${run.status}`}>{STATUS_LABEL[run.status]}</span>
        {run.startedAt && (
          <span className="mut"> · {duration((run.endedAt ?? Date.now()) - run.startedAt)}</span>
        )}
      </div>

      <h3 className="h2">## prompt</h3>
      <div style={{ whiteSpace: 'pre-wrap' }} className="mut">{run.prompt}</div>

      <h3 className="h2">## salida {active && <span className="mut">(en vivo)</span>}</h3>
      <div className="log" ref={logRef} aria-live="polite">
        {log.length === 0 && <span className="mut">esperando…</span>}
        {log.map((l, i) => (
          <div key={i} className={l.kind}>
            {l.kind === 'tool' ? `  -> ${l.text}` : l.text}
          </div>
        ))}
      </div>

      <h3 className="h2">## acciones</h3>
      <div className="btns">
        {active && <button onClick={stop} className="danger">frenar</button>}
        {run.sessionId && !active && (
          <button onClick={() => openDrawer({ kind: 'session', id: run.sessionId! })}>ver sesión y resumen</button>
        )}
        {run.sessionId && <CopyButton text={`cd ${JSON.stringify(run.cwd)} && claude --resume ${run.sessionId}`} label="copiar claude --resume" />}
        <button onClick={removeCard}>sacar del tablero</button>
      </div>
    </article>
  );
}

function TaskView({ id, onDeleted }: { id: string; onDeleted: () => void }) {
  const board = useBoard();
  const projects = useProjects();
  const qc = useQueryClient();
  const card = board.data?.cards[id];
  const [title, setTitle] = useState(card?.title ?? '');
  const [note, setNote] = useState(card?.note ?? '');
  const [saved, setSaved] = useState(true);
  useEffect(() => {
    if (card) {
      setTitle(card.title);
      setNote(card.note ?? '');
    }
  }, [card?.id]);
  if (!card) return <p className="mut">La tarjeta ya no existe.</p>;

  const save = async (patch: object) => {
    await api(`/board/cards/${id}`, { method: 'PATCH', body: patch });
    setSaved(true);
    qc.invalidateQueries({ queryKey: ['board'] });
  };
  const remove = async () => {
    if (!window.confirm(`¿Borrar la tarjeta "${card.title}"?`)) return;
    await api(`/board/cards/${id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['board'] });
    onDeleted();
  };

  return (
    <article>
      <div className="hl" style={{ fontSize: '1.15em' }}>&gt; tarjeta</div>
      <div className="field">
        <label htmlFor="task-title" className="mut">título</label>
        <input id="task-title" value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} onBlur={() => title.trim() && save({ title: title.trim() })} />
      </div>
      <div className="field">
        <label htmlFor="task-project" className="mut">proyecto</label>
        <select id="task-project" value={card.project ?? ''} onChange={(e) => save({ project: e.target.value || null })}>
          <option value="">general</option>
          {(projects.data ?? []).map((p) => (
            <option key={p.id} value={p.id}>{projectLabel(p.id)}</option>
          ))}
        </select>
      </div>
      <div className="field">
        <label htmlFor="task-note" className="mut">nota {saved ? '' : '(sin guardar)'}</label>
        <textarea id="task-note" className="notes" style={{ minHeight: 160 }} value={note} onChange={(e) => { setNote(e.target.value); setSaved(false); }} onBlur={() => save({ note })} />
      </div>
      <div className="btns">
        <button onClick={remove} className="danger">borrar tarjeta</button>
      </div>
    </article>
  );
}
