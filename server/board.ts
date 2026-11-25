import { newId, readJson, writeJson } from './store.js';

// ---------- board ----------

export type ColumnRole = 'queue' | 'running' | 'done';

export interface Column {
  id: string;
  name: string;
  /** queue: new agent cards land here. running: cards move here when the agent starts. done: when it ends. */
  role?: ColumnRole;
  cardIds: string[];
}

export interface Card {
  id: string;
  type: 'agent' | 'session' | 'task';
  title: string;
  project: string | null;
  /** run id for agent cards, session id for session cards */
  refId?: string;
  note?: string;
  createdAt: number;
}

export interface Board {
  columns: Column[];
  cards: Record<string, Card>;
}

function defaultBoard(): Board {
  return {
    columns: [
      { id: 'col-cola', name: 'cola', role: 'queue', cardIds: [] },
      { id: 'col-curso', name: 'en curso', role: 'running', cardIds: [] },
      { id: 'col-revisar', name: 'revisar', role: 'done', cardIds: [] },
      { id: 'col-hecho', name: 'hecho', cardIds: [] },
    ],
    cards: {},
  };
}

let board: Board = readJson<Board>('board.json', defaultBoard());
const saveBoard = () => writeJson('board.json', board);

export const getBoard = () => board;

function columnOf(cardId: string): Column | undefined {
  return board.columns.find((c) => c.cardIds.includes(cardId));
}

function columnByRole(role: ColumnRole): Column {
  return board.columns.find((c) => c.role === role) ?? board.columns[0];
}

export function addCard(input: Omit<Card, 'id' | 'createdAt'>, columnId?: string): Card {
  const card: Card = { ...input, id: newId('card-'), createdAt: Date.now() };
  board.cards[card.id] = card;
  const col = board.columns.find((c) => c.id === columnId) ?? board.columns[0];
  col.cardIds.unshift(card.id);
  saveBoard();
  return card;
}

export function updateCard(id: string, patch: Partial<Pick<Card, 'title' | 'note' | 'project'>>): Card | undefined {
  const card = board.cards[id];
  if (!card) return undefined;
  Object.assign(card, patch);
  saveBoard();
  return card;
}

export function deleteCard(id: string): void {
  for (const c of board.columns) c.cardIds = c.cardIds.filter((x) => x !== id);
  delete board.cards[id];
  saveBoard();
}

/** Remove the board cards that point at a session. */
export function removeSessionCards(sessionId: string): void {
  const ids = Object.values(board.cards).filter((c) => c.type === 'session' && c.refId === sessionId).map((c) => c.id);
  if (ids.length) for (const id of ids) deleteCard(id);
}

/** Move a card to a column, before another card (or to the end when beforeId is null). */
export function moveCard(cardId: string, toColumnId: string, beforeId: string | null): void {
  const to = board.columns.find((c) => c.id === toColumnId);
  if (!to || !board.cards[cardId]) return;
  for (const c of board.columns) c.cardIds = c.cardIds.filter((x) => x !== cardId);
  const idx = beforeId ? to.cardIds.indexOf(beforeId) : -1;
  if (idx >= 0) to.cardIds.splice(idx, 0, cardId);
  else to.cardIds.push(cardId);
  saveBoard();
}

/**
 * Follow an agent's status: a card still in the queue or running column moves to the
 * matching column. A card the user already moved somewhere else stays where it is.
 */
export function followAgent(cardId: string, status: 'running' | 'finished'): void {
  const from = columnOf(cardId);
  if (!from) return;
  const managed = from.role === 'queue' || from.role === 'running';
  if (!managed) return;
  const to = columnByRole(status === 'running' ? 'running' : 'done');
  if (to.id === from.id) return;
  from.cardIds = from.cardIds.filter((x) => x !== cardId);
  to.cardIds.unshift(cardId);
  saveBoard();
}

/** Add a column at the end, or right after `afterId`. A role moves off the column that had it. */
export function addColumn(name: string, opts: { role?: ColumnRole | null; afterId?: string } = {}): Column {
  const col: Column = { id: newId('col-'), name, cardIds: [] };
  const i = opts.afterId ? board.columns.findIndex((c) => c.id === opts.afterId) : -1;
  if (i >= 0) board.columns.splice(i + 1, 0, col);
  else board.columns.push(col);
  if (opts.role) {
    for (const c of board.columns) if (c.role === opts.role) delete c.role;
    col.role = opts.role;
  }
  saveBoard();
  return col;
}

export function updateColumn(id: string, patch: { name?: string; role?: ColumnRole | null }): void {
  const col = board.columns.find((c) => c.id === id);
  if (!col) return;
  if (patch.name) col.name = patch.name;
  if (patch.role !== undefined) {
    if (patch.role) for (const c of board.columns) if (c.role === patch.role) delete c.role;
    if (patch.role) col.role = patch.role;
    else delete col.role;
  }
  saveBoard();
}

export function moveColumn(id: string, dir: -1 | 1): void {
  const i = board.columns.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= board.columns.length) return;
  [board.columns[i], board.columns[j]] = [board.columns[j], board.columns[i]];
  saveBoard();
}

export function deleteColumn(id: string): void {
  if (board.columns.length <= 1) return;
  const i = board.columns.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [col] = board.columns.splice(i, 1);
  board.columns[Math.max(0, i - 1)].cardIds.push(...col.cardIds);
  saveBoard();
}

export function resetBoardForTests(): void {
  board = defaultBoard();
}

// ---------- todos ----------

export interface Todo {
  id: string;
  text: string;
  done: boolean;
  project: string | null;
  source?: { label: string; url: string };
  createdAt: number;
}

let todos: Todo[] = readJson<Todo[]>('todos.json', []);
const saveTodos = () => writeJson('todos.json', todos);

export const getTodos = () => todos;

export function addTodo(input: Pick<Todo, 'text' | 'project' | 'source'>): Todo {
  const t: Todo = { id: newId('todo-'), text: input.text, project: input.project ?? null, source: input.source, done: false, createdAt: Date.now() };
  todos.unshift(t);
  saveTodos();
  return t;
}

export function updateTodo(id: string, patch: Partial<Pick<Todo, 'text' | 'done' | 'project'>>): Todo | undefined {
  const t = todos.find((x) => x.id === id);
  if (!t) return undefined;
  Object.assign(t, patch);
  saveTodos();
  return t;
}

export function deleteTodo(id: string): void {
  todos = todos.filter((x) => x.id !== id);
  saveTodos();
}

// ---------- per-project extras ----------

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
  hidden?: boolean;
}

let extras: Record<string, ProjectExtras> = readJson('projects.json', {});
const saveExtras = () => writeJson('projects.json', extras);

export function getExtras(project: string): ProjectExtras {
  return extras[project] ?? { notes: '', links: [], tickets: [], savedAgents: [] };
}

export const allExtras = () => extras;

export function patchExtras(project: string, patch: Partial<ProjectExtras>): ProjectExtras {
  const next = { ...getExtras(project), ...patch };
  next.savedAgents = next.savedAgents.map((a) => ({ ...a, id: a.id || newId('sa-') }));
  extras[project] = next;
  saveExtras();
  return next;
}
