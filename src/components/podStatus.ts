import type { PodView } from '../types';

/**
 * Container waiting/terminated reasons that mean the pod is in a genuinely bad
 * state. Kept identical to the original PodTable set on purpose — the row
 * classes derived from it are asserted by tests and by CSS tokens.
 */
export const BAD = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']);

export type StatusClass = 'status-error' | 'status-ok' | 'status-warn';

export function statusClass(status: string): StatusClass {
  if (BAD.has(status)) return 'status-error';
  return status === 'Running' ? 'status-ok' : 'status-warn';
}

export interface StatusOption {
  /** Exact status string as reported by the backend (`PodView.status`). */
  status: string;
  /** How many pods in the *unfiltered* list currently have this status. */
  count: number;
  cls: StatusClass;
}

/** Sort rank: problems first, then warnings, then healthy. */
const CLASS_RANK: Record<StatusClass, number> = { 'status-error': 0, 'status-warn': 1, 'status-ok': 2 };

/**
 * Worst-first ordering, shared by the option list and StatusFilter's rows so a
 * re-appended (count 0) selection still sorts by severity instead of landing at
 * the bottom.
 *
 * Deliberately does NOT sort by count: counts change on every live refetch
 * (5s), so a count-based key makes same-severity rows swap places while the
 * panel is open — a click landing across that re-render would toggle a status
 * the user never aimed at. Severity and name are both stable per status string.
 */
export function compareStatusOptions(a: StatusOption, b: StatusOption): number {
  return CLASS_RANK[a.cls] - CLASS_RANK[b.cls] || a.status.localeCompare(b.status);
}

/**
 * Every distinct status present in `pods`, worst-first, each with its count.
 *
 * Counts come from the full pod list (not the name/node-filtered subset) so the
 * dropdown stays stable while the user types in the search box: an option never
 * disappears — and a selection can never get stuck invisible — because the
 * other filter narrowed the list.
 */
export function statusOptions(pods: PodView[]): StatusOption[] {
  const counts = new Map<string, number>();
  for (const p of pods) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);
  return Array.from(counts, ([status, count]) => ({ status, count, cls: statusClass(status) })).sort(
    compareStatusOptions,
  );
}

/**
 * Apply the topbar text query (name / namespace / node, case-insensitive) and
 * the status multi-select. Both are ANDed; an empty query or an empty status
 * selection means "no restriction" on that dimension.
 *
 * Returns `pods` itself when nothing restricts the list, so callers that key
 * effects off the result keep a stable reference.
 */
export function filterPods(pods: PodView[], query: string, statuses: string[]): PodView[] {
  const q = query.trim().toLowerCase();
  const picked = statuses.length > 0 ? new Set(statuses) : null;
  if (!q && !picked) return pods;
  return pods.filter(
    p =>
      (!picked || picked.has(p.status)) &&
      (!q ||
        p.name.toLowerCase().includes(q) ||
        p.namespace.toLowerCase().includes(q) ||
        p.node.toLowerCase().includes(q)),
  );
}
