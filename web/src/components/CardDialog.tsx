import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, useProjects, type Column } from '../api';
import { projectLabel, useUi } from '../ui';

/** Create a task card: title, optional note, project and column. */
export function CardDialog({ columns, onClose }: { columns: Column[]; onClose: () => void }) {
  const { project } = useUi();
  const projects = useProjects();
  const qc = useQueryClient();
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [proj, setProj] = useState(project === 'all' ? '' : project);
  const [columnId, setColumnId] = useState(columns[0]?.id ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => titleRef.current?.focus(), []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return setErr('Poné un título.');
    setBusy(true);
    setErr('');
    try {
      await api('/board/cards', {
        method: 'POST',
        body: { type: 'task', title: title.trim(), note: note.trim() || undefined, project: proj || null, columnId },
      });
      qc.invalidateQueries({ queryKey: ['board'] });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="overlay"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Nueva tarjeta" onSubmit={submit} style={{ width: 'min(480px, 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="hl">&gt; nueva tarjeta</span>
          <button type="button" className="link" onClick={onClose} aria-label="Cerrar">[x]</button>
        </div>

        <div className="field">
          <label htmlFor="card-title" className="mut">título</label>
          <input
            id="card-title"
            ref={titleRef}
            value={title}
            maxLength={120}
            onChange={(e) => {
              setTitle(e.target.value);
              setErr('');
            }}
            placeholder="revisar PR de child projects"
          />
        </div>

        <div className="field">
          <label htmlFor="card-note" className="mut">nota (opcional)</label>
          <textarea
            id="card-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="links, contexto, próximos pasos"
            style={{ minHeight: 80 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e as any);
            }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div className="field">
            <label htmlFor="card-project" className="mut">proyecto</label>
            <select id="card-project" value={proj} onChange={(e) => setProj(e.target.value)}>
              <option value="">general</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>{projectLabel(p.id)}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="card-column" className="mut">columna</label>
            <select id="card-column" value={columnId} onChange={(e) => setColumnId(e.target.value)}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>

        {err && <div className="err">{err}</div>}
        <div className="btns" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>cancelar</button>
          <button type="submit" disabled={busy} className="hl">crear tarjeta</button>
        </div>
      </form>
    </div>
  );
}
