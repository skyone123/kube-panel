import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { DeploymentView, RolloutMode } from '../types';
import { rolloutRestart, rolloutScale, rolloutUndo, rolloutHistory } from '../api/tauri';

interface RolloutModalProps {
  deploy: DeploymentView;
  mode: RolloutMode;
  ctxName: string;
  onClose: () => void;
}

function modeTitle(mode: RolloutMode): string {
  switch (mode) {
    case 'restart': return 'Restart';
    case 'scale': return 'Scale';
    case 'undo': return 'Undo';
    case 'history': return 'History';
  }
}

function RestartPanel({ deploy, ctxName, onClose }: { deploy: DeploymentView; ctxName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const cmd = `kubectl rollout restart deployment/${deploy.name} -n ${deploy.namespace} --context ${ctxName}`;
  const mutation = useMutation({
    mutationFn: () => rolloutRestart(ctxName, deploy.namespace, deploy.name),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments', ctxName, deploy.namespace] }),
  });

  return (
    <div className="rollout-panel">
      <div className="rollout-cmd mono">{cmd}</div>
      {mutation.isError && (
        <div className="rollout-result err">
          {(mutation.error as Error)?.message ?? 'unknown error'}
        </div>
      )}
      {mutation.isSuccess ? (
        <div className="rollout-result ok">
          <span>Restarted</span>
          <button className="lc-btn" onClick={() => qc.invalidateQueries({ queryKey: ['deployments', ctxName, deploy.namespace] })}>
            Refresh deployments
          </button>
          <button className="lc-btn" onClick={onClose}>Close</button>
        </div>
      ) : (
        <div className="rollout-actions">
          <button className="lc-btn" onClick={onClose}>Cancel</button>
          <button
            className="lc-btn rollout-confirm"
            disabled={mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Restarting…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}

function ScalePanel({ deploy, ctxName, onClose }: { deploy: DeploymentView; ctxName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [replicas, setReplicas] = useState(deploy.replicas);
  const cmd = `kubectl scale deployment/${deploy.name} --replicas=${replicas} -n ${deploy.namespace} --context ${ctxName}`;
  const mutation = useMutation({
    mutationFn: () => rolloutScale(ctxName, deploy.namespace, deploy.name, replicas),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments', ctxName, deploy.namespace] }),
  });

  const valid = replicas >= 0 && replicas !== deploy.replicas;

  return (
    <div className="rollout-panel">
      <div className="rollout-input-row">
        <label className="lc-field">
          <span className="lc-label">Replicas</span>
          <input
            type="number"
            className="rollout-input"
            min={0}
            value={replicas}
            onChange={e => setReplicas(Number(e.target.value))}
          />
        </label>
      </div>
      <div className="rollout-cmd mono">{cmd}</div>
      {replicas === 0 && (
        <div className="rollout-result warn">Scaling to 0 stops all pods of this deployment.</div>
      )}
      {mutation.isError && (
        <div className="rollout-result err">
          {(mutation.error as Error)?.message ?? 'unknown error'}
        </div>
      )}
      {mutation.isSuccess ? (
        <div className="rollout-result ok">
          <span>Scaled to {replicas}</span>
          <button className="lc-btn" onClick={() => qc.invalidateQueries({ queryKey: ['deployments', ctxName, deploy.namespace] })}>
            Refresh deployments
          </button>
          <button className="lc-btn" onClick={onClose}>Close</button>
        </div>
      ) : (
        <div className="rollout-actions">
          <button className="lc-btn" onClick={onClose}>Cancel</button>
          <button
            className="lc-btn rollout-confirm"
            disabled={mutation.isPending || !valid}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Scaling…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}

function UndoPanel({ deploy, ctxName, onClose }: { deploy: DeploymentView; ctxName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [revision, setRevision] = useState<string>('');
  const toRevision = revision.trim() === '' ? null : Number(revision);
  const revArg = toRevision !== null ? ` --to-revision=${toRevision}` : '';
  const cmd = `kubectl rollout undo deployment/${deploy.name}${revArg} -n ${deploy.namespace} --context ${ctxName}`;
  const mutation = useMutation({
    mutationFn: () => rolloutUndo(ctxName, deploy.namespace, deploy.name, toRevision),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['deployments', ctxName, deploy.namespace] }),
  });

  const valid = toRevision === null || (toRevision > 0 && !isNaN(toRevision));

  return (
    <div className="rollout-panel">
      <div className="rollout-input-row">
        <label className="lc-field">
          <span className="lc-label">To revision (optional)</span>
          <input
            type="number"
            className="rollout-input"
            placeholder="previous"
            value={revision}
            onChange={e => setRevision(e.target.value)}
          />
        </label>
      </div>
      <div className="rollout-cmd mono">{cmd}</div>
      {mutation.isError && (
        <div className="rollout-result err">
          {(mutation.error as Error)?.message ?? 'unknown error'}
        </div>
      )}
      {mutation.isSuccess ? (
        <div className="rollout-result ok">
          <span>Undone</span>
          <button className="lc-btn" onClick={() => qc.invalidateQueries({ queryKey: ['deployments', ctxName, deploy.namespace] })}>
            Refresh deployments
          </button>
          <button className="lc-btn" onClick={onClose}>Close</button>
        </div>
      ) : (
        <div className="rollout-actions">
          <button className="lc-btn" onClick={onClose}>Cancel</button>
          <button
            className="lc-btn rollout-confirm"
            disabled={mutation.isPending || !valid}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? 'Undoing…' : 'Confirm'}
          </button>
        </div>
      )}
    </div>
  );
}

function HistoryPanel({ deploy, ctxName }: { deploy: DeploymentView; ctxName: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['rollout-history', ctxName, deploy.namespace, deploy.name],
    queryFn: () => rolloutHistory(ctxName, deploy.namespace, deploy.name),
    enabled: !!ctxName,
  });

  if (isLoading) return <div className="pod-modal-loading">Loading history…</div>;
  if (error) return <div className="pod-modal-error">Error: {(error as Error).message}</div>;
  if (!data) return <div className="pod-modal-empty">No history output.</div>;

  return (
    <pre className="describe-output mono">{data}</pre>
  );
}

export function RolloutModal({ deploy, mode, ctxName, onClose }: RolloutModalProps) {
  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="pod-modal-backdrop" onMouseDown={onClose}>
      <div className="pod-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="pod-modal-head">
          <span className="pod-modal-title">{modeTitle(mode)}</span>
          <span className="pod-modal-subtitle">{deploy.namespace}/{deploy.name}</span>
          <button className="pod-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pod-modal-body">
          {mode === 'restart' && <RestartPanel deploy={deploy} ctxName={ctxName} onClose={onClose} />}
          {mode === 'scale' && <ScalePanel deploy={deploy} ctxName={ctxName} onClose={onClose} />}
          {mode === 'undo' && <UndoPanel deploy={deploy} ctxName={ctxName} onClose={onClose} />}
          {mode === 'history' && <HistoryPanel deploy={deploy} ctxName={ctxName} />}
        </div>
      </div>
    </div>
  );
}
