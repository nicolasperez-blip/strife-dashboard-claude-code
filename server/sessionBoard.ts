import { newId, readJson, writeJson } from './store.js';

/** The user's own columns for sessions ("mis columnas" mode of the sessions view). */
export interface SessionColumn {
  id: string;
  name: string;
  sessionIds: string[];
}

export interface SessionBoard {
  columns: SessionColumn[];
  /** Sessions the user hid from the board. They stay in the history. */
  hidden: string[];
}

function defaults(): SessionBoard {
  return {
    columns: [
      { id: 'scol-nuevas', name: 'nuevas', sessionIds: [] },
      { id: 'scol-progreso', name: 'en progreso', sessionIds: [] },
      { id: 'scol-review', name: 'en review', sessionIds: [] },
      { id: 'scol-hecho', name: 'hecho', sessionIds: [] },
    ],
    hidden: [],
  };
}

let board: SessionBoard = readJson<SessionBoard>('session-board.json', defaults());
const save = () => writeJson('session-board.json', board);

export const getSessionBoard = () => board;

/** Session ids the user placed in a column. */
export function placedIds(): Set<string> {
  return new Set(board.columns.flatMap((c) => c.sessionIds));
}

export function isHidden(id: string): boolean {
  return board.hidden.includes(id);
}

/** Move a session to a column, before another session (or to the end). */
export function moveSession(sessionId: string, columnId: string, beforeId: string | null): void {
  const to = board.columns.find((c) => c.id === columnId);
  if (!to) return;
  for (const c of board.columns) c.sessionIds = c.sessionIds.filter((x) => x !== sessionId);
  const i = beforeId ? to.sessionIds.indexOf(beforeId) : -1;
  if (i >= 0) to.sessionIds.splice(i, 0, sessionId);
  else to.sessionIds.push(sessionId);
  board.hidden = board.hidden.filter((x) => x !== sessionId);
  save();
}

export function hideSession(sessionId: string): void {
  for (const c of board.columns) c.sessionIds = c.sessionIds.filter((x) => x !== sessionId);
  if (!board.hidden.includes(sessionId)) board.hidden.push(sessionId);
  save();
}

export function unhideSession(sessionId: string): void {
  board.hidden = board.hidden.filter((x) => x !== sessionId);
  save();
}

/** Forget a session everywhere (used when it is deleted). */
export function removeSession(sessionId: string): void {
  for (const c of board.columns) c.sessionIds = c.sessionIds.filter((x) => x !== sessionId);
  board.hidden = board.hidden.filter((x) => x !== sessionId);
  save();
}

export function addSessionColumn(name: string, afterId?: string): SessionColumn {
  const col: SessionColumn = { id: newId('scol-'), name, sessionIds: [] };
  const i = afterId ? board.columns.findIndex((c) => c.id === afterId) : -1;
  if (i >= 0) board.columns.splice(i + 1, 0, col);
  else board.columns.push(col);
  save();
  return col;
}

export function renameSessionColumn(id: string, name: string): void {
  const col = board.columns.find((c) => c.id === id);
  if (!col || !name) return;
  col.name = name;
  save();
}

export function moveSessionColumn(id: string, dir: -1 | 1): void {
  const i = board.columns.findIndex((c) => c.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= board.columns.length) return;
  [board.columns[i], board.columns[j]] = [board.columns[j], board.columns[i]];
  save();
}

/** Delete a column. Its sessions go back to "not placed", so they show in the first column. */
export function deleteSessionColumn(id: string): void {
  if (board.columns.length <= 1) return;
  board.columns = board.columns.filter((c) => c.id !== id);
  save();
}
