import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RolloutModal } from './RolloutModal';
import type { DeploymentView } from '../types';

const { rolloutSetImage } = vi.hoisted(() => ({ rolloutSetImage: vi.fn() }));

vi.mock('../api/tauri', () => ({
  rolloutSetImage,
  rolloutRestart: vi.fn(),
  rolloutScale: vi.fn(),
  rolloutUndo: vi.fn(),
  getRolloutRevisions: vi.fn().mockResolvedValue([]),
}));

const deploy: DeploymentView = {
  name: 'api-gateway',
  namespace: 'default',
  ready: '2/4',
  updated: '4/4',
  replicas: 4,
  available: 2,
  age: '3d',
  images: ['envoyproxy/envoy:v1.29.1', 'registry.local/api:v1.8.2'],
  containers: [
    { name: 'api', image: 'registry.local/api:v1.8.2' },
    { name: 'envoy', image: 'envoyproxy/envoy:v1.29.1' },
  ],
};

function renderModal(d: DeploymentView = deploy) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RolloutModal deploy={d} mode="image" ctxName="minikube" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('RolloutModal image mode', () => {
  beforeEach(() => {
    rolloutSetImage.mockReset();
    rolloutSetImage.mockResolvedValue(undefined);
  });

  it('prefills every container with its current image', () => {
    renderModal();
    expect((screen.getByLabelText('Image for container api') as HTMLInputElement).value)
      .toBe('registry.local/api:v1.8.2');
    expect((screen.getByLabelText('Image for container envoy') as HTMLInputElement).value)
      .toBe('envoyproxy/envoy:v1.29.1');
  });

  it('disables Confirm until an image actually changes', () => {
    renderModal();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('builds a command containing only the changed container', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Image for container envoy'), {
      target: { value: 'envoyproxy/envoy:v1.29.2' },
    });
    expect(screen.getByText(/envoy=envoyproxy\/envoy:v1\.29\.2/)).toBeInTheDocument();
    expect(screen.queryByText(/api=registry\.local\/api:v1\.8\.2/)).not.toBeInTheDocument();
  });

  it('submits only changed containers', async () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Image for container envoy'), {
      target: { value: 'envoyproxy/envoy:v1.29.2' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));

    await waitFor(() => {
      expect(rolloutSetImage).toHaveBeenCalledWith('minikube', 'default', 'api-gateway', [
        { container: 'envoy', image: 'envoyproxy/envoy:v1.29.2' },
      ]);
    });
  });

  it('rejects images containing whitespace', () => {
    renderModal();
    fireEvent.change(screen.getByLabelText('Image for container api'), {
      target: { value: 'registry.local/api: v2' },
    });
    expect(screen.getByText(/cannot contain whitespace/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm' })).toBeDisabled();
  });

  it('handles single-container deployments', async () => {
    const single: DeploymentView = {
      ...deploy,
      name: 'web',
      namespace: 'web',
      images: ['nginx:1.25.3'],
      containers: [{ name: 'nginx', image: 'nginx:1.25.3' }],
    };
    renderModal(single);
    fireEvent.change(screen.getByLabelText('Image for container nginx'), {
      target: { value: 'nginx:1.27.1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => {
      expect(rolloutSetImage).toHaveBeenCalledWith('minikube', 'web', 'web', [
        { container: 'nginx', image: 'nginx:1.27.1' },
      ]);
    });
  });
});
