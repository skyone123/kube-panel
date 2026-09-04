import { describe, it, expect, vi } from 'vitest';

// Mock @tauri-apps/api/core invoke
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { listContexts, getPods, getDeployments, rolloutRestart, rolloutScale, rolloutUndo, rolloutHistory, startPortForward, stopPortForward, listPortForwards, clearPortForward, streamEvents } from './tauri';

describe('api wrappers', () => {
  it('listContexts calls invoke with list_contexts', async () => {
    (invoke as any).mockResolvedValue([{ name: 'dev', cluster: 'c', user: 'u', namespace: null, current: false }]);
    const r = await listContexts();
    expect(invoke).toHaveBeenCalledWith('list_contexts');
    expect(r[0].name).toBe('dev');
  });

  it('getPods passes context + namespace', async () => {
    (invoke as any).mockResolvedValue([]);
    await getPods('dev', 'default');
    expect(invoke).toHaveBeenCalledWith('get_pods', { context: 'dev', namespace: 'default' });
  });

  it('getDeployments passes context + namespace', async () => {
    (invoke as any).mockResolvedValue([]);
    await getDeployments('dev', 'default');
    expect(invoke).toHaveBeenCalledWith('get_deployments', { context: 'dev', namespace: 'default' });
  });

  it('rolloutRestart passes context + namespace + name', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await rolloutRestart('dev', 'default', 'web');
    expect(invoke).toHaveBeenCalledWith('rollout_restart', { context: 'dev', namespace: 'default', name: 'web' });
  });

  it('rolloutScale passes context + namespace + name + replicas', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await rolloutScale('dev', 'default', 'web', 5);
    expect(invoke).toHaveBeenCalledWith('rollout_scale', { context: 'dev', namespace: 'default', name: 'web', replicas: 5 });
  });

  it('rolloutUndo passes context + namespace + name + toRevision', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await rolloutUndo('dev', 'default', 'web', 3);
    expect(invoke).toHaveBeenCalledWith('rollout_undo', { context: 'dev', namespace: 'default', name: 'web', toRevision: 3 });
  });

  it('rolloutUndo passes null when no revision', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await rolloutUndo('dev', 'default', 'web', null);
    expect(invoke).toHaveBeenCalledWith('rollout_undo', { context: 'dev', namespace: 'default', name: 'web', toRevision: null });
  });

  it('rolloutHistory passes context + namespace + name', async () => {
    (invoke as any).mockResolvedValue('');
    await rolloutHistory('dev', 'default', 'web');
    expect(invoke).toHaveBeenCalledWith('rollout_history', { context: 'dev', namespace: 'default', name: 'web' });
  });

  it('startPortForward passes context + namespace + target + ports', async () => {
    (invoke as any).mockResolvedValue('pf-0');
    await startPortForward('dev', 'default', 'pod/nginx', 8080, 80);
    expect(invoke).toHaveBeenCalledWith('start_port_forward', { context: 'dev', namespace: 'default', target: 'pod/nginx', localPort: 8080, remotePort: 80 });
  });

  it('stopPortForward passes id', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await stopPortForward('pf-0');
    expect(invoke).toHaveBeenCalledWith('stop_port_forward', { id: 'pf-0' });
  });

  it('listPortForwards calls invoke with list_port_forwards', async () => {
    (invoke as any).mockResolvedValue([]);
    await listPortForwards();
    expect(invoke).toHaveBeenCalledWith('list_port_forwards');
  });

  it('clearPortForward passes id', async () => {
    (invoke as any).mockResolvedValue(undefined);
    await clearPortForward('pf-0');
    expect(invoke).toHaveBeenCalledWith('clear_port_forward', { id: 'pf-0' });
  });

  it('streamEvents passes context + namespace', async () => {
    (invoke as any).mockResolvedValue('s-0');
    await streamEvents('dev', 'default');
    expect(invoke).toHaveBeenCalledWith('stream_events', { context: 'dev', namespace: 'default' });
  });
});
