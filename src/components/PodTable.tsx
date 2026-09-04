import { useEffect, useRef, useState } from 'react';
import type { PodView, PodActionMode } from '../types';

const BAD = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']);

interface PodTableProps {
  pods: PodView[];
  query: string;
  onSelect?: (pod: PodView) => void;
  selected?: PodView | null;
  onPodAction?: (pod: PodView, mode: PodActionMode) => void;
  onMergeTail?: (pods: PodView[]) => void;
}

function statusClass(status: string): 'status-error' | 'status-ok' | 'status-warn' {
  if (BAD.has(status)) return 'status-error';
  return status === 'Running' ? 'status-ok' : 'status-warn';
}

function statusPill(status: string) {
  const cls = statusClass(status);
  if (cls === 'status-ok') return <span className="status-pill ok">{status}</span>;
  if (cls === 'status-error') return <span className="status-pill err">{status}</span>;
  return <span className="status-pill warn">{status}</span>;
}

type CtxMenuState = { pod: PodView; x: number; y: number } | null;

export function PodTable({ pods, query, onSelect, selected, onPodAction, onMergeTail }: PodTableProps) {
  const q = query.trim().toLowerCase();
  const shown = q
    ? pods.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q) ||
        p.node.toLowerCase().includes(q))
    : pods;
  const selectedKey = selected ? `${selected.namespace}/${selected.name}` : null;

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set());

  const allShownKeys = shown.map(p => `${p.namespace}/${p.name}`);
  const allSelected = allShownKeys.length > 0 && allShownKeys.every(k => multiSel.has(k));

  // Close on Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctxMenu]);

  // Close on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenu(null);
      }
    };
    // Use mousedown so it fires before click handlers on rows
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [ctxMenu]);

  const handleContext = (e: React.MouseEvent, pod: PodView) => {
    e.preventDefault();
    setCtxMenu({ pod, x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setCtxMenu(null);

  const copyName = (pod: PodView) => {
    navigator.clipboard.writeText(pod.name);
    closeMenu();
  };

  const copyKubectlLogs = (pod: PodView) => {
    const nsPart = pod.namespace ? `-n ${pod.namespace} ` : '';
    navigator.clipboard.writeText(`kubectl logs ${nsPart}${pod.name}`);
    closeMenu();
  };

  const fireAction = (mode: PodActionMode) => {
    if (ctxMenu) {
      onPodAction?.(ctxMenu.pod, mode);
      closeMenu();
    }
  };

  const toggleRow = (key: string) => {
    setMultiSel(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setMultiSel(prev => {
      if (allSelected) {
        const next = new Set(prev);
        for (const k of allShownKeys) next.delete(k);
        return next;
      }
      const next = new Set(prev);
      for (const k of allShownKeys) next.add(k);
      return next;
    });
  };

  const clearMulti = () => setMultiSel(new Set());

  const selectedPods = pods.filter(p => multiSel.has(`${p.namespace}/${p.name}`));

  if (shown.length === 0) {
    return (
      <div className="pod-empty">
        {pods.length === 0 ? 'No pods in this namespace.' : 'No pods match your filter.'}
      </div>
    );
  }

  return (
    <>
      {multiSel.size >= 2 && (
        <div className="pod-multi-bar">
          <button
            className="lc-btn"
            onClick={() => { onMergeTail?.(selectedPods); clearMulti(); }}
          >
            Tail {multiSel.size} pods
          </button>
          <button className="lc-btn" onClick={clearMulti}>Clear</button>
        </div>
      )}
      <table className="pod-table">
        <thead>
          <tr>
            <th className="col-sel">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all visible pods"
              />
            </th>
            <th>Name</th><th>Namespace</th><th>Ready</th><th>Status</th>
            <th>Restarts</th><th>Age</th><th>Node</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(p => {
            const cls = statusClass(p.status);
            const key = `${p.namespace}/${p.name}`;
            const isSel = key === selectedKey;
            const isMultiSel = multiSel.has(key);
            const highRestarts = p.restarts >= 1;
            return (
              <tr
                key={key}
                className={`pod-row ${cls}${isSel ? ' selected' : ''}`}
                onClick={() => onSelect?.(p)}
                onContextMenu={e => handleContext(e, p)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                <td className="col-sel">
                  <input
                    type="checkbox"
                    checked={isMultiSel}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleRow(key)}
                    aria-label={`Select ${p.name}`}
                  />
                </td>
                <td className="col-name">{p.name}</td>
                <td className="col-ns">{p.namespace}</td>
                <td className="col-ready">{p.ready}</td>
                <td>{statusPill(p.status)}</td>
                <td className={highRestarts ? 'restarts-high' : ''}>{p.restarts}</td>
                <td>{p.age}</td>
                <td className="col-node">{p.node}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {ctxMenu && (
        <div
          ref={menuRef}
          className="pod-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className="ctx-item" onClick={() => copyName(ctxMenu.pod)}>
            Copy name
          </button>
          <button className="ctx-item" onClick={() => copyKubectlLogs(ctxMenu.pod)}>
            Copy kubectl logs
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => fireAction('images')}>
            Show images
          </button>
          <button className="ctx-item" onClick={() => fireAction('configmaps')}>
            Show ConfigMaps
          </button>
          <button className="ctx-item" onClick={() => fireAction('describe')}>
            Describe
          </button>
          <button className="ctx-item" onClick={() => fireAction('events')}>
            Events
          </button>
        </div>
      )}
    </>
  );
}
