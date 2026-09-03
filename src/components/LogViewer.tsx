import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPodLogs, listContexts, streamPodLogs, stopLogStream, onLogChunk, type LogChunk } from '../api/tauri';
import type { PodView } from '../types';
import { useAppStore } from '../stores/appStore';

const MAX_LINES = 5000;
const DROP_BATCH = 500;

export function LogViewer({ pod }: { pod: PodView | null }) {
  const { namespace } = useAppStore();
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const ctxName = contexts.find(c => c.current)?.name ?? '';

  const [lines, setLines] = useState<string[]>([]);
  const [follow, setFollow] = useState(true);
  const [container, setContainer] = useState('');
  const [previous, setPrevious] = useState(false);
  const [since, setSince] = useState('');
  const [tail, setTail] = useState(1000);
  const [running, setRunning] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);

  const scrollRef = useRef<HTMLPreElement | null>(null);
  const streamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Streaming / one-shot lifecycle. Re-runs when any dependency changes.
  useEffect(() => {
    // Tear down any active stream + listener before (re)starting.
    let cancelled = false;
    const prevId = streamIdRef.current;
    const prevUnlisten = unlistenRef.current;
    streamIdRef.current = null;
    unlistenRef.current = null;
    setRunning(false);

    const teardown = async () => {
      if (prevUnlisten) { try { prevUnlisten(); } catch { /* noop */ } }
      if (prevId) { try { await stopLogStream(prevId); } catch { /* noop */ } }
    };
    teardown();

    // Reset buffer on each new stream/shot.
    setLines([]);

    if (!pod || !ctxName) {
      return () => { /* cleanup already triggered above via teardown */ };
    }

    const cont = container || null;
    const sinceArg = since || null;

    if (follow) {
      // Streaming path via streamPodLogs + onLogChunk listener.
      let active = true;
      (async () => {
        try {
          const id = await streamPodLogs(ctxName, namespace, pod.name, cont, previous, tail, sinceArg);
          if (!active || cancelled) {
            // Component/effect torn down while we were starting — stop the orphan.
            try { await stopLogStream(id); } catch { /* noop */ }
            return;
          }
          const unlisten = await onLogChunk((chunk: LogChunk) => {
            if (chunk.id !== streamIdRef.current) return;
            setLines(prev => {
              const next = prev.concat(chunk.text.replace(/\r$/, ''));
              if (next.length > MAX_LINES) {
                return next.slice(next.length - (MAX_LINES - DROP_BATCH));
              }
              return next;
            });
          });
          if (!active || cancelled) {
            try { unlisten(); } catch { /* noop */ }
            try { await stopLogStream(id); } catch { /* noop */ }
            return;
          }
          streamIdRef.current = id;
          unlistenRef.current = unlisten;
          setRunning(true);
        } catch {
          setRunning(false);
        }
      })();

      return () => {
        active = false;
        cancelled = true;
        const id = streamIdRef.current;
        const un = unlistenRef.current;
        streamIdRef.current = null;
        unlistenRef.current = null;
        setRunning(false);
        if (un) { try { un(); } catch { /* noop */ } }
        if (id) { try { void stopLogStream(id); } catch { /* noop */ } }
      };
    } else {
      // One-shot path via getPodLogs (no event listener).
      let active = true;
      (async () => {
        try {
          const text = await getPodLogs(ctxName, namespace, pod.name, cont, previous, tail);
          if (!active || cancelled) return;
          setLines(text ? [text] : []);
        } catch {
          if (!active) return;
          setLines([]);
        }
      })();
      return () => {
        active = false;
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxName, namespace, pod?.name, container, previous, since, tail, follow]);

  // Auto-scroll to bottom on new lines when autoScroll is on.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= 30;
    setAutoScroll(atBottom);
  };

  const handleStop = () => {
    const id = streamIdRef.current;
    const un = unlistenRef.current;
    streamIdRef.current = null;
    unlistenRef.current = null;
    setRunning(false);
    if (un) { try { un(); } catch { /* noop */ } }
    if (id) { try { void stopLogStream(id); } catch { /* noop */ } }
  };

  const containers = pod?.containers ?? [];

  if (!pod || !ctxName) {
    return <div className="logs placeholder">Select a pod to view logs.</div>;
  }

  return (
    <>
      <div className="log-controls">
        <label className="lc-field">
          <span className="lc-label">Container</span>
          <select
            className="lc-select"
            value={container}
            onChange={e => setContainer(e.target.value)}
          >
            <option value="">default</option>
            {containers.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </label>

        <label className="lc-field lc-check">
          <input
            type="checkbox"
            checked={previous}
            onChange={e => setPrevious(e.target.checked)}
          />
          <span>Previous</span>
        </label>

        <label className="lc-field">
          <span className="lc-label">Since</span>
          <select
            className="lc-select"
            value={since}
            onChange={e => setSince(e.target.value)}
          >
            <option value="">All</option>
            <option value="5m">5m</option>
            <option value="1h">1h</option>
          </select>
        </label>

        <label className="lc-field">
          <span className="lc-label">Tail</span>
          <input
            className="lc-input"
            type="number"
            min={1}
            value={tail}
            onChange={e => setTail(Math.max(1, Number(e.target.value) || 1))}
          />
        </label>

        <label className="lc-field lc-check">
          <input
            type="checkbox"
            checked={follow}
            onChange={e => setFollow(e.target.checked)}
          />
          <span>Follow</span>
        </label>

        {running && (
          <button className="lc-stop" onClick={handleStop}>Stop</button>
        )}
      </div>

      <pre
        ref={scrollRef}
        className={`logs${lines.length === 0 ? ' placeholder' : ''}`}
        onScroll={onScroll}
      >
        {lines.length === 0
          ? (running ? 'Waiting for logs…' : 'No logs.')
          : lines.join('')}
      </pre>
    </>
  );
}
