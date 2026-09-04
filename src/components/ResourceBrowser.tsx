import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ResourceKind, ResourceRow } from '../types';
import { getResources } from '../api/tauri';
import { ResourceDescribeModal } from './ResourceDescribeModal';

interface ResourceBrowserProps {
  ctxName: string;
  namespace: string;
  live: boolean;
}

const KIND_OPTIONS: { value: ResourceKind; label: string }[] = [
  { value: 'svc', label: 'Services' },
  { value: 'ingress', label: 'Ingresses' },
  { value: 'pvc', label: 'PVCs' },
  { value: 'sts', label: 'StatefulSets' },
  { value: 'daemonset', label: 'DaemonSets' },
  { value: 'job', label: 'Jobs' },
  { value: 'cronjob', label: 'CronJobs' },
];

type CtxMenuState = { row: ResourceRow; kind: ResourceKind; x: number; y: number } | null;

export function ResourceBrowser({ ctxName, namespace, live }: ResourceBrowserProps) {
  const [kind, setKind] = useState<ResourceKind>('svc');
  const [q, setQ] = useState('');
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>(null);
  const [describe, setDescribe] = useState<{ kind: ResourceKind; name: string; namespace: string } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const refetchInterval = live ? 5000 : false;

  const { data, isLoading, error } = useQuery({
    queryKey: ['resources', ctxName, namespace, kind],
    queryFn: () => getResources(ctxName, namespace, kind),
    enabled: !!ctxName,
    refetchInterval,
  });

  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];

  // Filter
  const ql = q.trim().toLowerCase();
  const shown = ql
    ? rows.filter(r =>
        r.name.toLowerCase().includes(ql) ||
        r.namespace.toLowerCase().includes(ql) ||
        r.values.some(v => v.toLowerCase().includes(ql)))
    : rows;

  // Close context menu on Escape
  useEffect(() => {
    if (!ctxMenu) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setCtxMenu(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ctxMenu]);

  // Close context menu on outside click
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

  const handleContext = (e: React.MouseEvent, row: ResourceRow) => {
    e.preventDefault();
    setCtxMenu({ row, kind, x: e.clientX, y: e.clientY });
  };

  const fireDescribe = () => {
    if (ctxMenu) {
      setDescribe({ kind: ctxMenu.kind, name: ctxMenu.row.name, namespace: ctxMenu.row.namespace });
      setCtxMenu(null);
    }
  };

  return (
    <>
      <div className="resource-browser-head">
        <select
          className="resource-kind-select"
          value={kind}
          onChange={e => setKind(e.target.value as ResourceKind)}
          title="选择资源类型"
        >
          {KIND_OPTIONS.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        <span className="head-meta">{shown.length} {kind}</span>
        <span className="spacer" />
        <input
          className="filter-input resource-browser-filter"
          placeholder={`Filter ${kind}…`}
          value={q}
          onChange={e => setQ(e.target.value)}
          aria-label="Filter resources"
          title="按名称/命名空间/值过滤，大小写不敏感"
        />
      </div>

      {isLoading ? (
        <div className="pod-empty">Loading {kind}…</div>
      ) : error ? (
        <div className="pod-empty">Error: {(error as Error).message}</div>
      ) : shown.length === 0 ? (
        <div className="pod-empty">No {kind} in this namespace.</div>
      ) : (
        <table className="pod-table resource-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Namespace</th>
              {columns.map((col, i) => (
                <th key={i}>{col}</th>
              ))}
              <th>Age</th>
            </tr>
          </thead>
          <tbody>
            {shown.map(r => {
              const key = `${r.namespace}/${r.name}`;
              return (
                <tr
                  key={key}
                  className="pod-row status-ok"
                  onContextMenu={e => handleContext(e, r)}
                  style={{ cursor: 'default' }}
                >
                  <td className="col-name">{r.name}</td>
                  <td className="col-ns">{r.namespace}</td>
                  {r.values.map((v, i) => (
                    <td key={i}>{v}</td>
                  ))}
                  <td>{r.age}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {ctxMenu && (
        <div
          ref={menuRef}
          className="pod-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
        >
          <button className="ctx-item" onClick={fireDescribe} title="kubectl describe 该资源（只读）">
            Describe
          </button>
        </div>
      )}

      {describe && (
        <ResourceDescribeModal
          kind={describe.kind}
          name={describe.name}
          namespace={describe.namespace}
          ctxName={ctxName}
          onClose={() => setDescribe(null)}
        />
      )}
    </>
  );
}
