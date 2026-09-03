import Fuse from 'fuse.js';
import type { PodView } from '../types';

const BAD = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']);

interface PodTableProps {
  pods: PodView[];
  query: string;
  onSelect?: (pod: PodView) => void;
  selected?: PodView | null;
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

export function PodTable({ pods, query, onSelect, selected }: PodTableProps) {
  const fuse = new Fuse(pods, { keys: ['name', 'namespace', 'node'], threshold: 0.4 });
  const shown = query.trim() ? fuse.search(query).map(r => r.item) : pods;
  const selectedKey = selected ? `${selected.namespace}/${selected.name}` : null;

  if (shown.length === 0) {
    return (
      <div className="pod-empty">
        {pods.length === 0 ? 'No pods in this namespace.' : 'No pods match your filter.'}
      </div>
    );
  }

  return (
    <table className="pod-table">
      <thead>
        <tr>
          <th>Name</th><th>Namespace</th><th>Ready</th><th>Status</th>
          <th>Restarts</th><th>Age</th><th>Node</th>
        </tr>
      </thead>
      <tbody>
        {shown.map(p => {
          const cls = statusClass(p.status);
          const key = `${p.namespace}/${p.name}`;
          const isSel = key === selectedKey;
          const highRestarts = p.restarts >= 1;
          return (
            <tr
              key={key}
              className={`pod-row ${cls}${isSel ? ' selected' : ''}`}
              onClick={() => onSelect?.(p)}
              style={{ cursor: onSelect ? 'pointer' : 'default' }}
            >
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
  );
}
