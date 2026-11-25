import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ago, api, useFeed, useProjects, useTodos, type FeedItem, type Project, type ProjectExtras } from '../api';
import { projectLabel, useUi } from '../ui';

/** Notes for the "todos" tab live under this key. */
const GENERAL = '_general';

export function SidePanel() {
  const { project } = useUi();
  const projects = useProjects();
  const current = projects.data?.find((p) => p.id === project);
  return (
    <aside className="side" aria-label="Panel lateral">
      <TodoBox />
      <NotesBox key={project} projectId={project === 'all' ? GENERAL : project} />
      <FeedBox />
      {current && <LinksBox project={current} />}
      {current && <SavedAgentsBox project={current} />}
    </aside>
  );
}

function usePatchExtras(projectId: string) {
  const qc = useQueryClient();
  return async (patch: Partial<ProjectExtras>) => {
    const next = await api<ProjectExtras>(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: patch });
    qc.setQueryData(['extras', projectId], next);
    qc.invalidateQueries({ queryKey: ['projects'] });
  };
}

function TodoBox() {
  const { project } = useUi();
  const todos = useTodos();
  const qc = useQueryClient();
  const [text, setText] = useState('');
  const [showDone, setShowDone] = useState(false);
  const refresh = () => qc.invalidateQueries({ queryKey: ['todos'] });
  const list = (todos.data ?? []).filter((t) => project === 'all' || t.project === project);
  const open = list.filter((t) => !t.done);
  const done = list.filter((t) => t.done);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    await api('/todos', { method: 'POST', body: { text, project: project === 'all' ? null : project } });
    setText('');
    refresh();
  };
  const toggle = async (id: string, value: boolean) => {
    qc.setQueryData(['todos'], (old: any[] | undefined) => old?.map((t) => (t.id === id ? { ...t, done: value } : t)));
    await api(`/todos/${id}`, { method: 'PATCH', body: { done: value } });
    refresh();
  };
  const remove = async (id: string) => {
    await api(`/todos/${id}`, { method: 'DELETE' });
    refresh();
  };

  const item = (t: (typeof list)[number]) => (
    <div className="todo" key={t.id}>
      <input type="checkbox" id={t.id} checked={t.done} onChange={(e) => toggle(t.id, e.target.checked)} />
      <label htmlFor={t.id} className={t.done ? 'mut' : ''} style={t.done ? { textDecoration: 'line-through' } : undefined}>
        {t.text}
        {project === 'all' && t.project && <span className="mut"> · {projectLabel(t.project)}</span>}
        {t.source && (
          <>
            {' '}
            <a href={t.source.url} target="_blank" rel="noreferrer" className="mut" onClick={(e) => e.stopPropagation()}>
              ↗
            </a>
          </>
        )}
      </label>
      <button className="link x" onClick={() => remove(t.id)} aria-label={`Borrar ${t.text}`}>×</button>
    </div>
  );

  return (
    <section>
      <div className="hl">## todo <span className="mut">({open.length})</span></div>
      {open.map(item)}
      <form className="inline-form" onSubmit={add}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="revisar PR SKPT-247" aria-label="Nuevo todo" />
        <button type="submit">+</button>
      </form>
      {done.length > 0 && (
        <button className="link" style={{ marginTop: 6 }} onClick={() => setShowDone(!showDone)}>
          [{showDone ? 'ocultar' : 'ver'} {done.length} hechos]
        </button>
      )}
      {showDone && done.map(item)}
    </section>
  );
}

function NotesBox({ projectId }: { projectId: string }) {
  const extras = useQuery({
    queryKey: ['extras', projectId],
    queryFn: () => api<ProjectExtras>(`/projects/${encodeURIComponent(projectId)}/extras`),
    staleTime: Infinity,
  });
  const patch = usePatchExtras(projectId);
  const [text, setText] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const value = text ?? extras.data?.notes ?? '';
  const onChange = (v: string) => {
    setText(v);
    setSaved(false);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      await patch({ notes: v });
      setSaved(true);
    }, 600);
  };

  return (
    <section>
      <div className="hl">
        ## notas <span className="mut" style={{ fontSize: '0.85em' }}>{saved ? '' : 'guardando…'}</span>
      </div>
      <textarea
        className="notes"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={projectId === GENERAL ? 'notas generales' : `notas de ${projectLabel(projectId)}`}
        aria-label="Notas"
      />
    </section>
  );
}

