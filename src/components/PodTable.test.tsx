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
  { name: 'nginx', namespace: 'default', ready: '1/1', status: 'Running', restarts: 0, age: '5m', ip: '10.0.0.1', node: 'n1', containers: ['nginx'], container_images: [{ name: 'nginx', image: 'nginx:1.25', image_id: 'sha256:abc123' }] },
  { name: 'crashy', namespace: 'default', ready: '0/1', status: 'CrashLoopBackOff', restarts: 7, age: '5m', ip: '10.0.0.2', node: 'n2', containers: ['app'], container_images: [{ name: 'app', image: 'app:v1', image_id: 'sha256:def456' }] },
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

  it('checkbox toggle adds/removes from selection and Tail button fires onMergeTail', () => {
    const onMergeTail = vi.fn();
    render(<PodTable pods={pods} query="" onMergeTail={onMergeTail} />);

    // Tail button not visible with 0 selections
    expect(screen.queryByText(/Tail \d+ pods/)).not.toBeInTheDocument();

    // Check the nginx row checkbox
    const nginxCheckbox = screen.getAllByRole('checkbox', { name: /Select nginx/ })[0] as HTMLInputElement;
    fireEvent.click(nginxCheckbox);

    // Still only 1 selected — Tail button requires 2+
    expect(screen.queryByText(/Tail \d+ pods/)).not.toBeInTheDocument();

    // Check the crashy row checkbox
    const crashyCheckbox = screen.getAllByRole('checkbox', { name: /Select crashy/ })[0] as HTMLInputElement;
    fireEvent.click(crashyCheckbox);

    // Now 2 selected — Tail button appears
    const tailBtn = screen.getByText(/Tail 2 pods/) as HTMLButtonElement;
    expect(tailBtn).toBeInTheDocument();

    // Click Tail → fires onMergeTail with the right pods
    fireEvent.click(tailBtn);
    expect(onMergeTail).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ name: 'nginx' }),
        expect.objectContaining({ name: 'crashy' }),
      ]),
    );
    expect(onMergeTail).toHaveBeenCalledTimes(1);
  });

  it('select-all checkbox toggles all visible rows', () => {
    const onMergeTail = vi.fn();
    const { container } = render(<PodTable pods={pods} query="" onMergeTail={onMergeTail} />);

    const selectAllCheckbox = screen.getByRole('checkbox', { name: /Select all visible pods/ }) as HTMLInputElement;
    expect(selectAllCheckbox.checked).toBe(false);

    fireEvent.click(selectAllCheckbox);

    // Both row checkboxes should be checked
    const rowCheckboxes = container.querySelectorAll('.pod-table tbody .col-sel input[type="checkbox"]');
    expect(rowCheckboxes.length).toBe(2);
    expect((rowCheckboxes[0] as HTMLInputElement).checked).toBe(true);
    expect((rowCheckboxes[1] as HTMLInputElement).checked).toBe(true);

    // Tail button shows 2
    expect(screen.getByText(/Tail 2 pods/)).toBeInTheDocument();

    // Uncheck all
    fireEvent.click(selectAllCheckbox);
    expect((rowCheckboxes[0] as HTMLInputElement).checked).toBe(false);
    expect((rowCheckboxes[1] as HTMLInputElement).checked).toBe(false);
  });
});
