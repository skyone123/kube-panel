export type Context = { name: string; cluster: string; user: string; namespace: string | null; current: boolean };
export type PodView = { name: string; namespace: string; ready: string; status: string; restarts: number; age: string; ip: string; node: string; containers: string[] };
export type HistoryEntry = { id: number | null; ts_ms: number; context: string; namespace: string | null; argv: string[]; exit_code: number | null; duration_ms: number | null; is_stream: boolean; favorite: boolean };
