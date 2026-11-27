import { useEffect, useMemo, useState } from 'react';
import { useOverview, useProjects, usd } from './api';
import { THEMES, UiContext, projectLabel, store, stored, type AgentDraft, type DrawerTarget } from './ui';
import { BoardView } from './components/Board';
import { SessionsBoard } from './components/SessionsBoard';
import { HistoryList } from './components/HistoryList';
import { SidePanel } from './components/SidePanel';
import { Drawer } from './components/Drawer';
import { NewAgentDialog } from './components/NewAgentDialog';
import { UsagePage } from './components/UsagePage';
import { TodosPage } from './components/TodosPage';
import { useResizable } from './useResizable';

type Page = 'sessions' | 'todos' | 'board' | 'usage';

const SIDE_MAX = () => Math.max(260, window.innerWidth - 480);

export function App() {
  const [theme, setTheme] = useState(() => stored<string>('cp.theme', 'neon'));
  const [page, setPage] = useState<Page>(() => stored<Page>('cp.page', 'sessions'));
  const [project, setProject] = useState(() => stored<string>('cp.project', 'all'));
  const [drawer, setDrawer] = useState<DrawerTarget>(null);
  const [agentDraft, setAgentDraft] = useState<AgentDraft | null>(null);
  const side = useResizable('cp.sideW', 320, 220, SIDE_MAX);
  const overview = useOverview();
  const projects = useProjects();

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    store('cp.theme', theme);
  }, [theme]);
  useEffect(() => store('cp.page', page), [page]);
  useEffect(() => store('cp.project', project), [project]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (agentDraft) setAgentDraft(null);
      else setDrawer(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [agentDraft]);

  const ui = useMemo(() => ({ project, openDrawer: setDrawer, openAgent: setAgentDraft }), [project]);
  const o = overview.data;

  return (
    <UiContext.Provider value={ui}>
      <div className="app">
        <header className="bar">
          <span className="hl">&gt; claudiopiloto</span>
          <nav aria-label="Vistas">
            <button className={`tab ${page === 'sessions' ? 'on' : ''}`} onClick={() => setPage('sessions')}>sesiones</button>
            <button className={`tab ${page === 'todos' ? 'on' : ''}`} onClick={() => setPage('todos')}>todo</button>
            <button className={`tab ${page === 'board' ? 'on' : ''}`} onClick={() => setPage('board')}>agentes</button>
            <button className={`tab ${page === 'usage' ? 'on' : ''}`} onClick={() => setPage('usage')}>uso</button>
          </nav>
          <div className="stats mut">
            <span>hoy <span className="h2">{o ? usd(o.today) : '…'}</span></span>
            <span>7d <span className="h2">{o ? usd(o.last7) : '…'}</span></span>
            <span title="Sesiones donde Claude está respondiendo ahora">
              <span className={o?.working ? 'hl' : ''}>{o?.working ?? 0}</span> trabajando
            </span>
            <a href="claude://code/needs-input" title="Abrir en la app las sesiones que te esperan" style={{ textDecoration: 'none' }}>
              <span className={o?.waiting ? 'h2' : ''}>{o?.waiting ?? 0}</span> esperándote
            </a>
            <span>{o?.agentsActive ?? 0} agentes</span>
            <span>jira {o?.feed.jira ?? 0}</span>
            <span>slack {o?.feed.slack ?? 0}</span>
            <label>
              <span className="sr-only">Tema</span>
              <select value={theme} onChange={(e) => setTheme(e.target.value)} aria-label="Tema">
                {THEMES.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </label>
          </div>
        </header>

        {page !== 'usage' ? (
          <>
            <div className="tabs" role="tablist" aria-label="Proyectos">
              <button role="tab" aria-selected={project === 'all'} className={`tab ${project === 'all' ? 'on' : ''}`} onClick={() => setProject('all')}>
                todos
              </button>
              {(projects.data ?? []).map((p) => (
                <button
                  key={p.id}
                  role="tab"
                  aria-selected={project === p.id}
                  className={`tab ${project === p.id ? 'on' : ''}`}
                  onClick={() => setProject(p.id)}
                  title={p.cwd}
                >
                  {projectLabel(p.id)}
                </button>
              ))}
            </div>
            <div className="main" style={{ '--side-w': `${side.width}px` } as React.CSSProperties}>
              <div style={{ minWidth: 0 }}>
                {page === 'todos' ? (
                  <TodosPage />
                ) : (
                  <>
                    {page === 'sessions' ? <SessionsBoard /> : <BoardView />}
                    <HistoryList />
                  </>
                )}
              </div>
              <div className="side-wrap">
                <div
                  className="resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Ajustar el ancho del panel lateral"
                  aria-valuenow={side.width}
                  tabIndex={0}
                  onPointerDown={side.onPointerDown}
                  onKeyDown={side.onKeyDown}
                />
                <SidePanel hideTodos={page === 'todos'} />
              </div>
            </div>
          </>
        ) : (
          <UsagePage />
        )}

        {drawer && <Drawer target={drawer} onClose={() => setDrawer(null)} />}
        {agentDraft && <NewAgentDialog draft={agentDraft} onClose={() => setAgentDraft(null)} />}
      </div>
    </UiContext.Provider>
  );
}