function FeedBox() {
  const { project } = useUi();
  const feed = useFeed();
  const qc = useQueryClient();
  const f = feed.data;
  const items = (f?.items ?? []).filter((i) => project === 'all' || !i.project || i.project === project);

  const refresh = async () => {
    await api('/feed/refresh', { method: 'POST' });
    qc.invalidateQueries({ queryKey: ['feed'] });
  };
  const toTodo = async (i: FeedItem) => {
    await api('/todos', {
      method: 'POST',
      body: { text: i.title, project: i.project ?? (project === 'all' ? null : project), source: { label: i.source, url: i.url } },
    });
    qc.invalidateQueries({ queryKey: ['todos'] });
  };

  return (
    <section>
      <div className="section-head" style={{ margin: 0 }}>
        <span className="hl">## novedades</span>
        <button className="link" onClick={refresh} disabled={f?.status === 'running'}>
          [{f?.status === 'running' ? 'buscando…' : 'actualizar'}]
        </button>
      </div>
      <div className="mut" style={{ fontSize: '0.85em' }}>actualizado {ago(f?.updatedAt)}</div>
      {f?.status === 'error' && <div className="err">No pude traer novedades: {f.error}</div>}
      {items.slice(0, 20).map((i, n) => (
        <div className="feed-item" key={`${i.url}-${n}`}>
          <div>
            <span className="h2">{i.source}</span> <span className="mut">{i.kind}</span>{' '}
            <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
          </div>
          <div className="mut">{i.summary}</div>
          <div className="mut" style={{ fontSize: '0.85em' }}>
            {ago(i.when)} ·{' '}
            <button className="link" onClick={() => toTodo(i)}>[+ todo]</button>
          </div>
        </div>
      ))}
      {f && !items.length && f.status !== 'running' && <p className="mut">Sin novedades para mostrar.</p>}
    </section>
  );
}

function LinksBox({ project }: { project: Project }) {
  const patch = usePatchExtras(project.id);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [err, setErr] = useState('');
  const links = project.extras.links;

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!/^https?:\/\//.test(url.trim())) return setErr('Pegá un link que empiece con http:// o https://');
    setErr('');
    await patch({ links: [...links, { label: label.trim() || url.trim(), url: url.trim() }] });
    setLabel('');
    setUrl('');
  };

  return (
    <section>
      <div className="hl">## links y tickets</div>
      {links.map((l, i) => (
        <div className="todo" key={`${l.url}-${i}`}>
          <a href={l.url} target="_blank" rel="noreferrer">{l.label}</a>
          <button className="link x" onClick={() => patch({ links: links.filter((_, j) => j !== i) })} aria-label={`Borrar ${l.label}`}>×</button>
        </div>
      ))}
      <form onSubmit={add}>
        <div className="inline-form">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="SKPT-247" aria-label="Nombre del link" />
        </div>
        <div className="inline-form">
          <input value={url} onChange={(e) => { setUrl(e.target.value); setErr(''); }} placeholder="https://..." aria-label="URL" />
          <button type="submit">+</button>
        </div>
        {err && <div className="err">{err}</div>}
      </form>
    </section>
  );
}

function SavedAgentsBox({ project }: { project: Project }) {
  const { openAgent } = useUi();
  const patch = usePatchExtras(project.id);
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const agents = project.extras.savedAgents;

  const launch = async (a: (typeof agents)[number]) => {
    setBusy(a.id);
    setErr('');
    try {
      await api('/agents', { method: 'POST', body: { cwd: project.cwd, prompt: a.prompt, title: a.name, model: a.model, permissionMode: a.permissionMode } });
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section>
      <div className="hl">## agentes guardados</div>
      {!agents.length && <div className="mut">Guardá uno desde "+ agente".</div>}
      {agents.map((a) => (
        <div className="todo" key={a.id}>
          <button onClick={() => launch(a)} disabled={busy === a.id} title={a.prompt}>
            ▶ {a.name}
          </button>
          <span className="mut" style={{ fontSize: '0.85em' }}>{a.model} · {a.permissionMode}</span>
          <button className="link" onClick={() => openAgent({ cwd: project.cwd, prompt: a.prompt, title: a.name, model: a.model, permissionMode: a.permissionMode })} aria-label={`Editar y lanzar ${a.name}`}>✎</button>
          <button className="link x" onClick={() => patch({ savedAgents: agents.filter((x) => x.id !== a.id) })} aria-label={`Borrar ${a.name}`}>×</button>
        </div>
      ))}
      {err && <div className="err">{err}</div>}
    </section>
  );
}
