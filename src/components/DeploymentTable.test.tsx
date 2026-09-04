import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DeploymentTable } from './DeploymentTable';
import type { DeploymentView, RolloutMode } from '../types';

const deploys: DeploymentView[] = [
  { name: 'web', namespace: 'default', ready: '2/3', updated: '3/3', replicas: 3, available: 2, age: '5m', images: ['nginx:1.25'] },
  { name: 'api', namespace: 'prod', ready: '1/1', updated: '1/1', replicas: 1, available: 1, age: '1h', images: ['a:v1', 'b:v2'] },
];

describe('DeploymentTable', () => {
  it('filters deployments by name', () => {
    render(<DeploymentTable deployments={deploys} query="web" />);
    expect(screen.getByText('web')).toBeInTheDocument();
    expect(screen.queryByText('api')).not.toBeInTheDocument();
  });

  it('filters deployments by image', () => {
    render(<DeploymentTable deployments={deploys} query="b:v2" />);
    expect(screen.getByText('api')).toBeInTheDocument();
    expect(screen.queryByText('web')).not.toBeInTheDocument();
  });

  it('renders all columns', () => {
    render(<DeploymentTable deployments={deploys} query="" />);
    expect(screen.getByText('Name')).toBeInTheDocument();
    expect(screen.getByText('Namespace')).toBeInTheDocument();
    expect(screen.getByText('Ready')).toBeInTheDocument();
    expect(screen.getByText('Updated')).toBeInTheDocument();
    expect(screen.getByText('Replicas')).toBeInTheDocument();
    expect(screen.getByText('Available')).toBeInTheDocument();
    expect(screen.getByText('Age')).toBeInTheDocument();
    expect(screen.getByText('Images')).toBeInTheDocument();
  });

  it('right-click opens context menu with rollout actions', () => {
    render(<DeploymentTable deployments={deploys} query="" />);
    const row = screen.getByText('web').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Restart')).toBeInTheDocument();
    expect(screen.getByText('Scale…')).toBeInTheDocument();
    expect(screen.getByText('Undo')).toBeInTheDocument();
    expect(screen.getByText('History')).toBeInTheDocument();
  });

  it('Restart fires onAction with restart mode', () => {
    const onAction = vi.fn();
    render(<DeploymentTable deployments={deploys} query="" onAction={onAction} />);
    const row = screen.getByText('web').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Restart'));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'web' }),
      'restart' as RolloutMode,
    );
  });

  it('Scale fires onAction with scale mode', () => {
    const onAction = vi.fn();
    render(<DeploymentTable deployments={deploys} query="" onAction={onAction} />);
    const row = screen.getByText('api').closest('tr')!;
    fireEvent.contextMenu(row);
    fireEvent.click(screen.getByText('Scale…'));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'api' }),
      'scale' as RolloutMode,
    );
  });

  it('Escape closes context menu', () => {
    render(<DeploymentTable deployments={deploys} query="" />);
    const row = screen.getByText('web').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Restart')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Restart')).not.toBeInTheDocument();
  });
});
