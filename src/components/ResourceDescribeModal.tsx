import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { ResourceKind } from '../types';
import { describeResource } from '../api/tauri';
import { HighlightText } from './HighlightText';
import { ExportButton } from './ExportButton';

interface ResourceDescribeModalProps {
  kind: ResourceKind;
  name: string;
  namespace: string;
  ctxName: string;
  onClose: () => void;
}

export function ResourceDescribeModal({ kind, name, namespace, ctxName, onClose }: ResourceDescribeModalProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['describe-resource', ctxName, namespace, kind, name],
    queryFn: () => describeResource(ctxName, namespace, kind, name),
    enabled: !!ctxName,
  });

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleCopy = () => {
    if (data) navigator.clipboard.writeText(data);
  };

  return (
    <div className="pod-modal-backdrop" onMouseDown={onClose}>
      <div className="pod-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="pod-modal-head">
          <span className="pod-modal-title">Describe</span>
          <span className="pod-modal-subtitle">{namespace ? `${namespace}/` : ''}{name}</span>
          <button className="pod-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pod-modal-body">
          {isLoading ? (
            <div className="pod-modal-loading">Loading describe…</div>
          ) : error ? (
            <div className="pod-modal-error">Error: {(error as Error).message}</div>
          ) : !data ? (
            <div className="pod-modal-empty">No describe output.</div>
          ) : (
            <>
              <div className="yaml-actions">
                <button className="ctx-item" onClick={handleCopy} title="复制 describe 输出到剪贴板">Copy</button>
                <ExportButton fileName={`${name}.txt`} content={data ?? ''} />
              </div>
              <pre className="describe-output mono">
                {data.split('\n').map((line, i) => (
                  <div key={i} className="describe-line">
                    <HighlightText text={line} />
                  </div>
                ))}
              </pre>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
