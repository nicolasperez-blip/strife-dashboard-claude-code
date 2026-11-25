import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export async function api<T = any>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
  return data as T;
}

// ---------- types ----------

export interface Overview {
  today: number;
  last7: number;
  working: number;
  waiting: number;
  agentsActive: number;
  feed: { jira: number; slack: number };
}

export interface SavedAgent {
  id: string;
  name: string;
  prompt: string;
  model: string;
  permissionMode: string;
}

export interface ProjectExtras {
  notes: string;
  links: { label: string; url: string }[];
  tickets: string[];
  savedAgents: SavedAgent[];
}

export interface Project {
  id: string;
  cwd: string;
  sessions: number;
  lastActivity: string;
  extras: ProjectExtras;
}

export interface Session {
  id: string;
  cwd: string;
  project: string;
  title: string;
  firstPrompt: string;
  lastPrompt: string;
  branch: string;
  entrypoint: string;
  start: string;
  end: string;
  userTurns: number;
  assistantTurns: number;
  models: string[];
  tokens: { input: number; output: number; cacheRead: number; cacheCreate: number };
  tools: string[];
  files: string[];
  subagents: number;
  lastClaudeText: string;
  pendingQuestion: string | null;
  tickets: string[];
}

export type SessionState = 'trabajando' | 'pregunta' | 'esperandote' | 'abierta_sin_uso' | 'cerrada';

export interface BoardSession extends Session {
  state: SessionState;
  hostSessionId: string | null;
}

export interface SessionColumn {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SessionBoardLayout {
  columns: SessionColumn[];
  hidden: string[];
}

export interface SessionDetail extends BoardSession {
  prompts: { role: string; text: string; ts?: string }[];
}

export interface Summary {
  status: 'none' | 'running' | 'ready' | 'error';
  markdown?: string;
  generatedAt?: number;
  stale?: boolean;
  error?: string;
}

export interface LiveSession {
  pid: number;
  sessionId: string;
  project: string;
}

export interface Column {
  id: string;
  name: string;
  role?: 'queue' | 'running' | 'done';
  cardIds: string[];
}

export interface Card {
  id: string;
  type: 'agent' | 'session' | 'task';
  title: string;
  project: string | null;
  refId?: string;
  note?: string;
  createdAt: number;
}

export interface Board {
  columns: Column[];
  cards: Record<string, Card>;
}

export type RunStatus = 'queued' | 'running' | 'ok' | 'error' | 'stopped' | 'interrupted';

export interface Run {
  id: string;
  title: string;
  cwd: string;
  project: string;
  prompt: string;
  model: string;
  permissionMode: string;
  resume?: string;
  status: RunStatus;
  cardId: string;
  sessionId?: string;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  result?: string;
  error?: string;
}

export interface LogItem {
  kind: 'text' | 'tool' | 'result' | 'error' | 'system';
  text: string;
  ts: number;
}

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  project: string | null;
  source?: { label: string; url: string };
  createdAt: number;
}

export interface FeedItem {
  source: 'jira' | 'slack';
  kind: string;
  title: string;
  summary: string;
  url: string;
  when: string;
  project: string | null;
}

export interface Feed {
  updatedAt: number | null;
  items: FeedItem[];
  status: 'idle' | 'running' | 'error';
  error?: string;
}

export interface Usage {
  days: { date: string; byProject: Record<string, number>; total: number }[];
  byProject: { project: string; costUSD: number; tokens: number; sessions: number }[];
  byModel: { model: string; costUSD: number; tokens: number }[];
  totals: { today: number; last7: number; last30: number; allTime: number; tokens30: number };
  estimatedShare: number;
}

export interface Skill {
  name: string;
  description: string;
}

// ---------- queries ----------

export const useOverview = () => useQuery({ queryKey: ['overview'], queryFn: () => api<Overview>('/summary'), refetchInterval: 15_000 });
export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api<Project[]>('/projects'), refetchInterval: 60_000 });
export const useSessions = () => useQuery({ queryKey: ['sessions'], queryFn: () => api<Session[]>('/sessions'), refetchInterval: 20_000 });
export const useLive = () => useQuery({ queryKey: ['live'], queryFn: () => api<LiveSession[]>('/sessions/live'), refetchInterval: 10_000 });
export const useSessionsBoard = () =>
  useQuery({ queryKey: ['sessions-board'], queryFn: () => api<BoardSession[]>('/sessions/board'), refetchInterval: 5_000 });
export const useSessionBoardLayout = () =>
  useQuery({ queryKey: ['session-board'], queryFn: () => api<SessionBoardLayout>('/session-board') });
export const useBoard = () => useQuery({ queryKey: ['board'], queryFn: () => api<Board>('/board'), refetchInterval: 5_000 });
export const useTodos = () => useQuery({ queryKey: ['todos'], queryFn: () => api<Todo[]>('/todos') });
export const useSkills = () => useQuery({ queryKey: ['skills'], queryFn: () => api<Skill[]>('/skills'), staleTime: Infinity });
export const useUsage = () => useQuery({ queryKey: ['usage'], queryFn: () => api<Usage>('/usage?days=30'), refetchInterval: 60_000 });

export function useRuns() {
  return useQuery({
    queryKey: ['runs'],
    queryFn: () => api<Run[]>('/agents'),
    refetchInterval: (q) => (q.state.data?.some((r) => r.status === 'running' || r.status === 'queued') ? 2_000 : 10_000),
  });
}

export function useFeed() {
  return useQuery({
    queryKey: ['feed'],
    queryFn: () => api<Feed>('/feed'),
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 3_000 : 60_000),
  });
}

/** Mutation that refetches the given query keys when it succeeds. */
export function useAction<V>(fn: (v: V) => Promise<unknown>, keys: string[]) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k] })),
  });
}

// ---------- formatting ----------

export const usd = (n: number) => `$${n < 10 ? n.toFixed(2) : n.toFixed(0)}`;

export function compact(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}k`;
  return String(Math.round(n));
}

export function shortDate(iso: string | number): string {
  const d = new Date(iso);
  return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short' }).replace('.', '');
}

export function ago(ts: number | string | null | undefined): string {
  if (!ts) return 'nunca';
  const s = (Date.now() - new Date(ts).getTime()) / 1000;
  if (s < 60) return 'recién';
  if (s < 3600) return `hace ${Math.round(s / 60)} min`;
  if (s < 86400) return `hace ${Math.round(s / 3600)} h`;
  return `hace ${Math.round(s / 86400)} d`;
}

export function duration(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
}
