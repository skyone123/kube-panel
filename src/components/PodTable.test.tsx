import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PodTable } from './PodTable';
import type { PodView, PodActionMode } from '../types';

// jsdom does not have navigator.clipboard — mock it before each test uses it.
const writeTextMock = vi.fn().mockResolvedValue(undefined);
Object.defineProperty(navigator, 'clipboard', {
  value: { writeText: writeTextMock },
  writable: true,
  configurable: true,
});

const pods: PodView[] = [
  { name: 'nginx', namespace: 'default', ready: '1/1', status: 'Running', restarts: 0, age: '5m', ip: '10.0.0.1', node: 'n1', containers: ['nginx'], containerImages: [{ name: 'nginx', image: 'nginx:1.25', image_id: 'sha256:abc123' }] },
  { name: 'crashy', namespace: 'default', ready: '0/1', status: 'CrashLoopBackOff', restarts: 7, age: '5m', ip: '10.0.0.2', node: 'n2', containers: ['app'], containerImages: [{ name: 'app', image: 'app:v1', image_id: 'sha256:def456' }] },
];

describe('PodTable', () => {
  it('filters pods by query', () => {
    render(<PodTable pods={pods} query="cra" />);
    expect(screen.getByText('crashy')).toBeInTheDocument();
    expect(screen.queryByText('nginx')).not.toBeInTheDocument();
  });

  it('flags CrashLoopBackOff', () => {
    render(<PodTable pods={pods} query="" />);
    const crashyRow = screen.getByText('crashy').closest('tr')!;
    expect(crashyRow.className).toContain('status-error');
  });

  it('right-click opens context menu', () => {
    render(<PodTable pods={pods} query="" />);
    const row = screen.getByText('nginx').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Copy name')).toBeInTheDocument();
    expect(screen.getByText('Copy kubectl logs')).toBeInTheDocument();
    expect(screen.getByText('Show images')).toBeInTheDocument();
    expect(screen.getByText('Describe')).toBeInTheDocument();
    expect(screen.getByText('Events')).toBeInTheDocument();
  });

  it('Copy name calls clipboard.writeText with pod name', () => {
    writeTextMock.mockClear();
    render(<PodTable pods={pods} query="" />);
    const row = screen.getByText('nginx').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Copy name'));
    expect(writeTextMock).toHaveBeenCalledWith('nginx');
  });

  it('Copy kubectl logs builds correct command', () => {
    writeTextMock.mockClear();
    render(<PodTable pods={pods} query="" />);
    const row = screen.getByText('crashy').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Copy kubectl logs'));
    expect(writeTextMock).toHaveBeenCalledWith('kubectl logs -n default crashy');
  });

  it('Show images fires onPodAction with images mode', () => {
    const onPodAction = vi.fn();
    render(<PodTable pods={pods} query="" onPodAction={onPodAction} />);
    const row = screen.getByText('nginx').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Show images'));
    expect(onPodAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'nginx' }),
      'images' as PodActionMode,
    );
  });

  it('Describe fires onPodAction with describe mode', () => {
    const onPodAction = vi.fn();
    render(<PodTable pods={pods} query="" onPodAction={onPodAction} />);
    const row = screen.getByText('crashy').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Describe'));
    expect(onPodAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'crashy' }),
      'describe' as PodActionMode,
    );
  });

  it('Escape closes context menu', () => {
    render(<PodTable pods={pods} query="" />);
    const row = screen.getByText('nginx').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Copy name')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Copy name')).not.toBeInTheDocument();
  });
});
