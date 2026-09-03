import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { PodTable } from './components/PodTable';
import { useAppStore } from './stores/appStore';
import { getPods, currentContext } from './api/tauri';
import './App.css';

export default function App() {
  const { namespace } = useAppStore();
  const [q, setQ] = useState('');
  const { data: cur } = useQuery({ queryKey: ['currentContext'], queryFn: currentContext });
  const ctxName = cur?.name ?? '';
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
