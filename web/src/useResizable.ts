import { useCallback, useEffect, useState } from 'react';
import { store, stored } from './ui';

/**
 * Width of a panel that the user drags from its left edge. The width is saved
 * in localStorage under `key`. Dragging left makes the panel wider.
 */
export function useResizable(key: string, initial: number, min: number, max: () => number) {
  const [width, setWidth] = useState(() => {
    const saved = Number(stored(key, String(initial)));
    return Number.isFinite(saved) && saved > 0 ? saved : initial;
  });

  // Keep the panel inside the window when the window gets smaller.
  useEffect(() => {
    const onResize = () => setWidth((w) => Math.min(w, Math.max(min, max())));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [min, max]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = width;
      let last = startW;
      document.body.classList.add('resizing');
      const move = (ev: PointerEvent) => {
        last = Math.round(Math.min(max(), Math.max(min, startW + (startX - ev.clientX))));
        setWidth(last);
      };
      const up = () => {
        document.body.classList.remove('resizing');
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        store(key, String(last));
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    },
    [width, key, min, max],
  );

  /** Arrow keys on the handle change the width by 20px, for keyboard users. */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = Math.min(max(), Math.max(min, width + (e.key === 'ArrowLeft' ? 20 : -20)));
      setWidth(next);
      store(key, String(next));
    },
    [width, key, min, max],
  );

  return { width, onPointerDown, onKeyDown };
}
