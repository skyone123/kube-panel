export type Context = { name: string; cluster: string; user: string; namespace: string | null; current: boolean };

export type ContainerImage = { name: string; image: string; image_id: string };

export type PodView = { name: string; namespace: string; ready: string; status: string; restarts: number; age: string; ip: string; node: string; containers: string[]; container_images: ContainerImage[] };

export type ConfigMapView = { name: string; keys: string[] };

export type ConfigMapEntry = { key: string; value: string };
export type ConfigMapDataView = { name: string; entries: ConfigMapEntry[] };

export type EventView = { last_timestamp: string; type_: string; reason: string; message: string; involved_name: string };
export type EventChunk = { id: string; event: EventView };

export type PodActionMode = 'images' | 'configmaps' | 'describe' | 'events' | 'yaml';

export type RolloutMode = 'restart' | 'scale' | 'undo' | 'history';

export type DeploymentView = {
  name: string;
  namespace: string;
  ready: string;
  updated: string;
  replicas: number;
  available: number;
  age: string;
  images: string[];
};

export type MultiPodTarget = { namespace: string; pod: string; container: string | null };

export type HistoryEntry = { id: number | null; ts_ms: number; context: string; namespace: string | null; argv: string[]; exit_code: number | null; duration_ms: number | null; is_stream: boolean; favorite: boolean };

export type PfSessionView = {
  id: string;
  context: string;
  namespace: string;
  target: string;
  local_port: number;
  remote_port: number;
  started_at: number;
  status: string;
  message: string;
};

export type NodeView = {
  name: string;
  ready: boolean;
  status: string;
  roles: string[];
  version: string;
  os: string;
  internal_ip: string;
  age: string;
  pressure: string[];
  cpu_allocatable: string;
  mem_allocatable: string;
};
