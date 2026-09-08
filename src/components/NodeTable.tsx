import { useContextMenu } from './useContextMenu';
import type { NodeView } from '../types';

interface NodeTableProps {
  nodes: NodeView[];
  query: string;
  onDescribe?: (node: NodeView) => void;
}

export function NodeTable({ nodes, query, onDescribe }: NodeTableProps) {
  const q = query.trim().toLowerCase();
  const shown = q
    ? nodes.filter(n =>
        n.name.toLowerCase().includes(q) ||
        n.roles.some(r => r.toLowerCase().includes(q)) ||
        n.internal_ip.toLowerCase().includes(q) ||
        n.os.toLowerCase().includes(q))
    : nodes;

  const { menu, pos, menuRef, openMenu, closeMenu } = useContextMenu<NodeView>();

  const fireDescribe = () => {
    if (menu) {
      onDescribe?.(menu.target);
      closeMenu();
    }
  };

  if (shown.length === 0) {
    return (
      <div className="pod-empty">
        {nodes.length === 0 ? 'No nodes in this cluster.' : 'No nodes match your filter.'}
      </div>
    );
  }

  return (
    <>
      <table className="pod-table">
        <thead>
          <tr>
            <th>Name</th><th>Status</th><th>Roles</th><th>Version</th>
            <th>OS</th><th>Internal IP</th><th>Pressure</th><th>Allocatable</th><th>Age</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(n => (
            <tr
              key={n.name}
              className={`pod-row ${n.ready ? 'status-ok' : 'status-err'}`}
              onContextMenu={e => openMenu(e, n)}
              style={{ cursor: 'default' }}
            >
              <td className="col-name">{n.name}</td>
              <td className="col-status">
                <span className={`status-pill ${n.ready ? 'ok' : 'err'}`}>{n.status}</span>
              </td>
              <td className="col-roles">
                {n.roles.length > 0
                  ? n.roles.map(r => <span key={r} className="role-pill">{r}</span>)
                  : <span className="col-dash">—</span>}
              </td>
              <td>{n.version}</td>
              <td>{n.os || '—'}</td>
              <td>{n.internal_ip || '—'}</td>
              <td className="col-pressure">
                {n.pressure.length > 0
                  ? n.pressure.map(p => <span key={p} className="pressure-badge">{p}</span>)
                  : <span className="col-dash">—</span>}
              </td>
              <td className="col-allocatable">
                {n.cpu_allocatable || '—'} / {n.mem_allocatable || '—'}
              </td>
              <td>{n.age}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {menu && (
        <div
          ref={menuRef}
          className="pod-ctx-menu"
          style={{ left: pos.x, top: pos.y }}
        >
          <button className="ctx-item" onClick={fireDescribe} title="kubectl describe node 文本（只读）">
            Describe
          </button>
        </div>
      )}
    </>
  );
}
