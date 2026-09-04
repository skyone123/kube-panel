import { useQuery } from '@tanstack/react-query';
import { listNamespaces, listContexts } from '../api/tauri';
import { useAppStore } from '../stores/appStore';

export function NamespaceSwitcher() {
  const { namespace, setNamespace } = useAppStore();
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const ctxName = contexts.find(c => c.current)?.name ?? '';
  const { data: namespaces = [] } = useQuery({
    queryKey: ['namespaces', ctxName],
    queryFn: () => listNamespaces(ctxName),
    enabled: !!ctxName,
  });
  return (
    <select className="ns-switcher" value={namespace} onChange={e => setNamespace(e.target.value)} title="选择命名空间；留空=全部命名空间">
      <option value="">All namespaces</option>
      {namespaces.map(n => <option key={n} value={n}>{n}</option>)}
    </select>
  );
}
