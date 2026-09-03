import type { HistoryEntry } from '../types';

export function HistoryPanel({ entries, query }: { entries: HistoryEntry[]; query: string }) {
  const q = query.trim().toLowerCase();
  const shown = q
    ? entries.filter(e => {
        const hay = `${e.argv.join(' ')} ${e.context} ${e.namespace ?? ''}`.toLowerCase();
        return hay.includes(q);
      })
    : entries;
  if (shown.length === 0) {
    return (
      <div className="history-empty">
        {entries.length === 0 ? 'No command history yet.' : 'No history matches your search.'}
      </div>
    );
  }
  return (
    <ul className="history">
      {shown.map(e => {
        const exit = e.exit_code ?? null;
        const exitCls = exit === null ? '' : exit === 0 ? 'exit-ok' : 'exit-bad';
        return (
          <li key={e.id ?? `${e.ts_ms}-${e.argv.join('-')}`}>
            <span className="mono">{e.argv.join(' ')}</span>
            <span className="meta">
              {e.context}{e.namespace ? `/${e.namespace}` : ''}
              {' · exit '}
              <span className={exitCls}>{e.exit_code ?? '?'}</span>
              {' · '}
              {e.duration_ms ?? '?'}ms
              {e.is_stream ? ' · stream' : ''}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
