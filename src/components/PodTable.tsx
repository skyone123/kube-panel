import { useEffect, useState } from 'react';
import type { PodView, PodActionMode } from '../types';
import { useContextMenu } from './useContextMenu';

const BAD = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']);

interface PodTableProps {
  pods: PodView[];
  query: string;
  onSelect?: (pod: PodView) => void;
  selected?: PodView | null;
  onPodAction?: (pod: PodView, mode: PodActionMode) => void;
  onMergeTail?: (pods: PodView[]) => void;
  onPortForward?: (pod: PodView) => void;
}

function statusClass(status: string): 'status-error' | 'status-ok' | 'status-warn' {
  if (BAD.has(status)) return 'status-error';
  return status === 'Running' ? 'status-ok' : 'status-warn';
}

function statusPill(status: string) {
  const cls = statusClass(status);
  if (cls === 'status-ok') return <span className="status-pill ok">{status}</span>;
  if (cls === 'status-error') return <span className="status-pill err">{status}</span>;
  return <span className="status-pill warn">{status}</span>;
}

export function PodTable({ pods, query, onSelect, selected, onPodAction, onMergeTail, onPortForward }: PodTableProps) {
  const q = query.trim().toLowerCase();
  const shown = q
    ? pods.filter(p =>
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q) ||
        p.node.toLowerCase().includes(q))
    : pods;
  const selectedKey = selected ? `${selected.namespace}/${selected.name}` : null;

  const { menu: ctxMenu, pos, menuRef, openMenu, closeMenu } = useContextMenu<PodView>();
  const [multiSel, setMultiSel] = useState<Set<string>>(new Set());

  // Drop multi-selection keys that no longer exist (namespace/context switch
  // or pods list refresh removed them). Without this, "Tail 3 pods" can show
  // while the target list is stale/empty.
  useEffect(() => {
    if (multiSel.size === 0) return;
    const valid = new Set(shown.map(p => `${p.namespace}/${p.name}`));
    setMultiSel(prev => {
      const next = new Set<string>();
      let changed = false;
      for (const k of prev) {
        if (valid.has(k)) next.add(k);
        else changed = true;
      }
      if (next.size !== prev.size) changed = true;
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pods, shown]);

  const allShownKeys = shown.map(p => `${p.namespace}/${p.name}`);
  const allSelected = allShownKeys.length > 0 && allShownKeys.every(k => multiSel.has(k));

  const copyName = (pod: PodView) => {
    navigator.clipboard.writeText(pod.name);
    closeMenu();
  };

  const copyKubectlLogs = (pod: PodView) => {
    const nsPart = pod.namespace ? `-n ${pod.namespace} ` : '';
    navigator.clipboard.writeText(`kubectl logs ${nsPart}${pod.name}`);
    closeMenu();
  };

  const fireAction = (mode: PodActionMode) => {
    if (ctxMenu) {
      onPodAction?.(ctxMenu.target, mode);
      closeMenu();
    }
  };

  const toggleRow = (key: string) => {
    setMultiSel(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const toggleAll = () => {
    setMultiSel(prev => {
      if (allSelected) {
        const next = new Set(prev);
        for (const k of allShownKeys) next.delete(k);
        return next;
      }
      const next = new Set(prev);
      for (const k of allShownKeys) next.add(k);
      return next;
    });
  };

  const clearMulti = () => setMultiSel(new Set());

  const selectedPods = pods.filter(p => multiSel.has(`${p.namespace}/${p.name}`));

  if (shown.length === 0) {
    return (
      <div className="pod-empty">
        {pods.length === 0 ? 'No pods in this namespace.' : 'No pods match your filter.'}
      </div>
    );
  }

  return (
    <>
      {multiSel.size >= 2 && (
        <div className="pod-multi-bar">
          <button
            className="lc-btn"
            onClick={() => { onMergeTail?.(selectedPods); clearMulti(); }}
            title="合并 tail 选中 pod 的日志（多路流式输出）"
          >
            Tail {multiSel.size} pods
          </button>
          <button className="lc-btn" onClick={clearMulti} title="清除多选">Clear</button>
        </div>
      )}
      <table className="pod-table">
        <thead>
          <tr>
            <th className="col-sel">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={toggleAll}
                aria-label="Select all visible pods"
                title="全选/取消全选当前可见 pod（勾选后可合并 tail 日志）"
              />
            </th>
            <th>Name</th><th>Namespace</th><th>Ready</th><th>Status</th>
            <th>Restarts</th><th>Age</th><th>Node</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(p => {
            const cls = statusClass(p.status);
            const key = `${p.namespace}/${p.name}`;
            const isSel = key === selectedKey;
            const isMultiSel = multiSel.has(key);
            const highRestarts = p.restarts >= 1;
            return (
              <tr
                key={key}
                className={`pod-row ${cls}${isSel ? ' selected' : ''}`}
                onClick={() => onSelect?.(p)}
                onContextMenu={e => openMenu(e, p)}
                style={{ cursor: onSelect ? 'pointer' : 'default' }}
              >
                <td className="col-sel">
                  <input
                    type="checkbox"
                    checked={isMultiSel}
                    onClick={e => e.stopPropagation()}
                    onChange={() => toggleRow(key)}
                    aria-label={`Select ${p.name}`}
                    title="勾选以加入多选 tail"
                  />
                </td>
                <td className="col-name">{p.name}</td>
                <td className="col-ns">{p.namespace}</td>
                <td className="col-ready">{p.ready}</td>
                <td>{statusPill(p.status)}</td>
                <td className={highRestarts ? 'restarts-high' : ''}>{p.restarts}</td>
                <td>{p.age}</td>
                <td className="col-node">{p.node}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {ctxMenu && (
        <div
          ref={menuRef}
          className="pod-ctx-menu"
          style={{ left: pos.x, top: pos.y }}
        >
          <button className="ctx-item" onClick={() => copyName(ctxMenu.target)} title="复制 pod 名">
            Copy name
          </button>
          <button className="ctx-item" onClick={() => copyKubectlLogs(ctxMenu.target)} title="复制等价的 kubectl logs 命令">
            Copy kubectl logs
          </button>
          <div className="ctx-sep" />
          <button className="ctx-item" onClick={() => fireAction('images')} title="查看该 pod 各容器的镜像 tag 与 imageID">
            Show images
          </button>
          <button className="ctx-item" onClick={() => fireAction('configmaps')} title="查看该 pod 引用的 ConfigMap 键值">
            Show ConfigMaps
          </button>
          <button className="ctx-item" onClick={() => { onPortForward?.(ctxMenu.target); closeMenu(); }} title="打开 port-forward 面板并预填 pod/名称（本地端口转发）">
            Port-forward
          </button>
          <button className="ctx-item" onClick={() => fireAction('secrets')} title="查看该命名空间内的 Secret 键值（值默认打码，可主动揭秘）">
            Show Secrets
          </button>
          <button className="ctx-item" onClick={() => fireAction('yaml')} title="查看该 pod 的 YAML（只读）">
            View YAML
          </button>
          <button className="ctx-item" onClick={() => fireAction('exec')} title="kubectl exec -it 进入容器终端（交互式）">
            Exec shell
          </button>
          <button className="ctx-item" onClick={() => fireAction('describe')} title="kubectl describe pod 文本，CrashLoop/OOM 高亮">
            Describe
          </button>
          <button className="ctx-item" onClick={() => fireAction('events')} title="该 pod 的结构化事件表（可实时流）">
            Events
          </button>
        </div>
      )}
    </>
  );
}
