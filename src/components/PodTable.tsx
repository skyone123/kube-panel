import Fuse from 'fuse.js';
import type { PodView } from '../types';

const BAD = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']);

export function PodTable({ pods, query, onSelect }: { pods: PodView[]; query: string; onSelect?: (pod: PodView) => void }) {
  const fuse = new Fuse(pods, { keys: ['name', 'namespace', 'node'], threshold: 0.4 });
  const shown = query.trim() ? fuse.search(query).map(r => r.item) : pods;
  return (
    <table className="pod-table">
      <thead><tr>
        <th>Name</th><th>NS</th><th>Ready</th><th>Status</th><th>Restarts</th><th>Age</th><th>Node</th>
      </tr></thead>
      <tbody>
        {shown.map(p => {
          const cls = BAD.has(p.status) ? 'status-error' : p.status === 'Running' ? 'status-ok' : 'status-warn';
          return (
            <tr key={`${p.namespace}/${p.name}`} className={cls} onClick={() => onSelect?.(p)} style={{ cursor: onSelect ? 'pointer' : 'default' }}>
              <td>{p.name}</td><td>{p.namespace}</td><td>{p.ready}</td>
              <td>{p.status}</td><td>{p.restarts}</td><td>{p.age}</td><td>{p.node}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
