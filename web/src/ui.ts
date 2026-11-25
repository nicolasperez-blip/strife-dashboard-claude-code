import { createContext, useContext } from 'react';

export type DrawerTarget = { kind: 'session' | 'run' | 'task'; id: string } | null;

export interface AgentDraft {
  cwd?: string;
  prompt?: string;
  title?: string;
  resume?: string;
  model?: string;
  permissionMode?: string;
}

export interface Ui {
  /** selected project id, or 'all' */
  project: string;
  openDrawer: (t: DrawerTarget) => void;
  openAgent: (d: AgentDraft) => void;
}

export const UiContext = createContext<Ui>({ project: 'all', openDrawer: () => {}, openAgent: () => {} });
export const useUi = () => useContext(UiContext);

export const THEMES = [
  { id: 'neon', label: 'neón' },
  { id: 'gb', label: 'game boy' },
  { id: 'amber', label: 'crt ámbar' },
  { id: 'syn', label: 'synthwave' },
] as const;

export function stored<T extends string>(key: string, fallback: T): T {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
}

export function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

/** Short display name for a project folder. */
export function projectLabel(id: string): string {
  return id.replace(/^mediamonks-/, '');
}
