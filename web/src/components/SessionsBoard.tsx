import { useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useQueryClient } from '@tanstack/react-query';
import {
  ago,
  api,
  useSessions,
  useSessionBoardLayout,
  useSessionsBoard,
  type BoardSession,
  type SessionBoardLayout,
  type SessionColumn,
  type SessionState,
} from '../api';
import { projectLabel, store, stored, useUi } from '../ui';
import { ColumnDialog } from './ColumnDialog';

export const STATE_LABEL: Record<SessionState, string> = {
  trabajando: 'trabajando',
  pregunta: 'te preguntó',
  esperandote: 'esperándote',
  abierta_sin_uso: 'abierta sin uso',
  cerrada: 'cerrada',
};

const CLOSED_WINDOW_MS = 7 * 86400_000;

const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((h) => String(h.id).startsWith('card:'));
  if (card) return [card];
  if (hits.length) return hits;
  return rectIntersection(args);
};

const byRecent = (a: BoardSession, b: BoardSession) => b.end.localeCompare(a.end);

/** Link that opens a session in the Claude desktop app, or null when there is none. */
export function appLink(s: Pick<BoardSession, 'id' | 'hostSessionId' | 'entrypoint'>): string | null {
  if (s.hostSessionId) return `claude://code/continue?session=${encodeURIComponent(s.hostSessionId)}`;
  if (s.entrypoint !== 'claude-desktop') return `claude://resume?session=${s.id}`;
  return null;
}

export function SessionsBoard() {
  const { project } = useUi();
  const sessions = useSessionsBoard();
  const [mode, setMode] = useState<'state' | 'mine'>(() => stored<'state' | 'mine'>('cp.sessMode', 'state'));
  const setModeStored = (m: 'state' | 'mine') => {
    setMode(m);
    store('cp.sessMode', m);
  };
  const list = useMemo(
    () => (sessions.data ?? []).filter((s) => project === 'all' || s.project === project),
    [sessions.data, project],
  );

  return (
    <section aria-label="Sesiones">
      <div className="section-head">
        <span className="hl">## sesiones</span>
        <span className="actions" role="radiogroup" aria-label="Agrupar por">
          <span className="mut">agrupar por</span>
          <button className={`tab ${mode === 'state' ? 'on' : ''}`} role="radio" aria-checked={mode === 'state'} onClick={() => setModeStored('state')}>
            estado
          </button>
          <button className={`tab ${mode === 'mine' ? 'on' : ''}`} role="radio" aria-checked={mode === 'mine'} onClick={() => setModeStored('mine')}>
            mis columnas
          </button>
        </span>
      </div>
      {sessions.isLoading && <p className="mut">leyendo sesiones…</p>}
      {sessions.data && (mode === 'state' ? <ByState list={list} /> : <MyColumns list={list} />)}
    </section>
  );
}

// ---------- mode A: by real state ----------

function ByState({ list }: { list: BoardSession[] }) {
  const now = Date.now();
  const groups: { name: string; hint: string; items: BoardSession[] }[] = [
    { name: 'trabajando', hint: 'Claude está respondiendo', items: list.filter((s) => s.state === 'trabajando') },
    {
      name: 'esperándote',
      hint: 'terminó o te preguntó algo',
      items: [...list.filter((s) => s.state === 'pregunta').sort(byRecent), ...list.filter((s) => s.state === 'esperandote').sort(byRecent)],
    },
    { name: 'abiertas sin uso', hint: 'abiertas, quietas hace más de 2 h', items: list.filter((s) => s.state === 'abierta_sin_uso').sort(byRecent) },
    {
      name: 'cerradas',
      hint: 'últimos 7 días',
      items: list.filter((s) => s.state === 'cerrada' && now - new Date(s.end).getTime() < CLOSED_WINDOW_MS).sort(byRecent),
    },
  ];
  return (
    <div className="board">
      {groups.map((g) => (
        <div className="col" key={g.name}>
          <div className="col-head">
            <span>
              {g.name} <span className="mut">({g.items.length})</span>
            </span>
          </div>
          <div className="mut" style={{ fontSize: '0.85em' }}>{g.hint}</div>
          {g.items.map((s) => (
            <StaticCard key={s.id} s={s} />
          ))}
        </div>
      ))}
    </div>
  );
}

function StaticCard({ s }: { s: BoardSession }) {
  const { openDrawer } = useUi();
  return (
    <div
      className="card"
      style={{ cursor: 'pointer' }}
      role="button"
      tabIndex={0}
      onClick={() => openDrawer({ kind: 'session', id: s.id })}
      onKeyDown={(e) => e.key === 'Enter' && openDrawer({ kind: 'session', id: s.id })}
    >
      <SessionCardBody s={s} />
    </div>
  );
}

