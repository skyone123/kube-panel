import Fuse from 'fuse.js';
import type { HistoryEntry } from '../types';

export function HistoryPanel({ entries, query }: { entries: HistoryEntry[]; query: string }) {
  const fuse = new Fuse(entries, { keys: ['argv', 'context', 'namespace'], threshold: 0.4 });
  const shown = query.trim() ? fuse.search(query).map(r => r.item) : entries;
  return (
    <ul className="history">
      {shown.map(e => (
        <li key={e.id}>
          <span className="mono">{e.argv.join(' ')}</span>
          <span className="meta">{e.context}{e.namespace ? `/${e.namespace}` : ''} · exit {e.exit_code ?? '?'} · {e.duration_ms ?? '?'}ms{e.is_stream ? ' · stream' : ''}</span>
        </li>
      ))}
    </ul>
  );
}
