export type Context = { name: string; cluster: string; user: string; namespace: string | null; current: boolean };

export type ContainerImage = { name: string; image: string; image_id: string };

export type PodView = { name: string; namespace: string; ready: string; status: string; restarts: number; age: string; ip: string; node: string; containers: string[]; container_images: ContainerImage[] };

export type ConfigMapView = { name: string; keys: string[] };

export type ConfigMapEntry = { key: string; value: string };
export type ConfigMapDataView = { name: string; entries: ConfigMapEntry[] };

export type EventView = { last_timestamp: string; type_: string; reason: string; message: string; involved_name: string };

export type PodActionMode = 'images' | 'configmaps' | 'describe' | 'events';

export type MultiPodTarget = { namespace: string; pod: string; container: string | null };

export type HistoryEntry = { id: number | null; ts_ms: number; context: string; namespace: string | null; argv: string[]; exit_code: number | null; duration_ms: number | null; is_stream: boolean; favorite: boolean };
