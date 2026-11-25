import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../api';

type ColumnLike = { id: string; name: string; role?: string };

const ROLES = [
  { id: '', label: 'sin rol', hint: 'solo la movés vos' },
  { id: 'queue', label: 'entrada', hint: 'acá caen los agentes nuevos' },
  { id: 'running', label: 'al arrancar', hint: 'acá pasan cuando empiezan a correr' },
  { id: 'done', label: 'al terminar', hint: 'acá pasan cuando terminan' },
] as const;

/**
 * Create a column, or edit one when `column` is given. Used by the agents board
 * (with roles) and by the sessions board (`apiBase="/session-board/columns"`, no roles).
 */
export function ColumnDialog({
  columns,
  column,
  onClose,
  apiBase = '/board/columns',
  withRoles = true,
  queryKey = 'board',
}: {
  columns: ColumnLike[];
  column?: ColumnLike;
  onClose: () => void;
  apiBase?: string;
  withRoles?: boolean;
  queryKey?: string;
}) {
  const qc = useQueryClient();
  const editing = !!column;
  const [name, setName] = useState(column?.name ?? '');
  const [role, setRole] = useState<string>(column?.role ?? '');
  const [afterId, setAfterId] = useState(columns[columns.length - 1]?.id ?? '');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    nameRef.current?.focus();
    nameRef.current?.select();
  }, []);

  const roleOwner = role ? columns.find((c) => c.role === role && c.id !== column?.id) : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setErr('Poné un nombre.');
    if (columns.some((c) => c.id !== column?.id && c.name.toLowerCase() === clean.toLowerCase())) {
      return setErr('Ya hay una columna con ese nombre.');
    }
    setBusy(true);
    setErr('');
    try {
      if (editing) {
        await api(`${apiBase}/${column!.id}`, { method: 'PATCH', body: withRoles ? { name: clean, role: role || null } : { name: clean } });
      } else {
        await api(apiBase, { method: 'POST', body: { name: clean, role: withRoles ? role || null : undefined, afterId: afterId || undefined } });
      }
      qc.invalidateQueries({ queryKey: [queryKey] });
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
      <form className="dialog" role="dialog" aria-modal="true" aria-label={editing ? 'Editar columna' : 'Nueva columna'} onSubmit={submit} style={{ width: 'min(440px, 100%)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="hl">&gt; {editing ? 'editar columna' : 'nueva columna'}</span>
          <button type="button" className="link" onClick={onClose} aria-label="Cerrar">[x]</button>
        </div>

        <div className="field">
          <label htmlFor="col-name" className="mut">nombre</label>
          <input
            id="col-name"
            ref={nameRef}
            value={name}
            maxLength={40}
            onChange={(e) => {
              setName(e.target.value);
              setErr('');
            }}
            placeholder="bloqueado"
          />
        </div>

        {!editing && (
          <div className="field">
            <label htmlFor="col-after" className="mut">ubicación</label>
            <select id="col-after" value={afterId} onChange={(e) => setAfterId(e.target.value)}>
              {columns.map((c) => (
                <option key={c.id} value={c.id}>después de "{c.name}"</option>
              ))}
            </select>
          </div>
        )}

        {withRoles && (<div className="field">
          <span className="mut">rol para agentes</span>
          <div role="radiogroup" aria-label="Rol para agentes" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {ROLES.map((r) => (
              <label key={r.id}>
                <input type="radio" name="col-role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} /> {r.label}{' '}
                <span className="mut">({r.hint})</span>
              </label>
            ))}
          </div>
          {roleOwner && (
            <span className="mut" style={{ fontSize: '0.85em' }}>
              "{roleOwner.name}" tiene este rol ahora y lo va a perder.
            </span>
          )}
        </div>)}

        {err && <div className="err">{err}</div>}
        <div className="btns" style={{ marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>cancelar</button>
          <button type="submit" disabled={busy} className="hl">{editing ? 'guardar' : 'crear columna'}</button>
        </div>
      </form>
    </div>
  );
}
