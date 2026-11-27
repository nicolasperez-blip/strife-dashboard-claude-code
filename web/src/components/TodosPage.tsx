import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ago, api, useProjects, useTodos, type Todo } from '../api';
import { projectLabel, store, stored, useUi } from '../ui';

type Filter = 'open' | 'done' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'open', label: 'pendientes' },
  { id: 'done', label: 'hechos' },
  { id: 'all', label: 'todos' },
];

const pend = (n: number) => `${n} pendiente${n === 1 ? '' : 's'}`;

/** Key for todos without a project. */
const GENERAL = '';

/** Full-page list of todos, one group per project. */
export function TodosPage() {
  const { project } = useUi();
  const todos = useTodos();
  const projects = useProjects();
  const [filter, setFilter] = useState<Filter>(() => stored<Filter>('cp.todoFilter', 'open'));
  const [query, setQuery] = useState('');
  const setFilterStored = (f: Filter) => {
    setFilter(f);
    store('cp.todoFilter', f);
  };

  const all = todos.data ?? [];
  const projectIds = useMemo(() => {
    const ids = (projects.data ?? []).map((p) => p.id);
    for (const t of all) if (t.project && !ids.includes(t.project)) ids.push(t.project);
    return ids;
  }, [projects.data, all]);

  const q = query.trim().toLowerCase();
  const visible = (t: Todo) =>
    (filter === 'all' || (filter === 'open' ? !t.done : t.done)) &&
    (!q || t.text.toLowerCase().includes(q) || projectLabel(t.project ?? 'general').toLowerCase().includes(q));

  // With a project tab selected, show only that project, even with no todos yet.
  // Otherwise show "general" and every project that has something to show.
  const keys = project === 'all' ? [GENERAL, ...projectIds] : [project];
  const groups = keys
    .map((key) => {
      const own = all.filter((t) => (t.project ?? GENERAL) === key);
      const items = own.filter(visible).sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt);
      return { key, items, open: own.filter((t) => !t.done).length };
    })
    .filter((g) => project !== 'all' || g.items.length > 0 || (g.key === GENERAL && !q && filter === 'open'));

  const openTotal = all.filter((t) => !t.done && (project === 'all' || t.project === project)).length;

  return (
    <section aria-label="Todos por proyecto">
      <div className="section-head">
        <span className="hl">
          ## todo <span className="mut">({pend(openTotal)})</span>
        </span>
        <span className="actions">
          <span role="radiogroup" aria-label="Mostrar">
            {FILTERS.map((f) => (
              <button key={f.id} className={`tab ${filter === f.id ? 'on' : ''}`} role="radio" aria-checked={filter === f.id} onClick={() => setFilterStored(f.id)}>
                {f.label}
              </button>
            ))}
          </span>
          <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="buscar" aria-label="Buscar todos" className="todo-search" />
        </span>
      </div>

      {todos.isLoading && <p className="mut">leyendo todos…</p>}
      {todos.data && groups.length === 0 && <p className="mut">{q ? 'Nada coincide con la búsqueda.' : 'No hay todos para mostrar.'}</p>}

      <div className="todo-groups">
        {groups.map((g) => (
          <TodoGroup key={g.key || 'general'} projectId={g.key} items={g.items} open={g.open} projectIds={projectIds} />
        ))}
      </div>
    </section>
  );
}

function TodoGroup({ projectId, items, open, projectIds }: { projectId: string; items: Todo[]; open: number; projectIds: string[] }) {
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const name = projectId ? projectLabel(projectId) : 'general';

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api('/todos', { method: 'POST', body: { text: text.trim(), project: projectId || null } });
    setText('');
    qc.invalidateQueries({ queryKey: ['todos'] });
  };

  return (
    <section className="todo-group" aria-label={`Todos de ${name}`}>
      <div className="todo-group-head">
        <span className="h2">{name}</span>
        <span className="mut">{pend(open)}</span>
      </div>
      {items.length === 0 && <p className="mut" style={{ margin: '4px 0' }}>Sin todos.</p>}
      {items.map((t) => (
        <TodoRow key={t.id} todo={t} projectIds={projectIds} />
      ))}
      <form className="inline-form" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="nuevo todo" aria-label={`Nuevo todo en ${name}`} />
        <button type="submit">+</button>
      </form>
    </section>
  );
}

function TodoRow({ todo: t, projectIds }: { todo: Todo; projectIds: string[] }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(t.text);
  const [proj, setProj] = useState(t.project ?? GENERAL);

  const patch = async (body: Partial<Pick<Todo, 'text' | 'done' | 'project'>>) => {
    qc.setQueryData(['todos'], (old: Todo[] | undefined) => old?.map((x) => (x.id === t.id ? { ...x, ...body } : x)));
    await api(`/todos/${t.id}`, { method: 'PATCH', body });
    qc.invalidateQueries({ queryKey: ['todos'] });
  };
  const remove = async () => {
    await api(`/todos/${t.id}`, { method: 'DELETE' });
    qc.invalidateQueries({ queryKey: ['todos'] });
  };
  const startEdit = () => {
    setText(t.text);
    setProj(t.project ?? GENERAL);
    setEditing(true);
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setEditing(false);
    await patch({ text: text.trim(), project: proj || null });
  };

  if (editing) {
    return (
      <form
        className="todo-edit"
        onSubmit={save}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setEditing(false);
          }
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Texto del todo" autoFocus />
        <select value={proj} onChange={(e) => setProj(e.target.value)} aria-label="Proyecto">
          <option value={GENERAL}>general</option>
          {projectIds.map((id) => (
            <option key={id} value={id}>{projectLabel(id)}</option>
          ))}
        </select>
        <button type="submit" className="hl">guardar</button>
        <button type="button" onClick={() => setEditing(false)}>cancelar</button>
      </form>
    );
  }

  return (
    <div className="todo todo-row">
      <input type="checkbox" id={`tp-${t.id}`} checked={t.done} onChange={(e) => patch({ done: e.target.checked })} />
      <label htmlFor={`tp-${t.id}`} className={t.done ? 'mut' : ''} style={t.done ? { textDecoration: 'line-through' } : undefined}>
        {t.text}
        {t.source && (
          <>
            {' '}
            <a href={t.source.url} target="_blank" rel="noreferrer" className="mut" onClick={(e) => e.stopPropagation()} title={t.source.label}>
              ↗
            </a>
          </>
        )}
      </label>
      <span className="mut todo-age">{ago(t.createdAt)}</span>
      <button className="link x" onClick={startEdit} aria-label={`Editar ${t.text}`}>editar</button>
      <button className="link x" onClick={remove} aria-label={`Borrar ${t.text}`}>×</button>
    </div>
  );
}
