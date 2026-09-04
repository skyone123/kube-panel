import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { startPortForward, stopPortForward, listPortForwards, clearPortForward, onPfStatus } from '../api/tauri';

interface PortForwardPanelProps {
  ctxName: string;
  namespace: string;
  onClose: () => void;
}

function statusClass(status: string): string {
  if (status === 'running') return 'pf-status-pill running';
  if (status === 'failed') return 'pf-status-pill failed';
  return 'pf-status-pill stopped';
}

function relTime(ts: number): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  return `${Math.floor(diff / 3600000)}h ago`;
}

export function PortForwardPanel({ ctxName, namespace, onClose }: PortForwardPanelProps) {
  const qc = useQueryClient();
  const [target, setTarget] = useState('');
  const [localPort, setLocalPort] = useState('8080');
  const [remotePort, setRemotePort] = useState('80');
  const [confirming, setConfirming] = useState(false);

  const { data: sessions = [] } = useQuery({
    queryKey: ['port-forwards'],
    queryFn: listPortForwards,
  });

  // Live updates: invalidate the list whenever a pf_status event arrives.
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    onPfStatus(() => {
      qc.invalidateQueries({ queryKey: ['port-forwards'] });
    }).then(fn => { unlisten = fn; });
    return () => { if (unlisten) unlisten(); };
  }, [qc]);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const startMutation = useMutation({
    mutationFn: () => startPortForward(ctxName, namespace, target.trim(), Number(localPort), Number(remotePort)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['port-forwards'] });
      setConfirming(false);
      setTarget('');
    },
    onError: () => {
      setConfirming(false);
    },
  });

  const stopMutation = useMutation({
    mutationFn: (id: string) => stopPortForward(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['port-forwards'] }),
  });

  const clearMutation = useMutation({
    mutationFn: (id: string) => clearPortForward(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['port-forwards'] }),
  });

  const targetValid = target.trim().length > 0;
  const localNum = Number(localPort);
  const remoteNum = Number(remotePort);
  const portsValid = localNum >= 1 && localNum <= 65535 && remoteNum >= 1 && remoteNum <= 65535;
  const portWarn = localNum === remoteNum;

  const nsArg = namespace ? ` -n ${namespace}` : '';
  const cmd = `kubectl port-forward ${target.trim() || '<target>'} ${localPort || '<local>'}:${remotePort || '<remote>'}${nsArg} --context ${ctxName}`;

  return (
    <div className="pod-modal-backdrop" onMouseDown={onClose}>
      <div className="pod-modal" style={{ width: 760 }} onMouseDown={e => e.stopPropagation()}>
        <div className="pod-modal-head">
          <span className="pod-modal-title">Port-forward</span>
          <span className="pod-modal-subtitle">{ctxName}{namespace ? ` / ${namespace}` : ''}</span>
          <button className="pod-modal-close" onClick={onClose}>&#10005;</button>
        </div>
        <div className="pod-modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* Sessions list */}
          <div className="pf-sessions">
            {sessions.length === 0 ? (
              <div className="pf-empty">No active port-forward sessions.</div>
            ) : (
              <table className="pf-table">
                <thead>
                  <tr>
                    <th>Target</th>
                    <th>NS</th>
                    <th>Local &rarr; Remote</th>
                    <th>Status</th>
                    <th>Started</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(s => (
                    <tr key={s.id}>
                      <td className="pf-target">{s.target}</td>
                      <td className="pf-ns">{s.namespace || '—'}</td>
                      <td className="pf-ports">{s.local_port} &rarr; {s.remote_port}</td>
                      <td>
                        <span className={statusClass(s.status)}>{s.status}</span>
                        {s.message && <div className="pf-message">{s.message}</div>}
                      </td>
                      <td className="pf-rel">{relTime(s.started_at)}</td>
                      <td className="pf-actions">
                        {s.status === 'running' ? (
                          <button className="lc-btn pf-stop-btn" onClick={() => stopMutation.mutate(s.id)} title="停止 port-forward 并回收子进程">Stop</button>
                        ) : (
                          <button className="lc-btn pf-clear-btn" onClick={() => clearMutation.mutate(s.id)} title="清除该记录">Clear</button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* New session form */}
          <div className="pf-form">
            <div className="pf-form-row">
              <label className="lc-field">
                <span className="lc-label">Target</span>
                <input
                  className="pf-input pf-input-wide"
                  placeholder="pod/foo or svc/bar"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && targetValid && portsValid) setConfirming(true); }}
                  title="转发目标，格式 pod/名称 或 svc/名称"
                />
              </label>
              <label className="lc-field">
                <span className="lc-label">Local</span>
                <input
                  className="pf-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={localPort}
                  onChange={e => setLocalPort(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && targetValid && portsValid) setConfirming(true); }}
                  title="本地监听端口（1-65535）"
                />
              </label>
              <span className="pf-arrow">&rarr;</span>
              <label className="lc-field">
                <span className="lc-label">Remote</span>
                <input
                  className="pf-input"
                  type="number"
                  min={1}
                  max={65535}
                  value={remotePort}
                  onChange={e => setRemotePort(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && targetValid && portsValid) setConfirming(true); }}
                  title="转发到 pod 的端口（1-65535）"
                />
              </label>
              <button
                className="lc-btn rollout-confirm pf-start-btn"
                disabled={!targetValid || !portsValid}
                onClick={() => setConfirming(true)}
                title="启动 port-forward（启动前会显示完整命令确认）"
              >
                Start
              </button>
            </div>
            {portWarn && targetValid && portsValid && (
              <div className="pf-warn">Warning: local and remote ports are identical.</div>
            )}
            {startMutation.isError && !confirming && (
              <div className="rollout-result err">
                {(startMutation.error as Error)?.message ?? 'unknown error'}
              </div>
            )}

            {/* Confirm flow */}
            {confirming && (
              <div className="pf-confirm">
                <div className="rollout-cmd mono">{cmd}</div>
                {startMutation.isError && (
                  <div className="rollout-result err">
                    {(startMutation.error as Error)?.message ?? 'unknown error'}
                  </div>
                )}
                <div className="rollout-actions">
                  <button className="lc-btn" onClick={() => { setConfirming(false); }}>Cancel</button>
                  <button
                    className="lc-btn rollout-confirm"
                    disabled={startMutation.isPending}
                    onClick={() => startMutation.mutate()}
                  >
                    {startMutation.isPending ? 'Starting…' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
