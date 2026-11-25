import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, shortDate, useSessions, useSessionsBoard } from '../api';
import { projectLabel, useUi } from '../ui';
import { trashSessionWithConfirm } from '../sessionActions';

const PAGE = 25;

export function HistoryList() {
  const { project, openDrawer } = useUi();
  const sessions = useSessions();
  const board = useSessionsBoard();
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);

  const stateById = useMemo(() => new Map((board.data ?? []).map((b) => [b.id, b.state])), [board.data]);
  const isOpen = (id: string) => (stateById.get(id) ?? 'cerrada') !== 'cerrada';
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (sessions.data ?? []).filter(
      (s) =>
        (project === 'all' || s.project === project) &&
        (!needle || `${s.title} ${s.firstPrompt} ${s.branch}`.toLowerCase().includes(needle)),
    );
  }, [sessions.data, project, q]);

  const addToBoard = async (id: string, title: string, proj: string) => {
    await api('/board/cards', { method: 'POST', body: { type: 'session', title, project: proj, refId: id } });
    qc.invalidateQueries({ queryKey: ['board'] });
  };

  return (
    <section className="history" aria-label="Historial">
      <div className="section-head">
        <span className="hl">## historial <span className="mut">({list.length})</span></span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="buscar título, prompt o rama" aria-label="Buscar en el historial" style={{ width: 240 }} />
      </div>
      {sessions.isLoading && <p className="mut">leyendo transcripts…</p>}
      {list.slice(0, limit).map((s) => (
        <div
          key={s.id}
          className="row"
          role="button"
          tabIndex={0}
          onClick={() => openDrawer({ kind: 'session', id: s.id })}
          onKeyDown={(e) => e.key === 'Enter' && openDrawer({ kind: 'session', id: s.id })}
        >
          <span className="mut">{shortDate(s.end)}</span>
          <span className="t">
            {stateById.get(s.id) === 'trabajando' && <span className="live-dot" title="Claude está trabajando">● </span>}
            {stateById.get(s.id) === 'pregunta' && <span className="question" title="Te hizo una pregunta">? </span>}
            {s.title}
          </span>
          <span className="p mut">
            {project === 'all' ? projectLabel(s.project) : s.branch || '-'}
          </span>
          <span style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button
              className="link"
              title="Agregar al tablero"
              aria-label={`Agregar ${s.title} al tablero`}
              onClick={(e) => {
                e.stopPropagation();
                addToBoard(s.id, s.title, s.project);
              }}
            >
              +
            </button>
            {!isOpen(s.id) && (
              <button
                className="link"
                title="Eliminar sesión"
                aria-label={`Eliminar ${s.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  trashSessionWithConfirm(s, qc);
                }}
              >
                ×
              </button>
            )}
          </span>
        </div>
      ))}
      {list.length > limit && (
        <button className="link" style={{ marginTop: 6 }} onClick={() => setLimit(limit + PAGE)}>
          [ver {Math.min(PAGE, list.length - limit)} más]
        </button>
      )}
      {!sessions.isLoading && !list.length && <p className="mut">Sin sesiones para este filtro.</p>}
    </section>
  );
}
