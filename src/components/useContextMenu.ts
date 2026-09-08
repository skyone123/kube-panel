import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface CtxMenuPos {
  x: number;
  y: number;
}

export interface ContextMenuState<T> extends CtxMenuPos {
  target: T;
}

/**
 * Shared context-menu state for right-click menus across tables.
 *
 * Handles four things uniformly so PodTable / DeploymentTable / NodeTable /
 * ResourceBrowser don't re-implement them:
 *   - menu placement clamped to the viewport so right-clicking near the
 *     window edges never clips the menu
 *   - Escape to close
 *   - outside mousedown to close
 *   - ref forwarding for the menu element so outside-click detection works
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<ContextMenuState<T> | null>(null);
  const [pos, setPos] = useState<CtxMenuPos>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const mountedRef = useRef(false);

  // Open a menu at a mouse event's coordinates.
  const openMenu = useCallback((e: React.MouseEvent, target: T) => {
    e.preventDefault();
    setMenu({ target, x: e.clientX, y: e.clientY });
    setPos({ x: e.clientX, y: e.clientY });
    mountedRef.current = false;
  }, []);

  const closeMenu = useCallback(() => setMenu(null), []);

  // After the menu renders, clamp its position inside the viewport.
  useLayoutEffect(() => {
    if (!menu) {
      mountedRef.current = false;
      return;
    }
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const M = 6; // margin from viewport edges
    const maxX = Math.max(M, window.innerWidth - rect.width - M);
    const maxY = Math.max(M, window.innerHeight - rect.height - M);
    setPos(prev => ({
      x: Math.min(prev.x, maxX),
      y: Math.min(prev.y, maxY),
    }));
    mountedRef.current = true;
  }, [menu]);

  // Close on Escape.
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menu]);

  // Close on outside mousedown.
  useEffect(() => {
    if (!menu) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenu(null);
      }
    };
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [menu]);

  return { menu, pos, menuRef, openMenu, closeMenu };
}