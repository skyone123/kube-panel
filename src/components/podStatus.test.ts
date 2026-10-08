import { describe, it, expect } from 'vitest';
import { filterPods, statusClass, statusOptions } from './podStatus';
import type { PodView } from '../types';

const pod = (over: Partial<PodView>): PodView => ({
  name: 'p',
  namespace: 'default',
  ready: '1/1',
  status: 'Running',
  restarts: 0,
  age: '1m',
  ip: '10.0.0.1',
  node: 'n1',
  containers: ['c'],
  container_images: [],
  ...over,
});

describe('statusClass', () => {
  it('flags the known bad reasons as errors', () => {
    for (const s of ['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']) {
      expect(statusClass(s)).toBe('status-error');
    }
  });

  it('treats Running as ok and every other status as warn', () => {
    expect(statusClass('Running')).toBe('status-ok');
    expect(statusClass('Pending')).toBe('status-warn');
    expect(statusClass('Completed')).toBe('status-warn');
  });
});

describe('statusOptions', () => {
  it('counts each distinct status', () => {
    const opts = statusOptions([
      pod({ status: 'Running' }),
      pod({ status: 'Running' }),
      pod({ status: 'Pending' }),
    ]);
    expect(opts).toEqual([
      { status: 'Pending', count: 1, cls: 'status-warn' },
      { status: 'Running', count: 2, cls: 'status-ok' },
    ]);
  });

  it('orders worst-first: errors, then warnings, then healthy', () => {
    const opts = statusOptions([
      pod({ status: 'Running' }),
      pod({ status: 'Pending' }),
      pod({ status: 'CrashLoopBackOff' }),
    ]);
    expect(opts.map(o => o.status)).toEqual(['CrashLoopBackOff', 'Pending', 'Running']);
  });

  it('orders same-class statuses by name, never by count', () => {
    // Counts change on every 5s live refetch. If they drove the order, two
    // same-severity rows would swap under the user's pointer while the panel is
    // open, and a click could toggle the wrong status.
    const tied = statusOptions([pod({ status: 'Unknown' }), pod({ status: 'Pending' })]);
    expect(tied.map(o => o.status)).toEqual(['Pending', 'Unknown']);

    // "Unknown" is the more common status here; name order must still win.
    const lopsided = statusOptions([
      pod({ status: 'Unknown' }),
      pod({ status: 'Unknown' }),
      pod({ status: 'Unknown' }),
      pod({ status: 'Pending' }),
    ]);
    expect(lopsided.map(o => o.status)).toEqual(['Pending', 'Unknown']);
    expect(lopsided.map(o => o.count)).toEqual([1, 3]);
  });

  it('returns nothing for an empty pod list', () => {
    expect(statusOptions([])).toEqual([]);
  });
});

describe('filterPods', () => {
  const pods = [
    pod({ name: 'web-1', status: 'Running', node: 'n1' }),
    pod({ name: 'web-2', status: 'CrashLoopBackOff', node: 'n2' }),
    pod({ name: 'db-1', namespace: 'data', status: 'Pending', node: 'n3' }),
  ];

  it('returns the input array itself when nothing restricts the list', () => {
    expect(filterPods(pods, '', [])).toBe(pods);
    expect(filterPods(pods, '   ', [])).toBe(pods);
  });

  it('matches name, namespace or node case-insensitively', () => {
    expect(filterPods(pods, 'WEB', []).map(p => p.name)).toEqual(['web-1', 'web-2']);
    expect(filterPods(pods, 'data', []).map(p => p.name)).toEqual(['db-1']);
    expect(filterPods(pods, 'N3', []).map(p => p.name)).toEqual(['db-1']);
  });

  it('filters by a single status', () => {
    expect(filterPods(pods, '', ['CrashLoopBackOff']).map(p => p.name)).toEqual(['web-2']);
  });

  it('treats several selected statuses as a union', () => {
    expect(filterPods(pods, '', ['CrashLoopBackOff', 'Pending']).map(p => p.name)).toEqual([
      'web-2',
      'db-1',
    ]);
  });

  it('ANDs the status filter with the text query', () => {
    expect(filterPods(pods, 'web', ['Running']).map(p => p.name)).toEqual(['web-1']);
    expect(filterPods(pods, 'db', ['CrashLoopBackOff'])).toEqual([]);
  });

  it('matches statuses exactly, so a partial string selects nothing', () => {
    expect(filterPods(pods, '', ['Crash'])).toEqual([]);
  });
});
