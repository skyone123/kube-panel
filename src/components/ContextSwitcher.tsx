import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listContexts, useContext } from '../api/tauri';
import { useAppStore } from '../stores/appStore';

export function ContextSwitcher() {
  const qc = useQueryClient();
  const { currentContext } = useAppStore();
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const mut = useMutation({
    mutationFn: useContext,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contexts'] });
      await qc.invalidateQueries({ queryKey: ['pods'] });
    },
  });
  // derive current from freshly-fetched contexts (current flag comes from kubeconfig after use_context)
  const cur = contexts.find(c => c.current) ?? currentContext;
  return (
    <div className="ctx-switcher">
      <select
        value={cur?.name ?? ''}
        onChange={e => mut.mutate(e.target.value)}
      >
        {contexts.map(c => <option key={c.name} value={c.name}>{c.name}{c.current ? ' *' : ''}</option>)}
      </select>
      {mut.isError && <span className="err">switch failed</span>}
    </div>
  );
}
