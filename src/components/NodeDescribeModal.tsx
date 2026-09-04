import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { NodeView } from '../types';
import { describeNode } from '../api/tauri';

interface NodeDescribeModalProps {
  node: NodeView;
  ctxName: string;
  onClose: () => void;
}

const HIGHLIGHT_RE = /(CrashLoopBackOff|OOMKilled|ImagePullBackOff|ErrImagePull|Error|Warning)/;
const HIGHLIGHT_KEYWORDS = new Set(['CrashLoopBackOff', 'OOMKilled', 'ImagePullBackOff', 'ErrImagePull', 'Error', 'Warning']);

function HighlightText({ text }: { text: string }) {
  const parts = text.split(HIGHLIGHT_RE);
  return (
    <>
      {parts.map((part, i) =>
        part && HIGHLIGHT_KEYWORDS.has(part)
          ? <mark key={i} className="ctx-highlight">{part}</mark>
          : <span key={i}>{part}</span>
      )}
    </>
  );
}

export function NodeDescribeModal({ node, ctxName, onClose }: NodeDescribeModalProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['describe-node', ctxName, node.name],
    queryFn: () => describeNode(ctxName, node.name),
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

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([data], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${node.name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="pod-modal-backdrop" onMouseDown={onClose}>
      <div className="pod-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="pod-modal-head">
          <span className="pod-modal-title">Describe</span>
          <span className="pod-modal-subtitle">{node.name}</span>
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
                <button className="ctx-item" onClick={handleCopy}>Copy</button>
                <button className="ctx-item" onClick={handleExport}>Export</button>
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
