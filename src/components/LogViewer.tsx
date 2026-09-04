import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
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

  // Fullscreen + search state — intentionally NOT in the streaming effect deps
  // so toggling fullscreen or typing a search does NOT restart the stream.
  const [maximized, setMaximized] = useState(false);
  const [search, setSearch] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentLineRef = useRef<HTMLDivElement | null>(null);
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

  // --- Derived: display lines + regex search ---

  // Flatten the chunk buffer into individual display lines.
  const displayLines = useMemo(() => {
    if (lines.length === 0) return [];
    return lines.join('').split('\n');
  }, [lines]);

  // Compile the user's search string into a global regex (for highlighting)
  // and a non-global regex (for .test() without lastIndex pitfalls).
  const { regex, testRegex, error } = useMemo(() => {
    if (!search) return { regex: null, testRegex: null, error: '' };
    try {
      const flags = caseSensitive ? 'g' : 'gi';
      const testFlags = caseSensitive ? '' : 'i';
      return { regex: new RegExp(search, flags), testRegex: new RegExp(search, testFlags), error: '' };
    } catch {
      return { regex: null, testRegex: null, error: 'invalid pattern' };
    }
  }, [search, caseSensitive]);

  // Indices of displayLines that match the regex.
  const matchIndices = useMemo(() => {
    if (!testRegex) return [];
    const indices: number[] = [];
    for (let i = 0; i < displayLines.length; i++) {
      if (testRegex.test(displayLines[i])) indices.push(i);
    }
    return indices;
  }, [testRegex, displayLines]);

  // Clamp currentMatch when the match list shrinks (ring buffer drops oldest).
  useEffect(() => {
    if (matchIndices.length === 0) {
      if (currentMatch !== 0) setCurrentMatch(0);
    } else if (currentMatch >= matchIndices.length) {
      setCurrentMatch(0);
    }
  }, [matchIndices.length, currentMatch]);

  // Auto-scroll to bottom on new lines when autoScroll is on.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

  // Scroll the current match line into view.
  useEffect(() => {
    currentLineRef.current?.scrollIntoView({ block: 'center' });
  }, [currentMatch, matchIndices]);

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

  const handleExport = () => {
    if (lines.length === 0) return;
    const blob = new Blob([lines.join('')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pod?.name ?? 'logs'}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Split a single line into [text, <mark>, text, <mark>, …] segments.
  // matchAll on a global regex does NOT mutate lastIndex (it clones internally).
  const highlightLine = (line: string, isCurrent: boolean): ReactNode => {
    if (!regex || !line) return line;
    const className = isCurrent ? 'log-match current' : 'log-match';
    const parts: ReactNode[] = [];
    let last = 0;
    let key = 0;
    for (const m of line.matchAll(regex)) {
      if (m.index > last) parts.push(line.slice(last, m.index));
      parts.push(<mark key={key++} className={className}>{m[0]}</mark>);
      last = m.index + m[0].length;
    }
    if (last < line.length) parts.push(line.slice(last));
    return parts.length ? parts : line;
  };

  const containers = pod?.containers ?? [];
  const currentLineIdx = matchIndices.length > 0 ? matchIndices[currentMatch] : -1;

  // --- Build controls + log area as shared content (used in both layouts) ---

  const controls = (
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

      {/* Regex search */}
      <div className="lc-search">
        <input
          type="search"
          className="lc-search-input"
          placeholder="regex…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search logs (regex)"
        />
        <label className="lc-field lc-check" title="Case sensitive">
          <input
            type="checkbox"
            checked={caseSensitive}
            onChange={e => setCaseSensitive(e.target.checked)}
          />
          <span>Aa</span>
        </label>
        <span className={`lc-match-count${error ? ' err' : ''}`}>
          {error || `${matchIndices.length} ${matchIndices.length === 1 ? 'match' : 'matches'}`}
        </span>
        <button
          className="lc-nav-btn"
          onClick={() => setCurrentMatch(m => (m - 1 + matchIndices.length) % matchIndices.length)}
          disabled={matchIndices.length === 0}
          title="Previous match"
        >↑</button>
        <button
          className="lc-nav-btn"
          onClick={() => setCurrentMatch(m => (m + 1) % matchIndices.length)}
          disabled={matchIndices.length === 0}
          title="Next match"
        >↓</button>
      </div>

      {/* Right-aligned actions */}
      <div className="lc-actions">
        <button className="lc-btn" onClick={() => setMaximized(m => !m)}>
          {maximized ? '⤡ Restore' : '⤢ Fullscreen'}
        </button>
        <button className="lc-btn" onClick={handleExport} disabled={lines.length === 0}>
          Export
        </button>
        {running && (
          <button className="lc-stop" onClick={handleStop}>Stop</button>
        )}
      </div>
    </div>
  );

  const logArea = (
    <div
      ref={scrollRef}
      className={`logs${displayLines.length === 0 ? ' placeholder' : ''}`}
      onScroll={onScroll}
    >
      {displayLines.length === 0
        ? (running ? 'Waiting for logs…' : 'No logs.')
        : displayLines.map((line, i) => (
            <div
              key={i}
              ref={i === currentLineIdx ? currentLineRef : undefined}
              className="log-line"
            >
              {highlightLine(line, i === currentLineIdx)}
            </div>
          ))}
    </div>
  );

  if (!pod || !ctxName) {
    return <div className="logs placeholder">Select a pod to view logs.</div>;
  }

  if (maximized) {
    return (
      <div className="log-fullscreen">
        {controls}
        {logArea}
      </div>
    );
  }

  return (
    <>
      {controls}
      {logArea}
    </>
  );
}
