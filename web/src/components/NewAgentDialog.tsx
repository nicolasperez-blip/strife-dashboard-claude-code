import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, useProjects, useSkills, type Run } from '../api';
import { projectLabel, useUi, type AgentDraft } from '../ui';

const MODES = [
  { id: 'plan', label: 'plan', hint: 'solo lee y propone' },
  { id: 'acceptEdits', label: 'acceptEdits', hint: 'puede editar archivos' },
  { id: 'auto', label: 'auto', hint: 'decide solo qué ejecutar' },
];

export function NewAgentDialog({ draft, onClose }: { draft: AgentDraft; onClose: () => void }) {
  const { project, openDrawer } = useUi();
  const projects = useProjects();
  const skills = useSkills();
  const qc = useQueryClient();
  const defaultCwd = draft.cwd ?? projects.data?.find((p) => p.id === project)?.cwd ?? projects.data?.[0]?.cwd ?? '';
  const [cwd, setCwd] = useState(defaultCwd);
  const [prompt, setPrompt] = useState(draft.prompt ?? '');
  const [title, setTitle] = useState(draft.title ?? '');
  const [model, setModel] = useState(draft.model ?? 'sonnet');
  const [mode, setMode] = useState(draft.permissionMode ?? 'plan');
  const [save, setSave] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!cwd && defaultCwd) setCwd(defaultCwd);
  }, [defaultCwd]);
  useEffect(() => promptRef.current?.focus(), []);

  const projectOfCwd = projects.data?.find((p) => p.cwd === cwd);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cwd) return setErr('Elegí un proyecto.');
    if (!prompt.trim()) return setErr(draft.resume ? 'Escribí qué querés que siga haciendo.' : 'Escribí un prompt o elegí una skill.');
    setBusy(true);
    setErr('');
    try {
      const run = await api<Run>('/agents', {
        method: 'POST',
        body: { cwd, prompt, title: title || undefined, model, permissionMode: mode, resume: draft.resume },
      });
      if (save && projectOfCwd) {
        const name = title.trim() || prompt.split('\n')[0].slice(0, 40);
        await api(`/projects/${encodeURIComponent(projectOfCwd.id)}`, {
          method: 'PATCH',
          body: {
            savedAgents: [
              ...projectOfCwd.extras.savedAgents,
              { id: '', name, prompt, model, permissionMode: mode },
            ],
          },
        });
        qc.invalidateQueries({ queryKey: ['projects'] });
      }
      qc.invalidateQueries({ queryKey: ['board'] });
      qc.invalidateQueries({ queryKey: ['runs'] });
      onClose();
      openDrawer({ kind: 'run', id: run.id });
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <form className="dialog" role="dialog" aria-modal="true" aria-label="Nuevo agente" onSubmit={submit}>
        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          <span className="hl">&gt; {draft.resume ? 'seguir sesión como agente' : 'nuevo agente'}</span>
          <button type="button" className="link" onClick={onClose} aria-label="Cerrar">[x]</button>
        </div>

        <div className="field">
          <label htmlFor="ag-project" className="mut">proyecto</label>
          <select id="ag-project" value={cwd} onChange={(e) => setCwd(e.target.value)} disabled={!!draft.resume}>
            {!projects.data?.some((p) => p.cwd === cwd) && cwd && <option value={cwd}>{cwd}</option>}
            {(projects.data ?? []).filter((p) => p.cwd).map((p) => (
              <option key={p.id} value={p.cwd}>{projectLabel(p.id)} · {p.cwd}</option>
            ))}
          </select>
        </div>

        {!draft.resume && (
          <div className="field">
            <span className="mut">skills</span>
            <div className="radio-row">
              {(skills.data ?? []).map((s) => (
                <button type="button" key={s.name} title={s.description} onClick={() => { setPrompt(`/${s.name} `); setTitle(title || `/${s.name}`); promptRef.current?.focus(); }}>
                  /{s.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="ag-prompt" className="mut">prompt</label>
          <textarea
            id="ag-prompt"
            ref={promptRef}
            value={prompt}
            onChange={(e) => { setPrompt(e.target.value); setErr(''); }}
            placeholder={draft.resume ? 'Seguí con los tests que quedaron pendientes' : 'Revisá los tickets nuevos de SKPT y decime cuáles son bugs'}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(e as any);
            }}
          />
        </div>

        <div className="field">
          <label htmlFor="ag-title" className="mut">título en el tablero (opcional)</label>
          <input id="ag-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="fix filtros RTM" />
        </div>

        <div className="field">
          <span className="mut">modelo</span>
          <div className="radio-row" role="radiogroup" aria-label="Modelo">
            {['opus', 'sonnet', 'haiku'].map((m) => (
              <label key={m}>
                <input type="radio" name="model" value={m} checked={model === m} onChange={() => setModel(m)} /> {m}
              </label>
            ))}
          </div>
        </div>

        <div className="field">
          <span className="mut">permisos</span>
          <div className="radio-row" role="radiogroup" aria-label="Permisos">
            {MODES.map((m) => (
              <label key={m.id} title={m.hint}>
                <input type="radio" name="mode" value={m.id} checked={mode === m.id} onChange={() => setMode(m.id)} /> {m.label}{' '}
                <span className="mut">({m.hint})</span>
              </label>
            ))}
          </div>
          <span className="mut" style={{ fontSize: '0.85em' }}>Escribir en Jira, Slack, Monday, Gmail, Calendar o Drive está siempre bloqueado: el agente deja un borrador.</span>
        </div>

        {!draft.resume && projectOfCwd && (
          <label className="field" style={{ flexDirection: 'row', gap: 6 }}>
            <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> guardar como agente de {projectLabel(projectOfCwd.id)}
          </label>
        )}

        {err && <div className="err">{err}</div>}
        <div className="btns" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>cancelar</button>
          <button type="submit" disabled={busy} className="hl">{busy ? 'lanzando…' : 'lanzar ▶'}</button>
        </div>
      </form>
    </div>
  );
}
