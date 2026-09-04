import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from './components/Sidebar';
import { PodTable } from './components/PodTable';
import { DeploymentTable } from './components/DeploymentTable';
import { NodeTable } from './components/NodeTable';
import { NodeDescribeModal } from './components/NodeDescribeModal';
import { LogViewer } from './components/LogViewer';
import { MergedLogViewer } from './components/MergedLogViewer';
import { HistoryPanel } from './components/HistoryPanel';
import { NamespaceSwitcher } from './components/NamespaceSwitcher';
import { PodActionModal } from './components/PodActionModal';
import { RolloutModal } from './components/RolloutModal';
import { PortForwardPanel } from './components/PortForwardPanel';
import { ResourceBrowser } from './components/ResourceBrowser';
import { useAppStore } from './stores/appStore';
import { getPods, getDeployments, getNodes, listContexts, listHistory, streamMultiPodLogs } from './api/tauri';
import type { PodView, PodActionMode, DeploymentView, RolloutMode, NodeView } from './types';
import './App.css';

export default function App() {
  const { namespace } = useAppStore();
  const [q, setQ] = useState('');
  const [selectedPod, setSelectedPod] = useState<PodView | null>(null);
  const [histQuery, setHistQuery] = useState('');
  const [podAction, setPodAction] = useState<{ pod: PodView; mode: PodActionMode } | null>(null);
  const [merge, setMerge] = useState<{ id: string; pods: PodView[] } | null>(null);
  const [resourceTab, setResourceTab] = useState<'pods' | 'deployments' | 'nodes' | 'more'>('pods');
  const [rolloutAction, setRolloutAction] = useState<{ deploy: DeploymentView; mode: RolloutMode } | null>(null);
  const [nodeDescribe, setNodeDescribe] = useState<{ node: NodeView } | null>(null);
  const [showPf, setShowPf] = useState(false);
  const [live, setLive] = useState(true);
  const refetchInterval = live ? 5000 : false;
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
    refetchInterval,
  });
  const { data: deployments = [] } = useQuery({
    queryKey: ['deployments', ctxName, namespace],
    queryFn: () => getDeployments(ctxName, namespace),
    enabled: !!ctxName,
    refetchInterval,
  });
  const { data: nodes = [] } = useQuery({
    queryKey: ['nodes', ctxName],
    queryFn: () => getNodes(ctxName),
    enabled: !!ctxName,
    refetchInterval,
  });
  const { data: history = [] } = useQuery({ queryKey: ['history'], queryFn: () => listHistory(100) });

  const podCount = pods.length;
  const deployCount = deployments.length;
  const nodeCount = nodes.length;
  const histCount = history.length;

  return (
    <div className="app-shell">
      <Sidebar ctxName={ctxName} cluster={current?.cluster ?? null} podCount={podCount} histCount={histCount} />      <div className="app-main">
        <header className="topbar">
          <div className="topbar-context">
            <span className="ctx-label">CONTEXT</span>
            <span className={`ctx-name${ctxName ? '' : ' empty'}`}>{ctxName || '— no context —'}</span>
            <NamespaceSwitcher />
            <button className="topbar-pf-btn" onClick={() => setShowPf(true)}>Port-forward</button>
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
              <div className="resource-tabs">
                <button
                  className={`resource-tab${resourceTab === 'pods' ? ' active' : ''}`}
                  onClick={() => setResourceTab('pods')}
                >Pods</button>
                <button
                  className={`resource-tab${resourceTab === 'deployments' ? ' active' : ''}`}
                  onClick={() => setResourceTab('deployments')}
                >Deployments</button>
                <button
                  className={`resource-tab${resourceTab === 'nodes' ? ' active' : ''}`}
                  onClick={() => setResourceTab('nodes')}
                >Nodes</button>
                <button
                  className={`resource-tab${resourceTab === 'more' ? ' active' : ''}`}
                  onClick={() => setResourceTab('more')}
                >More</button>
              </div>
              <button
                className={`live-toggle${live ? ' live' : ' paused'}`}
                onClick={() => setLive(v => !v)}
                title={live ? 'Auto-refresh every 5s (click to pause)' : 'Auto-refresh paused (click to resume)'}
              >
                <span className="live-dot" />
                {live ? 'Live' : 'Paused'}
              </button>
              <span className="head-meta">
                {resourceTab === 'pods' ? `${podCount} running` : resourceTab === 'deployments' ? `${deployCount} deployments` : resourceTab === 'nodes' ? `${nodeCount} nodes` : 'Browse resources'}
              </span>
              <span className="spacer" />
            </div>
            <div className="pod-table-wrap">
              {resourceTab === 'pods' ? (
                <PodTable pods={pods} query={q} onSelect={setSelectedPod} selected={selectedPod} onPodAction={(pod, mode) => setPodAction({ pod, mode })} onMergeTail={async (pods) => {
                  try {
                    const targets = pods.map(p => ({ namespace: p.namespace, pod: p.name, container: null }));
                    const id = await streamMultiPodLogs(ctxName, targets, false, 1000, null);
                    setMerge({ id, pods });
                  } catch {
                    /* noop */
                  }
                }} />
              ) : resourceTab === 'deployments' ? (
                <DeploymentTable deployments={deployments} query={q} onAction={(deploy, mode) => setRolloutAction({ deploy, mode })} />
              ) : resourceTab === 'nodes' ? (
                <NodeTable nodes={nodes} query={q} onDescribe={node => setNodeDescribe({ node })} />
              ) : (
                <ResourceBrowser ctxName={ctxName} namespace={namespace} live={live} />
              )}
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
      {rolloutAction && <RolloutModal deploy={rolloutAction.deploy} mode={rolloutAction.mode} ctxName={ctxName} onClose={() => setRolloutAction(null)} />}
      {merge && <MergedLogViewer mergeId={merge.id} podNames={merge.pods.map(p => p.name)} onClose={() => setMerge(null)} />}
      {showPf && <PortForwardPanel ctxName={ctxName} namespace={namespace} onClose={() => setShowPf(false)} />}
      {nodeDescribe && <NodeDescribeModal node={nodeDescribe.node} ctxName={ctxName} onClose={() => setNodeDescribe(null)} />}
    </div>
  );
}
