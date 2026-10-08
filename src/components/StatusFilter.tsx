import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { compareStatusOptions, statusClass, type StatusOption } from './podStatus';

interface StatusFilterProps {
  /** Distinct statuses present in the current pod list, worst-first. */
  options: StatusOption[];
  /** Selected statuses; empty means "all statuses". */
  selected: string[];
  onChange: (next: string[]) => void;
}

const MARGIN = 6;
const POPOVER_ID = 'pod-status-filter-pop';

function buttonLabel(selected: string[]): string {
  if (selected.length === 0) return 'Status: All';
  if (selected.length === 1) return `Status: ${selected[0]}`;
  return `Status: ${selected.length} selected`;
}

/**
 * Multi-select status filter for the pod list.
 *
 * Empty selection means "all" rather than "none", so the control is a filter
 * (narrow a big list down to the states you care about) rather than a union of
 * one status at a time. The popover is `position: fixed` and anchored under the
 * trigger — `.card` is `overflow: hidden`, so an absolutely positioned panel
 * inside the card head would be clipped.
 */
export function StatusFilter({ options, selected, onChange }: StatusFilterProps) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: MARGIN, y: MARGIN });
  const btnRef = useRef<HTMLButtonElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);

  const toggle = (status: string) => {
    onChange(selected.includes(status) ? selected.filter(s => s !== status) : [...selected, status]);
  };

  // A selected status can vanish from `options` while the list auto-refreshes
  // (e.g. every CrashLoopBackOff pod recovered). Keep it listed with a zero
  // count so it stays uncheckable — otherwise the only way out would be "All".
  // Re-sorted so a resurrected error status still ranks above a healthy one.
  const rows: StatusOption[] = [
    ...options,
    ...selected
      .filter(s => !options.some(o => o.status === s))
      .map(status => ({ status, count: 0, cls: statusClass(status) })),
  ].sort(compareStatusOptions);

  // Anchor the panel under the trigger, clamped to the viewport. Runs before
  // paint so the panel never flashes at a stale position.
  useLayoutEffect(() => {
    if (!open) return;
    const btn = btnRef.current;
    const pop = popRef.current;
    if (!btn || !pop) return;
    const b = btn.getBoundingClientRect();
    const p = pop.getBoundingClientRect();
    const below = b.bottom + 4;
    setPos({
      x: Math.max(MARGIN, Math.min(b.left, window.innerWidth - p.width - MARGIN)),
      y:
        below + p.height > window.innerHeight - MARGIN
          ? Math.max(MARGIN, b.top - p.height - 4)
          : below,
    });
  }, [open]);

  // Escape / outside click / scroll / resize close the panel. Scrolling and
  // resizing close it because the trigger moves while a fixed panel would not
  // — without this the panel can drift or end up covering its own trigger.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Focus was inside the panel (something the panel is about to unmount),
      // so hand it back to the trigger instead of dropping it to <body>.
      const hadFocus = !!popRef.current?.contains(document.activeElement);
      setOpen(false);
      if (hadFocus) btnRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (popRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      // No focus restore here: the user is deliberately focusing something else.
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (popRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    // Tab past the last checkbox leaves the panel floating over the table.
    const onFocusOut = (e: FocusEvent) => {
      const next = e.relatedTarget as Node | null;
      // `relatedTarget` is null when focus is lost outright — window blur,
      // programmatic focus, and accessibility actions such as a screen reader
      // toggling a checkbox. Closing then would make the panel vanish mid-toggle
      // for exactly the users who cannot re-open it with a mouse.
      if (!next) return;
      if (popRef.current?.contains(next) || btnRef.current?.contains(next)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    window.addEventListener('focusout', onFocusOut);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('focusout', onFocusOut);
    };
  }, [open]);

  const dirty = selected.length > 0;

  return (
    <>
      <button
        ref={btnRef}
        id="pod-status-filter-btn"
        type="button"
        className={`status-filter-btn${dirty ? ' active' : ''}`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        aria-controls={open ? POPOVER_ID : undefined}
        title="按 Pod 状态筛选（可多选，勾选项之间为“或”关系；与上方名称/命名空间/节点搜索叠加为“且”）"
      >
        <span className="status-filter-label">{buttonLabel(selected)}</span>
        <span className="status-filter-caret" aria-hidden>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 6.5 8 10.5l4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open && (
        <div
          ref={popRef}
          id={POPOVER_ID}
          className="status-filter-pop"
          style={{ left: pos.x, top: pos.y }}
          role="group"
          aria-label="Filter pods by status"
        >
          <div className="sf-head">
            <span className="sf-title">Status</span>
            <button
              type="button"
              className="sf-all-btn"
              onClick={() => onChange([])}
              disabled={!dirty}
              title="清除状态筛选，显示全部状态"
            >
              All
            </button>
          </div>
          {rows.length === 0 ? (
            <div className="sf-empty">No pods</div>
          ) : (
            <ul className="sf-list">
              {rows.map(o => (
                <li key={o.status}>
                  <label className={`sf-item ${o.cls}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(o.status)}
                      onChange={() => toggle(o.status)}
                      // The count is inside the accessible name: an explicit
                      // aria-label would otherwise shadow the visible `.sf-count`.
                      aria-label={`Filter by status ${o.status} (${o.count} ${o.count === 1 ? 'pod' : 'pods'})`}
                    />
                    <span className="sf-dot" aria-hidden />
                    <span className="sf-name">{o.status}</span>
                    <span className="sf-count">{o.count}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
