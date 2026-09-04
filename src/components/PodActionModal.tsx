import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PodView, PodActionMode, EventView } from '../types';
import { describePod, getEvents, getConfigmaps, getPodConfigmaps, getConfigmap, getPodYaml, listContexts, streamEvents, stopLogStream, onEventChunk } from '../api/tauri';
import { HighlightText } from './HighlightText';

interface PodActionModalProps {
  pod: PodView;
  mode: PodActionMode;
  onClose: () => void;
}

function modeTitle(mode: PodActionMode): string {
  switch (mode) {
    case 'images': return 'Images';
    case 'configmaps': return 'ConfigMaps';
    case 'describe': return 'Describe';
    case 'events': return 'Events';
    case 'yaml': return 'YAML';
    case 'exec': return 'Exec';
  }
}

function ImagesPanel({ pod }: { pod: PodView }) {
  const images = pod.container_images ?? [];
  if (images.length === 0) {
    return <div className="pod-modal-empty">No container images.</div>;
  }
  return (
    <table className="image-table">
      <thead>
        <tr>
          <th>Container</th>
          <th>Image</th>
          <th>Image ID</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {images.map((img, i) => (
          <tr key={i}>
            <td className="col-container">{img.name}</td>
            <td className="col-image">{img.image}</td>
            <td className="col-digest" title={img.image_id}>{img.image_id}</td>
            <td>
              <button
                className="ctx-item"
                onClick={() => navigator.clipboard.writeText(img.image_id)}
              >
                Copy
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConfigmapsPanel({ pod, ctxName }: { pod: PodView; ctxName: string }) {
  const [selectedCm, setSelectedCm] = useState<string | null>(null);

  const podCmsQuery = useQuery({
    queryKey: ['pod-configmaps', ctxName, pod.namespace, pod.name],
    queryFn: () => getPodConfigmaps(ctxName, pod.namespace, pod.name),
    enabled: !!ctxName,
  });

  const allCmsQuery = useQuery({
    queryKey: ['configmaps', ctxName, pod.namespace],
    queryFn: () => getConfigmaps(ctxName, pod.namespace),
    enabled: !!ctxName,
  });

  const cmDataQuery = useQuery({
    queryKey: ['configmap-data', ctxName, pod.namespace, selectedCm],
    queryFn: () => getConfigmap(ctxName, pod.namespace, selectedCm!),
    enabled: !!selectedCm,
  });

  const referencedCms = podCmsQuery.data ?? [];
  const allCms = allCmsQuery.data ?? [];

  // Resolve which ConfigMap objects the pod references (by name intersection)
  const referencedSet = useMemo(() => new Set(referencedCms), [referencedCms]);
  const referencedObjects = useMemo(
    () => allCms.filter(cm => referencedSet.has(cm.name)),
    [allCms, referencedSet],
  );

  const currentCm = referencedObjects.find(cm => cm.name === selectedCm) ?? null;

  if (podCmsQuery.isLoading || allCmsQuery.isLoading) {
    return <div className="pod-modal-loading">Loading ConfigMaps…</div>;
  }
  if (podCmsQuery.error || allCmsQuery.error) {
    return (
      <div className="pod-modal-error">
        Error: {(podCmsQuery.error as Error)?.message ?? (allCmsQuery.error as Error)?.message ?? 'unknown'}
      </div>
    );
  }

  if (referencedCms.length === 0) {
    return <div className="pod-modal-empty">No referenced ConfigMaps for this pod.</div>;
  }

  const entries = cmDataQuery.data?.entries ?? [];

  const handleCopyAll = () => {
    const text = entries.map(e => `${e.key}=${e.value}`).join('\n');
    navigator.clipboard.writeText(text);
  };

  const handleExport = () => {
    const text = entries.map(e => `${e.key}=${e.value}`).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedCm ?? 'configmap'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="cm-split">
      <div className="cm-list">
        <div className="cm-list-head">Referenced ({referencedCms.length})</div>
        {referencedCms.map(name => (
          <button
            key={name}
            className={`cm-item${name === selectedCm ? ' active' : ''}`}
            onClick={() => setSelectedCm(name)}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="cm-detail">
        {currentCm ? (
          <>
            <div className="cm-detail-head">
              <span>{currentCm.name}</span>
              <span className="cm-detail-actions">
                <button
                  className="ctx-item"
                  onClick={handleCopyAll}
                  disabled={entries.length === 0}
                >
                  Copy all
                </button>
                <button
                  className="ctx-item"
                  onClick={handleExport}
                  disabled={entries.length === 0}
                >
                  Export
                </button>
              </span>
            </div>
            {cmDataQuery.isLoading ? (
              <div className="pod-modal-loading">Loading ConfigMap data…</div>
            ) : cmDataQuery.error ? (
              <div className="pod-modal-error">
                Error: {(cmDataQuery.error as Error).message}
              </div>
            ) : entries.length === 0 ? (
              <div className="pod-modal-empty">No keys.</div>
            ) : (
              entries.map(e => (
                <div key={e.key} className="cm-key-val">
                  <div className="cm-key-row">
                    <span className="cm-key">{e.key}</span>
                    <span className="cm-key-actions">
                      <button
                        className="ctx-item"
                        onClick={() => navigator.clipboard.writeText(e.key)}
                      >
                        Copy key
                      </button>
                      <button
                        className="ctx-item"
                        onClick={() => navigator.clipboard.writeText(e.value)}
                      >
                        Copy value
                      </button>
                    </span>
                  </div>
                  <pre className="cm-val cm-val-scroll">{e.value}</pre>
                </div>
              ))
            )}
          </>
        ) : (
          <div className="pod-modal-empty">Select a ConfigMap to view its data.</div>
        )}
      </div>
    </div>
  );
}

function DescribePanel({ pod, ctxName }: { pod: PodView; ctxName: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['describe-pod', ctxName, pod.namespace, pod.name],
    queryFn: () => describePod(ctxName, pod.namespace, pod.name),
    enabled: !!ctxName,
  });

  if (isLoading) return <div className="pod-modal-loading">Loading describe…</div>;
  if (error) return <div className="pod-modal-error">Error: {(error as Error).message}</div>;
  if (!data) return <div className="pod-modal-empty">No describe output.</div>;

  const lines = data.split('\n');
  return (
    <pre className="describe-output mono">
      {lines.map((line, i) => (
        <div key={i} className="describe-line">
          <HighlightText text={line} />
        </div>
      ))}
    </pre>
  );
}

const MAX_EVENTS = 500;

function EventsPanel({ pod, ctxName }: { pod: PodView; ctxName: string }) {
  const [live, setLive] = useState(true);
  const [events, setEvents] = useState<EventView[]>([]);
  const [onlyThisPod, setOnlyThisPod] = useState(true);
  const streamIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);

  // Snapshot mode: one-shot query, only enabled when live is off.
  const snapshotQuery = useQuery({
    queryKey: ['events', ctxName, pod.namespace],
    queryFn: () => getEvents(ctxName, pod.namespace),
    enabled: !!ctxName && !live,
  });

  // When not live, sync snapshot data into events buffer.
  useEffect(() => {
    if (!live && snapshotQuery.data) {
      setEvents(snapshotQuery.data);
    }
  }, [live, snapshotQuery.data]);

  // Live streaming lifecycle — mirrors LogViewer's pattern.
  useEffect(() => {
    // Tear down any active stream + listener before (re)starting.
    let cancelled = false;
    const prevId = streamIdRef.current;
    const prevUnlisten = unlistenRef.current;
    streamIdRef.current = null;
    unlistenRef.current = null;

    const teardown = async () => {
      if (prevUnlisten) { try { prevUnlisten(); } catch { /* noop */ } }
      if (prevId) { try { await stopLogStream(prevId); } catch { /* noop */ } }
    };
    teardown();

    // Reset buffer on each new stream.
    setEvents([]);

    if (!live || !ctxName) {
      return () => { /* cleanup already triggered above via teardown */ };
    }

    let active = true;
    (async () => {
      try {
        const id = await streamEvents(ctxName, pod.namespace);
        if (!active || cancelled) {
          try { await stopLogStream(id); } catch { /* noop */ }
          return;
        }
        const unlisten = await onEventChunk((chunk) => {
          if (chunk.id !== streamIdRef.current) return;
          setEvents(prev => {
            const next = prev.concat(chunk.event);
            if (next.length > MAX_EVENTS) {
              return next.slice(next.length - MAX_EVENTS);
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
      } catch {
        /* stream start failed — buffer stays empty */
      }
    })();

    return () => {
      active = false;
      cancelled = true;
      const id = streamIdRef.current;
      const un = unlistenRef.current;
      streamIdRef.current = null;
      unlistenRef.current = null;
      if (un) { try { un(); } catch { /* noop */ } }
      if (id) { try { void stopLogStream(id); } catch { /* noop */ } }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxName, pod.namespace, live]);

  const filtered = useMemo(() => {
    let list = events;
    if (onlyThisPod) {
      list = list.filter(e => e.involved_name === pod.name);
    }
    // Sort newest-first (backend may already sort, but ensure client-side)
    return [...list].sort((a, b) => {
      const ta = a.last_timestamp ? new Date(a.last_timestamp).getTime() : 0;
      const tb = b.last_timestamp ? new Date(b.last_timestamp).getTime() : 0;
      return tb - ta;
    });
  }, [events, onlyThisPod, pod.name]);

  const isLoading = live ? false : snapshotQuery.isLoading;
  const error = live ? null : snapshotQuery.error;

  return (
    <div className="events-wrap">
      <div className="events-head-row">
        <button
          className={`events-live-toggle${live ? ' live' : ' paused'}`}
          onClick={() => setLive(v => !v)}
        >
          <span className="live-dot" />
          {live ? 'Live' : 'Paused'}
        </button>
        <label className="events-filter lc-check">
          <input
            type="checkbox"
            checked={onlyThisPod}
            onChange={e => setOnlyThisPod(e.target.checked)}
          />
          <span>Only this pod</span>
        </label>
      </div>
      {isLoading ? (
        <div className="pod-modal-loading">Loading events…</div>
      ) : error ? (
        <div className="pod-modal-error">Error: {(error as Error).message}</div>
      ) : filtered.length === 0 ? (
        <div className="pod-modal-empty">
          {live
            ? 'Watching for events…'
            : onlyThisPod
              ? `No events for ${pod.name}. Uncheck "Only this pod" to see all events in ${pod.namespace}.`
              : `No events in ${pod.namespace}.`}
        </div>
      ) : (
        <table className="event-table">
          <thead>
            <tr>
              <th>Time</th><th>Type</th><th>Reason</th><th>Object</th><th>Message</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((ev, i) => (
              <tr key={i} className={`event-type-${ev.type_.toLowerCase()}`}>
                <td className="col-time">{ev.last_timestamp}</td>
                <td className="col-type">{ev.type_}</td>
                <td className="col-reason">{ev.reason}</td>
                <td className="col-object">{ev.involved_name}</td>
                <td className="col-message">{ev.message}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function YamlPanel({ pod, ctxName }: { pod: PodView; ctxName: string }) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pod-yaml', ctxName, pod.namespace, pod.name],
    queryFn: () => getPodYaml(ctxName, pod.namespace, pod.name),
    enabled: !!ctxName,
  });

  const handleCopy = () => {
    if (data) navigator.clipboard.writeText(data);
  };

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([data], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${pod.name}.yaml`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (isLoading) return <div className="pod-modal-loading">Loading YAML…</div>;
  if (error) return <div className="pod-modal-error">Error: {(error as Error).message}</div>;
  if (!data) return <div className="pod-modal-empty">No YAML output.</div>;

  const lines = data.split('\n');

  return (
    <>
      <div className="yaml-actions">
        <button className="ctx-item" onClick={handleCopy}>Copy</button>
        <button className="ctx-item" onClick={handleExport}>Export</button>
      </div>
      <pre className="describe-output mono">
        {lines.map((line, i) => {
          const trimmed = line.trimStart();
          // comment line
          if (trimmed.startsWith('#')) {
            return <div key={i} className="describe-line yaml-comment">{line}</div>;
          }
          // key: value — split on first colon
          const colonIdx = line.indexOf(':');
          if (colonIdx > 0) {
            const key = line.slice(0, colonIdx);
            const rest = line.slice(colonIdx);
            return (
              <div key={i} className="describe-line">
                <span className="yaml-key">{key}</span>
                <span>{rest}</span>
              </div>
            );
          }
          return <div key={i} className="describe-line">{line}</div>;
        })}
      </pre>
    </>
  );
}

export function PodActionModal({ pod, mode, onClose }: PodActionModalProps) {
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const ctxName = contexts.find(c => c.current)?.name ?? '';

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
          <span className="pod-modal-subtitle">{pod.namespace}/{pod.name}</span>
          <button className="pod-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pod-modal-body">
          {mode === 'images' && <ImagesPanel pod={pod} />}
          {mode === 'configmaps' && <ConfigmapsPanel pod={pod} ctxName={ctxName} />}
          {mode === 'describe' && <DescribePanel pod={pod} ctxName={ctxName} />}
          {mode === 'events' && <EventsPanel pod={pod} ctxName={ctxName} />}
          {mode === 'yaml' && <YamlPanel pod={pod} ctxName={ctxName} />}
        </div>
      </div>
    </div>
  );
}
