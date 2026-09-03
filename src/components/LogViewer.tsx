import { useQuery } from '@tanstack/react-query';
import { getPodLogs, listContexts } from '../api/tauri';
import type { PodView } from '../types';
import { useAppStore } from '../stores/appStore';

export function LogViewer({ pod }: { pod: PodView | null }) {
  const { namespace } = useAppStore();
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const ctxName = contexts.find(c => c.current)?.name ?? '';
  const { data: logs, isLoading } = useQuery({
    queryKey: ['logs', ctxName, namespace, pod?.name],
    queryFn: () => getPodLogs(ctxName, namespace, pod!.name, null, false, 1000),
    enabled: !!pod && !!ctxName,
  });
  if (!pod) return <div className="logs">Select a pod to view logs.</div>;
  if (isLoading) return <div className="logs">Loading…</div>;
  return <pre className="logs">{logs ?? ''}</pre>;
}
