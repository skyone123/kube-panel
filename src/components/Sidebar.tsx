import { ContextSwitcher } from './ContextSwitcher';

interface SidebarProps {
  ctxName: string;
  cluster: string | null;
  podCount: number;
  histCount: number;
}

export function Sidebar({ ctxName, cluster, podCount, histCount }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <span className="brand-mark" aria-hidden>
          {/* k8s-style helm wheel */}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M12 2.5 4.5 6.5v9.2L12 21.5l7.5-5.8V6.5L12 2.5Z" strokeLinejoin="round" />
            <path d="M12 7.5 8.5 9.5v5L12 16.5l3.5-2v-5L12 7.5Z" strokeLinejoin="round" />
            <path d="M12 2.5v5M4.5 6.5 8.5 9.5M19.5 6.5 15.5 9.5M12 16.5v5M8.5 14.5 4.5 15.7M15.5 14.5 19.5 15.7" strokeLinecap="round" />
          </svg>
        </span>
        <span className="brand-text">
          <span className="brand-title">kube-panel</span>
          <span className="brand-sub">k8s ops</span>
        </span>
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Context</div>
        <ContextSwitcher />
        {cluster ? (
          <div className="ctx-cluster" title={cluster}>cluster: {cluster}</div>
        ) : null}
      </div>

      <div className="sidebar-section">
        <div className="sidebar-label">Resources</div>
        <ul className="nav-list">
          <li>
            <a className="nav-item active" href="#pods">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2" y="3" width="12" height="9" rx="1.5" />
                <path d="M2 6h12M5 9h2" strokeLinecap="round" />
              </svg>
              Pods
              <span className="nav-count">{podCount}</span>
            </a>
          </li>
          <li>
            <a className="nav-item" href="#logs">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
                <path d="M5 6h6M5 8.5h6M5 11h4" strokeLinecap="round" />
              </svg>
              Logs
            </a>
          </li>
          <li>
            <a className="nav-item" href="#history">
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M2.5 8a5.5 5.5 0 1 1 1.6 3.9" />
                <path d="M2.5 8H5M2.5 8 4 6.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              History
              <span className="nav-count">{histCount}</span>
            </a>
          </li>
        </ul>
      </div>

      <div className="sidebar-footer">
        <span className="status-dot" />
        {ctxName ? 'connected' : 'disconnected'}
      </div>
    </aside>
  );
}
