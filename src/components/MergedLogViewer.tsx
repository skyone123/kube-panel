import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { onLogChunk, stopLogStream, type LogChunk } from '../api/tauri';

const MAX_LINES = 5000;
const DROP_BATCH = 500;

interface MergedLogViewerProps {
  mergeId: string;
  podNames: string[];
  onClose: () => void;
}

export function MergedLogViewer({ mergeId, podNames, onClose }: MergedLogViewerProps) {
  const [lines, setLines] = useState<string[]>([]);
  const [autoScroll, setAutoScroll] = useState(true);
  const [search, setSearch] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [currentMatch, setCurrentMatch] = useState(0);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const currentLineRef = useRef<HTMLDivElement | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const stoppedRef = useRef(false);

  // Subscribe to log_chunk events filtered by mergeId. Stop on unmount.
  useEffect(() => {
    let cancelled = false;
    let un: (() => void) | null = null;
    (async () => {
      const ul = await onLogChunk((chunk: LogChunk) => {
        if (chunk.id !== mergeId) return;
        setLines(prev => {
          const next = prev.concat(chunk.text.replace(/\r$/, ''));
          if (next.length > MAX_LINES) {
            return next.slice(next.length - (MAX_LINES - DROP_BATCH));
          }
          return next;
        });
      });
      if (cancelled) {
        try { ul(); } catch { /* noop */ }
        return;
      }
      un = ul;
      unlistenRef.current = ul;
    })();

    return () => {
      cancelled = true;
      if (un) { try { un(); } catch { /* noop */ }
        unlistenRef.current = null;
      }
      if (!stoppedRef.current) {
        stoppedRef.current = true;
        try { void stopLogStream(mergeId); } catch { /* noop */ }
      }
    };
  }, [mergeId]);

  // Esc closes (stop + close).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!stoppedRef.current) {
          stoppedRef.current = true;
          try { void stopLogStream(mergeId); } catch { /* noop */ }
        }
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mergeId, onClose]);

  // Flatten chunk buffer into display lines.
  const displayLines = useMemo(() => {
    if (lines.length === 0) return [];
    return lines.join('').split('\n');
  }, [lines]);

  // Compile search regex.
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

  const matchIndices = useMemo(() => {
    if (!testRegex) return [];
    const indices: number[] = [];
    for (let i = 0; i < displayLines.length; i++) {
      if (testRegex.test(displayLines[i])) indices.push(i);
    }
    return indices;
  }, [testRegex, displayLines]);

  useEffect(() => {
    if (matchIndices.length === 0) {
      if (currentMatch !== 0) setCurrentMatch(0);
    } else if (currentMatch >= matchIndices.length) {
      setCurrentMatch(0);
    }
  }, [matchIndices.length, currentMatch]);

  // Auto-scroll to bottom.
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [lines, autoScroll]);

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
    if (!stoppedRef.current) {
      stoppedRef.current = true;
      try { void stopLogStream(mergeId); } catch { /* noop */ }
    }
    onClose();
  };

  const handleExport = () => {
    if (lines.length === 0) return;
    const blob = new Blob([lines.join('')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `merged-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

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

  const currentLineIdx = matchIndices.length > 0 ? matchIndices[currentMatch] : -1;

  const controls = (
    <div className="log-controls">
      <div className="lc-search">
        <input
          type="search"
          className="lc-search-input"
          placeholder="regex…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search merged logs (regex)"
          title="正则搜索合并日志，支持上一个/下一个跳转"
        />
        <label className="lc-field lc-check" title="区分大小写">
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
          title="上一个匹配"
        >↑</button>
        <button
          className="lc-nav-btn"
          onClick={() => setCurrentMatch(m => (m + 1) % matchIndices.length)}
          disabled={matchIndices.length === 0}
          title="下一个匹配"
        >↓</button>
      </div>
      <div className="lc-actions">
        <button className="lc-btn" onClick={handleExport} disabled={lines.length === 0} title="导出当前缓冲区为 .log 文件">
          Export
        </button>
        <button className="lc-stop" onClick={handleStop} title="停止所有日志流并关闭窗口">Stop</button>
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
        ? 'Waiting for merged logs…'
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

  const podListStr = podNames.join(', ');

  return (
    <div className="log-fullscreen">
      <div className="merged-head">
        <span className="merged-title">Merged tail · {podNames.length} pods</span>
        <span className="merged-pods" title={podListStr}>{podListStr}</span>
      </div>
      {controls}
      {logArea}
    </div>
  );
}
