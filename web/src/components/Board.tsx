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
import { api, shortDate, useBoard, useRuns, type Board, type Card, type Column, type Run } from '../api';
import { projectLabel, useUi } from '../ui';
import { ColumnDialog } from './ColumnDialog';
import { CardDialog } from './CardDialog';

const STATUS_LABEL: Record<string, string> = {
  queued: 'en cola',
  running: 'corriendo',
  ok: 'ok',
  error: 'error',
  stopped: 'frenado',
  interrupted: 'interrumpido',
};

const ROLE_LABEL: Record<string, string> = { queue: 'entrada', running: 'al arrancar', done: 'al terminar' };

/** Prefer a card under the pointer, then a column; fall back to rectangle overlap. */
const collision: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  const card = hits.find((h) => String(h.id).startsWith('card:'));
  if (card) return [card];
  if (hits.length) return hits;
  return rectIntersection(args);
};

export function BoardView() {
  const { project, openDrawer, openAgent } = useUi();
  const board = useBoard();
  const runs = useRuns();
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [columnDialog, setColumnDialog] = useState<{ column?: Column } | null>(null);
  const [cardDialog, setCardDialog] = useState(false);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor));

  const runById = useMemo(() => new Map((runs.data ?? []).map((r) => [r.id, r])), [runs.data]);
  const data = board.data;
  if (!data) return <p className="mut">cargando tablero…</p>;

  const visible = (id: string) => {
    const c = data.cards[id];
    return !!c && (project === 'all' || c.project === project);
  };

  const onDragEnd = async (e: DragEndEvent) => {
    setActiveId(null);
    setOverId(null);
    const cardId = String(e.active.id);
    const over = e.over ? String(e.over.id) : null;
    if (!over) return;
    let columnId: string;
    let beforeId: string | null = null;
    if (over.startsWith('card:')) {
      beforeId = over.slice(5);
      if (beforeId === cardId) return;
      columnId = data.columns.find((c) => c.cardIds.includes(beforeId!))!.id;
    } else {
      columnId = over.slice(4);
    }
    // Optimistic move so the card does not jump back while the request runs.
    qc.setQueryData<Board>(['board'], (b) => {
      if (!b) return b;
      const columns = b.columns.map((c) => ({ ...c, cardIds: c.cardIds.filter((x) => x !== cardId) }));
      const to = columns.find((c) => c.id === columnId)!;
      const i = beforeId ? to.cardIds.indexOf(beforeId) : -1;
      if (i >= 0) to.cardIds.splice(i, 0, cardId);
      else to.cardIds.push(cardId);
      return { ...b, columns };
    });
    await api('/board/move', { method: 'POST', body: { cardId, columnId, beforeId } }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['board'] });
  };

  const open = (card: Card) => {
    if (card.type === 'session' && card.refId) openDrawer({ kind: 'session', id: card.refId });
    else if (card.type === 'agent' && card.refId) openDrawer({ kind: 'run', id: card.refId });
    else openDrawer({ kind: 'task', id: card.id });
  };

  const active = activeId ? data.cards[activeId] : null;

  return (
    <section aria-label="Tablero">
      <div className="section-head">
        <span className="hl">## agentes y tareas</span>
        <span className="actions">
          <button onClick={() => openAgent({})}>+ agente</button>
          <button onClick={() => setCardDialog(true)}>+ tarjeta</button>
          <button onClick={() => setColumnDialog({})}>+ columna</button>
        </span>
      </div>
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
            <ColumnView
              key={col.id}
              col={col}
              first={i === 0}
              last={i === data.columns.length - 1}
              cards={col.cardIds.filter(visible).map((id) => data.cards[id])}
              runById={runById}
              overId={overId}
              activeId={activeId}
              onOpen={open}
              onEdit={() => setColumnDialog({ column: col })}
            />
          ))}
        </div>
        <DragOverlay dropAnimation={null}>
          {active ? <CardBody card={active} run={active.refId ? runById.get(active.refId) : undefined} overlay /> : null}
        </DragOverlay>
      </DndContext>
      {cardDialog && <CardDialog columns={data.columns} onClose={() => setCardDialog(false)} />}
      {columnDialog && <ColumnDialog columns={data.columns} column={columnDialog.column} onClose={() => setColumnDialog(null)} />}
    </section>
  );
}

