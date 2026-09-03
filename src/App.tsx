import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { PodTable } from './components/PodTable';
import { useAppStore } from './stores/appStore';
import { getPods, listContexts } from './api/tauri';
import './App.css';

export default function App() {
  const { namespace } = useAppStore();
  const [q, setQ] = useState('');
  // single source of truth: derive the current context from the ['contexts']
  // query itself (the `current` flag reflects the on-disk kubeconfig after
  // use_context). This makes the ['pods'] query key change whenever the
  // active context changes, so TanStack treats it as a NEW query and fetches
  // fresh pods — race-free, no separate ['currentContext'] query needed.
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const ctxName = contexts.find(c => c.current)?.name ?? '';
  const { data: pods = [] } = useQuery({
    queryKey: ['pods', ctxName, namespace],
    queryFn: () => getPods(ctxName, namespace),
    enabled: !!ctxName,
  });
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <input placeholder="filter pods…" value={q} onChange={e => setQ(e.target.value)} />
        <PodTable pods={pods} query={q} />
      </main>
    </div>
  );
}
