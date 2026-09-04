import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { Context, PodView, HistoryEntry, EventView, ConfigMapView } from '../types';

export const listContexts = () => invoke<Context[]>('list_contexts');
export const currentContext = () => invoke<Context | null>('current_context');
export const useContext = (name: string) => invoke<void>('use_context', { name });
export const getPods = (context: string, namespace: string) => invoke<PodView[]>('get_pods', { context, namespace });
export const listNamespaces = (context: string) => invoke<string[]>('list_namespaces', { context });
export const getPodLogs = (context: string, namespace: string, pod: string, container: string | null, previous: boolean, tail: number | null) =>
  invoke<string>('get_pod_logs', { context, namespace, pod, container, previous, tail });
export const listHistory = (limit: number) => invoke<HistoryEntry[]>('list_history', { limit });
export const searchHistory = (query: string, limit: number) => invoke<HistoryEntry[]>('search_history', { query, limit });

export const describePod = (context: string, namespace: string, pod: string) =>
  invoke<string>('describe_pod', { context, namespace, pod });
export const getEvents = (context: string, namespace: string) =>
  invoke<EventView[]>('get_events', { context, namespace });
export const getConfigmaps = (context: string, namespace: string) =>
  invoke<ConfigMapView[]>('get_configmaps', { context, namespace });
export const getPodConfigmaps = (context: string, namespace: string, pod: string) =>
  invoke<string[]>('get_pod_configmaps', { context, namespace, pod });

export type LogChunk = { id: string; text: string };

export const streamPodLogs = (
  context: string,
  namespace: string,
  pod: string,
  container: string | null,
  previous: boolean,
  tail: number | null,
  since: string | null,
) => invoke<string>('stream_pod_logs', { context, namespace, pod, container, previous, tail, since });

export const stopLogStream = (id: string) => invoke<void>('stop_log_stream', { id });

// Subscribe to log_chunk events; returns the unlisten handle. cb receives
// chunks for ALL streams — filter by id in the callback.
export function onLogChunk(cb: (chunk: LogChunk) => void): Promise<UnlistenFn> {
  return listen<LogChunk>('log_chunk', (e) => cb(e.payload));
}
