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
      <div className="ctx-select-wrap">
        <select
          className="ctx-select"
          value={cur?.name ?? ''}
          onChange={e => mut.mutate(e.target.value)}
          disabled={mut.isPending}
          aria-label="Switch context"
        >
          {contexts.length === 0 ? <option value="">— none —</option> : null}
          {contexts.map(c => (
            <option key={c.name} value={c.name}>
              {c.name}{c.current ? ' ●' : ''}
            </option>
          ))}
        </select>
        <span className="ctx-chev" aria-hidden>
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M4 6 8 10 12 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      {mut.isError && <span className="err">switch failed</span>}
    </div>
  );
}