// ---------- mode B: my columns ----------

function MyColumns({ list }: { list: BoardSession[] }) {
  const layout = useSessionBoardLayout();
  const qc = useQueryClient();
  const { openDrawer } = useUi();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ column?: SessionColumn } | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const all = useSessions();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));
  const byId = useMemo(() => new Map(list.map((s) => [s.id, s])), [list]);
  const data = layout.data;
  if (!data) return <p className="mut">cargando columnas…</p>;

  // Sessions not placed by the user show at the top of the first column.
  const placed = new Set(data.columns.flatMap((c) => c.sessionIds));
  const unplaced = list.filter((s) => !placed.has(s.id)).sort(byRecent);
  const columnItems = (col: SessionColumn, i: number) => [
    ...(i === 0 ? unplaced : []),
    ...col.sessionIds.map((id) => byId.get(id)).filter((s): s is BoardSession => !!s),
  ];

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['session-board'] });
    qc.invalidateQueries({ queryKey: ['sessions-board'] });
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    setOverId(null);
    const sessionId = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    let columnId: string;
    let beforeId: string | null = null;
    if (over.startsWith('card:')) {
      beforeId = over.slice(5);
      if (beforeId === sessionId) return;
      const owner = data.columns.find((c) => c.sessionIds.includes(beforeId!));
      if (owner) columnId = owner.id;
      else {
        // Dropped on an unplaced card: it lives in the first column, at the end of the placed ones.
        columnId = data.columns[0].id;
        beforeId = null;
      }
    } else {
      columnId = over.slice(4);
    }
    qc.setQueryData<SessionBoardLayout>(['session-board'], (b) => {
      if (!b) return b;
      const columns = b.columns.map((c) => ({ ...c, sessionIds: c.sessionIds.filter((x) => x !== sessionId) }));
      const to = columns.find((c) => c.id === columnId)!;
      const i = beforeId ? to.sessionIds.indexOf(beforeId) : -1;
      if (i >= 0) to.sessionIds.splice(i, 0, sessionId);
      else to.sessionIds.push(sessionId);
      return { ...b, columns };
    });
    await api('/session-board/move', { method: 'POST', body: { sessionId, columnId, beforeId } }).catch(() => {});
    refresh();
  };

  const hide = async (id: string) => {
    await api(`/session-board/hide/${id}`, { method: 'POST' });
    refresh();
  };

  const active = activeId ? byId.get(activeId) : undefined;
  const hiddenSessions = (all.data ?? []).filter((s) => data.hidden.includes(s.id));
  const unhide = async (id: string) => {
    await api(`/session-board/unhide/${id}`, { method: 'POST' });
    refresh();
  };

  return (
    <>
      <div className="section-head" style={{ justifyContent: 'flex-end' }}>
        {data.hidden.length > 0 && (
          <button className="link" onClick={() => setShowHidden(!showHidden)} aria-expanded={showHidden}>
            [{showHidden ? 'cerrar' : 'ver'} ocultas ({data.hidden.length})]
          </button>
        )}
        <button onClick={() => setDialog({})}>+ columna</button>
      </div>
      {showHidden && (
        <div className="hidden-list">
          {hiddenSessions.map((s) => (
            <div className="todo" key={s.id}>
              <span className="mut">{projectLabel(s.project)}</span> {s.title}
              <button className="link" style={{ marginLeft: 'auto' }} onClick={() => unhide(s.id)}>[restaurar]</button>
            </div>
          ))}
        </div>
      )}
      <DndContext
        sensors={sensors}
        collisionDetection={collision}
        onDragStart={(e) => setActiveId(String(e.active.id))}
        onDragOver={(e) => setOverId(e.over ? String(e.over.id) : null)}
        onDragCancel={() => {
          setActiveId(null);
          setOverId(null);
        }}
        onDragEnd={onDragEnd}
      >
        <div className="board">
          {data.columns.map((col, i) => (
            <MyColumn
              key={col.id}
              col={col}
              items={columnItems(col, i)}
              first={i === 0}
              last={i === data.columns.length - 1}
              overId={overId}
              activeId={activeId}
              onEdit={() => setDialog({ column: col })}
              onRefresh={refresh}
              onOpen={(id) => openDrawer({ kind: 'session', id })}
              onHide={hide}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? (
            <div className="card overlay">
              <SessionCardBody s={active} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
      {dialog && (
        <ColumnDialog
          columns={data.columns}
          column={dialog.column}
          onClose={() => setDialog(null)}
          apiBase="/session-board/columns"
          withRoles={false}
          queryKey="session-board"
        />
      )}
    </>
  );
}

function MyColumn(props: {
  col: SessionColumn;
  items: BoardSession[];
  first: boolean;
  last: boolean;
  overId: string | null;
  activeId: string | null;
  onEdit: () => void;
  onRefresh: () => void;
  onOpen: (id: string) => void;
  onHide: (id: string) => void;
}) {
  const { col } = props;
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  const [tools, setTools] = useState(false);
  const patch = async (body: object) => {
    await api(`/session-board/columns/${col.id}`, { method: 'PATCH', body });
    props.onRefresh();
  };
  const remove = async () => {
    if (!window.confirm(`¿Borrar la columna "${col.name}"? Sus sesiones vuelven a la primera columna.`)) return;
    await api(`/session-board/columns/${col.id}`, { method: 'DELETE' });
    props.onRefresh();
  };
  const overCard = props.items.some((s) => `card:${s.id}` === props.overId);

  return (
    <div ref={setNodeRef} className={`col ${isOver || overCard ? 'over' : ''}`}>
      <div className="col-head">
        <span onDoubleClick={props.onEdit} title="Doble clic para editar">
          {col.name} <span className="mut">({props.items.length})</span>
        </span>
        <button className="link" onClick={() => setTools(!tools)} aria-label={`Opciones de ${col.name}`} aria-expanded={tools}>
          ···
        </button>
      </div>
      {props.first && <div className="mut" style={{ fontSize: '0.85em' }}>acá caen las sesiones nuevas</div>}
      {tools && (
        <div className="col-tools">
          <button onClick={() => patch({ move: -1 })} disabled={props.first} aria-label="Mover a la izquierda">←</button>
          <button onClick={() => patch({ move: 1 })} disabled={props.last} aria-label="Mover a la derecha">→</button>
          <button onClick={props.onEdit}>editar</button>
          <button onClick={remove} className="danger">borrar</button>
        </div>
      )}
      {props.items.map((s) => (
        <DraggableSession
          key={s.id}
          s={s}
          dropBefore={props.overId === `card:${s.id}` && props.activeId !== s.id}
          onOpen={() => props.onOpen(s.id)}
          onHide={() => props.onHide(s.id)}
        />
      ))}
    </div>
  );
}

function DraggableSession({ s, dropBefore, onOpen, onHide }: { s: BoardSession; dropBefore: boolean; onOpen: () => void; onHide: () => void }) {
  const drag = useDraggable({ id: s.id });
  const drop = useDroppable({ id: `card:${s.id}` });
  return (
    <div
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      {...drag.attributes}
      {...drag.listeners}
      className={`card ${drag.isDragging ? 'dragging' : ''} ${dropBefore ? 'drop-before' : ''}`}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
        else drag.listeners?.onKeyDown?.(e);
      }}
    >
      <SessionCardBody s={s} onHide={onHide} />
    </div>
  );
}

// ---------- card ----------

export function SessionCardBody({ s, onHide }: { s: BoardSession; onHide?: () => void }) {
  const link = appLink(s);
  const [copied, setCopied] = useState(false);
  const copyResume = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const cmd = `cd ${JSON.stringify(s.cwd)} && claude --resume ${s.id}`;
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copiá el comando', cmd);
    }
  };
  return (
    <>
      <div className="card-title">{s.title}</div>
      <div className="mut" style={{ fontSize: '0.85em' }}>
        {projectLabel(s.project)}
        {s.branch && ` · ${s.branch}`}
        {s.tickets.length > 0 && ` · ${s.tickets.slice(0, 3).join(' ')}`}
      </div>
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginTop: 3 }}>
        <span className={`st st-${s.state}`}>{STATE_LABEL[s.state]}</span>
        <span className="mut" style={{ fontSize: '0.85em' }}>{ago(s.end)}</span>
      </div>
      {s.state === 'pregunta' && s.pendingQuestion && <div className="question">? {s.pendingQuestion}</div>}
      {s.lastClaudeText && s.state !== 'pregunta' && <div className="last mut">{s.lastClaudeText}</div>}
      <div className="card-actions" onPointerDown={(e) => e.stopPropagation()}>
        {link ? (
          <a href={link} onClick={(e) => e.stopPropagation()} title="Abrir en la app de Claude">
            [abrir]
          </a>
        ) : null}
        <button className="link" onClick={copyResume} title="Copiar el comando para retomarla en la terminal">
          [{copied ? 'copiado' : 'resume'}]
        </button>
        {onHide && (
          <button
            className="link"
            onClick={(e) => {
              e.stopPropagation();
              onHide();
            }}
            title="Sacarla de este tablero (sigue en el historial)"
          >
            [ocultar]
          </button>
        )}
      </div>
    </>
  );
}
