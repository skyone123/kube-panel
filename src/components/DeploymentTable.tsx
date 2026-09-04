import { useEffect, useRef, useState } from 'react';
import type { DeploymentView, RolloutMode } from '../types';

interface DeploymentTableProps {
  deployments: DeploymentView[];
  query: string;
  onAction?: (deploy: DeploymentView, mode: RolloutMode) => void;
}

type CtxMenuState = { deploy: DeploymentView; x: number; y: number } | null;

export function DeploymentTable({ deployments, query, onAction }: DeploymentTableProps) {
  const q = query.trim().toLowerCase();
  const shown = q
    ? deployments.filter(d =>
        d.name.toLowerCase().includes(q) ||
        d.namespace.toLowerCase().includes(q) ||
        d.images.some(img => img.toLowerCase().includes(q)))
    : deployments;

  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [ctxMenu]);

  const handleContext = (e: React.MouseEvent, deploy: DeploymentView) => {
    e.preventDefault();
    setCtxMenu({ deploy, x: e.clientX, y: e.clientY });
  };

  const closeMenu = () => setCtxMenu(null);

  const fireAction = (mode: RolloutMode) => {
    if (ctxMenu) {
      onAction?.(ctxMenu.deploy, mode);
      closeMenu();
    }
  };

  if (shown.length === 0) {
    return (
      <div className="pod-empty">
        {deployments.length === 0 ? 'No deployments in this namespace.' : 'No deployments match your filter.'}
      </div>
    );
  }

  return (
    <>
      <table className="pod-table">
        <thead>
          <tr>
            <th>Name</th><th>Namespace</th><th>Ready</th><th>Updated</th>
            <th>Replicas</th><th>Available</th><th>Age</th><th>Images</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(d => {
            const key = `${d.namespace}/${d.name}`;
            return (
              <tr
                key={key}
                className="pod-row status-ok"
                onContextMenu={e => handleContext(e, d)}
                style={{ cursor: 'default' }}
              >
                <td className="col-name">{d.name}</td>
                <td className="col-ns">{d.namespace}</td>
                <td className="col-ready">{d.ready}</td>
                <td className="col-ready">{d.updated}</td>
                <td>{d.replicas}</td>
                <td>{d.available}</td>
                <td>{d.age}</td>
                <td className="col-images">{d.images.join(', ')}</td>
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
          <button className="ctx-item" onClick={() => fireAction('restart')}>
            Restart
          </button>
          <button className="ctx-item" onClick={() => fireAction('scale')}>
            Scale…
          </button>
          <button className="ctx-item" onClick={() => fireAction('undo')}>
            Undo
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => fireAction('history')}>
            History
          </button>
        </div>
      )}
    </>
  );
}
