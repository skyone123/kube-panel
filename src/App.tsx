import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { PodTable } from './components/PodTable';
import { LogViewer } from './components/LogViewer';
import { HistoryPanel } from './components/HistoryPanel';
import { NamespaceSwitcher } from './components/NamespaceSwitcher';
import { PodActionModal } from './components/PodActionModal';
import { useAppStore } from './stores/appStore';
import { getPods, listContexts, listHistory } from './api/tauri';
import type { PodView, PodActionMode } from './types';
import './App.css';

export default function App() {
  const { namespace } = useAppStore();
  const [q, setQ] = useState('');
  const [selectedPod, setSelectedPod] = useState<PodView | null>(null);
  const [histQuery, setHistQuery] = useState('');
  const [podAction, setPodAction] = useState<{ pod: PodView; mode: PodActionMode } | null>(null);
  // single source of truth: derive the current context from the ['contexts']
  // query itself (the `current` flag reflects the on-disk kubeconfig after
  // use_context). This makes the ['pods'] query key change whenever the
  // active context changes, so TanStack treats it as a NEW query and fetches
  // fresh pods — race-free, no separate ['currentContext'] query needed.
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const ctxName = contexts.find(c => c.current)?.name ?? '';
  const current = contexts.find(c => c.current) ?? null;
  const { data: pods = [] } = useQuery({
    queryKey: ['pods', ctxName, namespace],
    queryFn: () => getPods(ctxName, namespace),
    enabled: !!ctxName,
  });
  const { data: history = [] } = useQuery({ queryKey: ['history'], queryFn: () => listHistory(100) });

  const podCount = pods.length;
  const histCount = history.length;

  return (
    <div className="app-shell">
      <Sidebar ctxName={ctxName} cluster={current?.cluster ?? null} podCount={podCount} histCount={histCount} />
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <span className="ctx-label">CONTEXT</span>
            <span className={`ctx-name${ctxName ? '' : ' empty'}`}>{ctxName || '— no context —'}</span>
            <NamespaceSwitcher />
          </div>
          <div className="topbar-divider" />
          <div className="topbar-filter">
            <span className="search-icon" aria-hidden>
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                <circle cx="7" cy="7" r="4.5" />
                <path d="M10.5 10.5 14 14" strokeLinecap="round" />
              </svg>
            </span>
            <input
              className="filter-input"
              placeholder="Filter pods by name, namespace, node…"
              value={q}
              onChange={e => setQ(e.target.value)}
              aria-label="Filter pods"
            />
          </div>
        </header>

        <div className="content">
          <section className="card pod-card" id="pods">
            <div className="card-head">
              <h2>Pods</h2>
              <span className="head-meta">{podCount} running{podCount === 1 ? '' : ''}</span>
              <span className="spacer" />
            </div>
            <div className="pod-table-wrap">
              <PodTable pods={pods} query={q} onSelect={setSelectedPod} selected={selectedPod} onPodAction={(pod, mode) => setPodAction({ pod, mode })} />
            </div>
          </section>

          <div className="split">
            <section className="card log-card" id="logs">
              <div className="card-head">
                <h2>Logs</h2>
                {selectedPod ? (
                  <span className="head-meta">
                    {selectedPod.namespace}/{selectedPod.name}
                    {selectedPod.containers?.length ? ` · ${selectedPod.containers.join(', ')}` : ''}
                  </span>
                ) : null}
                <span className="spacer" />
              </div>
              <LogViewer pod={selectedPod} />
            </section>

            <section className="card history-card" id="history">
              <div className="card-head">
                <h2>History</h2>
                <span className="head-meta">{histCount}</span>
                <span className="spacer" />
                <div className="history-head-wrap">
                  <span className="search-icon" aria-hidden>
                    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <circle cx="7" cy="7" r="4.5" />
                      <path d="M10.5 10.5 14 14" strokeLinecap="round" />
                    </svg>
                  </span>
                  <input
                    className="filter-input"
                    placeholder="Search history…"
                    value={histQuery}
                    onChange={e => setHistQuery(e.target.value)}
                    aria-label="Search history"
                  />
                </div>
              </div>
              <HistoryPanel entries={history} query={histQuery} />
            </section>
          </div>
        </div>
      </div>
      {podAction && <PodActionModal pod={podAction.pod} mode={podAction.mode} onClose={() => setPodAction(null)} />}
    </div>
  );
}
