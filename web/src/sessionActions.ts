import type { QueryClient } from '@tanstack/react-query';
import { api } from './api';

/**
 * Ask, then move a session to the macOS Trash. Returns true when it was moved.
 * The server refuses sessions that are open right now.
 */
export async function trashSessionWithConfirm(s: { id: string; title: string }, qc: QueryClient): Promise<boolean> {
  const ok = window.confirm(
    `¿Eliminar la sesión "${s.title}"?\n\n` +
      'El transcript se mueve a la Papelera de macOS. Deja de aparecer en el panel y `claude --resume` ya no la encuentra. ' +
      'Podés recuperarla desde la Papelera mientras no la vacíes. Su costo sigue contando en la página de uso.',
  );
  if (!ok) return false;
  try {
    await api(`/sessions/${s.id}`, { method: 'DELETE' });
  } catch (e: any) {
    window.alert(`No pude eliminar la sesión: ${e.message}`);
    return false;
  }
  for (const k of ['sessions', 'board', 'projects', 'usage', 'overview']) qc.invalidateQueries({ queryKey: [k] });
  return true;
}
