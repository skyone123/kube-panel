import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PodView } from '../types';
import { startExec, sendPtyInput, resizePty, stopExec, onPtyData, onPtyExit } from '../api/tauri';

interface ExecTerminalProps {
  pod: PodView;
  ctxName: string;
  onClose: () => void;
}

export function ExecTerminal({ pod, ctxName, onClose }: ExecTerminalProps) {
  const [container, setContainer] = useState('');
  const [command, setCommand] = useState('sh');
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);
  const unlistenDataRef = useRef<(() => void) | null>(null);
  const unlistenExitRef = useRef<(() => void) | null>(null);
  const termDivRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Cleanup on unmount: dispose terminal, unlisten events, stop exec
  useEffect(() => {
    return () => {
      const unData = unlistenDataRef.current;
      const unExit = unlistenExitRef.current;
      const id = idRef.current;
      const term = termRef.current;
      unlistenDataRef.current = null;
      unlistenExitRef.current = null;
      idRef.current = null;
      termRef.current = null;
      if (unData) { try { unData(); } catch { /* noop */ } }
      if (unExit) { try { unExit(); } catch { /* noop */ } }
      if (term) { try { term.dispose(); } catch { /* noop */ } }
      if (id) { try { void stopExec(id); } catch { /* noop */ } }
    };
  }, []);

  // ResizeObserver to fit the terminal when the container resizes
  useEffect(() => {
    if (!connected || !termDivRef.current) return;
    const el = termDivRef.current;
    const ro = new ResizeObserver(() => {
      if (fitRef.current) {
        try { fitRef.current.fit(); } catch { /* noop */ }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [connected]);

  const handleConnect = async () => {
    if (!ctxName) return;
    setError(null);
    const cont = container || (pod.container_images[0]?.name ?? '');
    if (!cont) {
      setError('No container available');
      return;
    }
    const cmd = command.trim().split(/\s+/).filter(Boolean);
    if (cmd.length === 0) {
      cmd.push('sh');
    }

    try {
      const id = await startExec(ctxName, pod.namespace, pod.name, cont, cmd);
      idRef.current = id;

      const term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: 'ui-monospace, "Cascadia Code", "JetBrains Mono", "SFMono-Regular", "Consolas", monospace',
        theme: { background: '#0d1117', foreground: '#e6edf3', cursor: '#e6edf3' },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      termRef.current = term;
      fitRef.current = fit;

      // Open terminal into the div
      if (termDivRef.current) {
        term.open(termDivRef.current);
        try { fit.fit(); } catch { /* noop */ }
      }

      // Wire events
      const unlistenData = await onPtyData((e) => {
        if (e.id === idRef.current && termRef.current) {
          termRef.current.write(e.data);
        }
      });
      unlistenDataRef.current = unlistenData;

      const unlistenExit = await onPtyExit((e) => {
        if (e.id === idRef.current && termRef.current) {
          const msg = e.code !== null ? `\r\n[process exited with code ${e.code}]\r\n` : '\r\n[process exited]\r\n';
          termRef.current.write(msg);
          setConnected(false);
        }
      });
      unlistenExitRef.current = unlistenExit;

      // User keystrokes → backend
      term.onData((data) => {
        const currentId = idRef.current;
        if (currentId) {
          try { void sendPtyInput(currentId, data); } catch { /* noop */ }
        }
      });

      // Resize events → backend
      term.onResize(({ cols, rows }) => {
        const currentId = idRef.current;
        if (currentId) {
          try { void resizePty(currentId, cols, rows); } catch { /* noop */ }
        }
      });

      setConnected(true);
      term.focus();
    } catch (e) {
      setError(String(e));
    }
  };

  const handleDisconnect = () => {
    const id = idRef.current;
    if (id) {
      try { void stopExec(id); } catch { /* noop */ }
    }
    setConnected(false);
    if (termRef.current) {
      termRef.current.write('\r\n[disconnected]\r\n');
    }
  };

  const containers = pod.container_images ?? [];

  return (
    <div className="pod-modal-backdrop" onMouseDown={onClose}>
      <div className="pod-modal exec-modal" onMouseDown={e => e.stopPropagation()}>
        <div className="pod-modal-head">
          <span className="pod-modal-title">Exec Shell</span>
          <span className="pod-modal-subtitle">{pod.namespace}/{pod.name}</span>
          <button className="pod-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="exec-toolbar">
          <label className="lc-field">
            <span className="lc-label">Container</span>
            <select
              className="lc-select"
              value={container}
              onChange={e => setContainer(e.target.value)}
              disabled={connected}
            >
              <option value="">default</option>
              {containers.map(c => (
                <option key={c.name} value={c.name}>{c.name}</option>
              ))}
            </select>
          </label>
          <label className="lc-field">
            <span className="lc-label">Command</span>
            <input
              className="lc-input exec-cmd-input"
              type="text"
              value={command}
              onChange={e => setCommand(e.target.value)}
              disabled={connected}
              onKeyDown={e => { if (e.key === 'Enter' && !connected) handleConnect(); }}
              placeholder="sh"
            />
          </label>
          <div className="exec-toolbar-actions">
            {!connected ? (
              <button className="lc-btn exec-connect-btn" onClick={handleConnect} disabled={!ctxName}>
                Connect
              </button>
            ) : (
              <button className="lc-btn exec-disconnect-btn" onClick={handleDisconnect}>
                Disconnect
              </button>
            )}
          </div>
        </div>
        <div className="exec-terminal-area">
          <div ref={termDivRef} className="exec-terminal" />
          {error && (
            <div className="exec-error">{error}</div>
          )}
          {!connected && !error && !termRef.current && (
            <div className="exec-placeholder">Click Connect to start a shell.</div>
          )}
        </div>
      </div>
    </div>
  );
}
