import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listContexts, useContext } from '../api/tauri';

export function ContextSwitcher() {
  const qc = useQueryClient();
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const mut = useMutation({
    mutationFn: useContext,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contexts'] });
      await qc.invalidateQueries({ queryKey: ['pods'] });
    },
  });
  // derive current purely from the freshly-fetched ['contexts'] query — the
  // `current` flag comes from kubeconfig after use_context, so there's no
  // need for a separate store-backed fallback.
  const cur = contexts.find(c => c.current) ?? null;
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