function ColumnView(props: {
  col: Column;
  first: boolean;
  last: boolean;
  cards: Card[];
  runById: Map<string, Run>;
  overId: string | null;
  activeId: string | null;
  onOpen: (c: Card) => void;
  onEdit: () => void;
}) {
  const { col } = props;
  const { setNodeRef, isOver } = useDroppable({ id: `col:${col.id}` });
  const [tools, setTools] = useState(false);
  const qc = useQueryClient();
  const patch = async (body: object) => {
    await api(`/board/columns/${col.id}`, { method: 'PATCH', body });
    qc.invalidateQueries({ queryKey: ['board'] });
  };
  const remove = async () => {
    if (!window.confirm(`¿Borrar la columna "${col.name}"? Sus tarjetas pasan a la columna anterior.`)) return;
    await api(`/board/columns/${col.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['board'] });
  };
  const overCard = props.overId?.startsWith('card:') && props.cards.some((c) => `card:${c.id}` === props.overId);

  return (
    <div ref={setNodeRef} className={`col ${isOver || overCard ? 'over' : ''}`}>
      <div className="col-head">
        <span onDoubleClick={props.onEdit} title="Doble clic para editar">
          {col.name} <span className="mut">({props.cards.length})</span>
        </span>
        <button className="link" onClick={() => setTools(!tools)} aria-label={`Opciones de ${col.name}`} aria-expanded={tools}>
          ···
        </button>
      </div>
      {col.role && <div className="mut" style={{ fontSize: '0.85em' }}>agentes: {ROLE_LABEL[col.role]}</div>}
      {tools && (
        <div className="col-tools">
          <button onClick={() => patch({ move: -1 })} disabled={props.first} aria-label="Mover a la izquierda">←</button>
          <button onClick={() => patch({ move: 1 })} disabled={props.last} aria-label="Mover a la derecha">→</button>
          <button onClick={props.onEdit}>editar</button>
          <button onClick={remove} className="danger">borrar</button>
        </div>
      )}
      {props.cards.map((card) => (
        <DraggableCard
          key={card.id}
          card={card}
          run={card.refId ? props.runById.get(card.refId) : undefined}
          dropBefore={props.overId === `card:${card.id}` && props.activeId !== card.id}
          onOpen={() => props.onOpen(card)}
        />
      ))}
    </div>
  );
}

function DraggableCard({ card, run, dropBefore, onOpen }: { card: Card; run?: Run; dropBefore: boolean; onOpen: () => void }) {
  const drag = useDraggable({ id: card.id });
  const drop = useDroppable({ id: `card:${card.id}` });
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
      <CardBody card={card} run={run} />
    </div>
  );
}

function CardBody({ card, run, overlay }: { card: Card; run?: Run; overlay?: boolean }) {
  const icon = card.type === 'agent' ? '>_' : card.type === 'session' ? '#' : '[]';
  const inner = (
    <>
      <div className="card-title">
        <span className="mut">{icon}</span> {card.title}
      </div>
      <div className="mut" style={{ fontSize: '0.85em' }}>
        {card.project ? projectLabel(card.project) : 'general'} · {shortDate(card.createdAt)}
      </div>
      {card.type === 'agent' && run && <span className={`badge ${run.status}`}>{STATUS_LABEL[run.status]}</span>}
      {card.type === 'task' && card.note && <div className="mut" style={{ fontSize: '0.85em' }}>{card.note.slice(0, 80)}</div>}
    </>
  );
  return overlay ? <div className="card overlay">{inner}</div> : inner;
}
