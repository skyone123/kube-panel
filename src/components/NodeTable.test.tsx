import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeTable } from './NodeTable';
import type { NodeView } from '../types';

const nodes: NodeView[] = [
  { name: 'control-node', ready: true, status: 'Ready', roles: ['control-plane'], version: 'v1.30.0', os: 'linux/amd64', internal_ip: '10.0.0.5', age: '5d', pressure: [], cpu_allocatable: '4', mem_allocatable: '16Gi' },
  { name: 'worker-node', ready: false, status: 'NotReady', roles: [], version: 'v1.29.0', os: 'linux/amd64', internal_ip: '10.0.0.6', age: '3d', pressure: ['MemoryPressure'], cpu_allocatable: '2', mem_allocatable: '8Gi' },
];

describe('NodeTable', () => {
  it('filters nodes by name', () => {
    render(<NodeTable nodes={nodes} query="control" />);
    expect(screen.getByText('control-node')).toBeInTheDocument();
    expect(screen.queryByText('worker-node')).not.toBeInTheDocument();
  });

  it('filters nodes by role', () => {
    render(<NodeTable nodes={nodes} query="control-plane" />);
    expect(screen.getByText('control-node')).toBeInTheDocument();
    expect(screen.queryByText('worker-node')).not.toBeInTheDocument();
  });

  it('filters nodes by internal ip', () => {
    render(<NodeTable nodes={nodes} query="10.0.0.6" />);
    expect(screen.getByText('worker-node')).toBeInTheDocument();
    expect(screen.queryByText('control-node')).not.toBeInTheDocument();
  });

  it('renders all columns', () => {
    render(<NodeTable nodes={nodes} query="" />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Roles')).toBeInTheDocument();
    expect(screen.getByText('Version')).toBeInTheDocument();
    expect(screen.getByText('OS')).toBeInTheDocument();
    expect(screen.getByText('Internal IP')).toBeInTheDocument();
    expect(screen.getByText('Pressure')).toBeInTheDocument();
    expect(screen.getByText('Allocatable')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
  });

  it('shows ready status pill for healthy node', () => {
    render(<NodeTable nodes={nodes} query="" />);
    const pill = screen.getByText('Ready');
    expect(pill.className).toContain('ok');
  });

  it('shows notready status pill for unhealthy node', () => {
    render(<NodeTable nodes={nodes} query="" />);
    const pill = screen.getByText('NotReady');
    expect(pill.className).toContain('err');
  });

  it('shows pressure badges for pressured node', () => {
    render(<NodeTable nodes={nodes} query="" />);
    expect(screen.getByText('MemoryPressure')).toBeInTheDocument();
  });

  it('shows dash for no roles', () => {
    render(<NodeTable nodes={nodes} query="" />);
    const dashes = screen.getAllByText('—');
    // worker-node has no roles, no pressure — at least 2 dashes
    expect(dashes.length).toBeGreaterThanOrEqual(2);
  });

  it('right-click opens context menu with Describe', () => {
    render(<NodeTable nodes={nodes} query="" />);
    const row = screen.getByText('control-node').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Describe')).toBeInTheDocument();
  });

  it('Describe fires onDescribe', () => {
    const onDescribe = vi.fn();
    render(<NodeTable nodes={nodes} query="" onDescribe={onDescribe} />);
    const row = screen.getByText('control-node').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Describe'));
    expect(onDescribe).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'control-node' }),
    );
  });

  it('Escape closes context menu', () => {
    render(<NodeTable nodes={nodes} query="" />);
    const row = screen.getByText('control-node').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Describe')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Describe')).not.toBeInTheDocument();
  });
});
