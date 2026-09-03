import { invoke } from '@tauri-apps/api/core';
import type { Context, PodView, HistoryEntry } from '../types';

export const listContexts = () => invoke<Context[]>('list_contexts');
export const currentContext = () => invoke<Context | null>('current_context');
export const useContext = (name: string) => invoke<void>('use_context', { name });
export const getPods = (context: string, namespace: string) => invoke<PodView[]>('get_pods', { context, namespace });
export const getPodLogs = (context: string, namespace: string, pod: string, container: string | null, previous: boolean, tail: number | null) =>
  invoke<string>('get_pod_logs', { context, namespace, pod, container, previous, tail });
export const listHistory = (limit: number) => invoke<HistoryEntry[]>('list_history', { limit });
export const searchHistory = (query: string, limit: number) => invoke<HistoryEntry[]>('search_history', { query, limit });
