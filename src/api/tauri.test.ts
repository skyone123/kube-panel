import { describe, it, expect, vi } from 'vitest';

// Mock @tauri-apps/api/core invoke
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { listContexts, getPods } from './tauri';

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
});
