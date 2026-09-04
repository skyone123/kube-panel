import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PodView } from '../types';

// Mock @tauri-apps/api/core (invoke) and @tauri-apps/api/event (listen)
// Use vi.hoisted so the mock factories can reference the mock fn despite vi.mock being hoisted
const { invokeMock, listenMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  listenMock: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({ listen: listenMock }));

// Mock @xterm/xterm + addon-fit so the component doesn't touch the real DOM canvas
vi.mock('@xterm/xterm', () => ({
  Terminal: vi.fn().mockImplementation(() => ({
    open: vi.fn(),
    dispose: vi.fn(),
    focus: vi.fn(),
    write: vi.fn(),
    onData: vi.fn(),
    onResize: vi.fn(),
    loadAddon: vi.fn(),
  })),
}));
vi.mock('@xterm/addon-fit', () => ({
  FitAddon: vi.fn().mockImplementation(() => ({
    fit: vi.fn(),
  })),
}));

import { ExecTerminal } from './ExecTerminal';

const pod: PodView = {
  name: 'nginx',
  namespace: 'default',
  ready: '1/1',
  status: 'Running',
  restarts: 0,
  age: '5m',
  ip: '10.0.0.1',
  node: 'n1',
  containers: ['nginx', 'sidecar'],
  container_images: [
    { name: 'nginx', image: 'nginx:1.25', image_id: 'sha256:abc123' },
    { name: 'sidecar', image: 'busybox:latest', image_id: 'sha256:def456' },
  ],
};

describe('ExecTerminal', () => {
  beforeEach(() => {
    invokeMock.mockClear();
    listenMock.mockClear();
    invokeMock.mockResolvedValue('exec-0');
  });

  it('renders the modal with container select populated from pod.container_images', () => {
    render(<ExecTerminal pod={pod} ctxName="dev" onClose={vi.fn()} />);
    // The container select should have options for each container image
    expect(screen.getByText('Container')).toBeInTheDocument();
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    // "default" + 2 containers
    expect(select.options.length).toBe(3);
    expect(select.options[1].textContent).toBe('nginx');
    expect(select.options[2].textContent).toBe('sidecar');
  });

  it('Connect button calls startExec with the selected container and ["sh"] when command is empty', async () => {
    render(<ExecTerminal pod={pod} ctxName="dev" onClose={vi.fn()} />);

    // Clear command input so it defaults to ['sh']
    const cmdInput = screen.getByPlaceholderText('sh') as HTMLInputElement;
    fireEvent.change(cmdInput, { target: { value: '' } });

    // Select the "sidecar" container
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'sidecar' } });

    const connectBtn = screen.getByText('Connect');
    fireEvent.click(connectBtn);

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith('start_exec', {
        context: 'dev',
        namespace: 'default',
        pod: 'nginx',
        container: 'sidecar',
        command: ['sh'],
      });
    });
  });
});
