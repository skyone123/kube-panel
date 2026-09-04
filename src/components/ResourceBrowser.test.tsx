import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock @tanstack/react-query
vi.mock('@tanstack/react-query', () => ({
  useQuery: vi.fn(() => ({
    data: {
      columns: ['TYPE', 'CLUSTER-IP', 'EXTERNAL-IP', 'PORT(S)'],
      rows: [
        { name: 'my-svc', namespace: 'default', age: '5d', values: ['ClusterIP', '10.96.0.10', '<none>', '80/TCP'] },
        { name: 'web-svc', namespace: 'kube-system', age: '3d', values: ['LoadBalancer', '10.96.0.20', '1.2.3.4', '443/TCP'] },
      ],
    },
    isLoading: false,
    error: null,
  })),
}));

// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));

import { ResourceBrowser } from './ResourceBrowser';

describe('ResourceBrowser', () => {
  it('renders dynamic columns from ResourceListView', () => {
    render(<ResourceBrowser ctxName="dev" namespace="default" live={true} />);
    expect(screen.getByText('TYPE')).toBeInTheDocument();
    expect(screen.getByText('CLUSTER-IP')).toBeInTheDocument();
    expect(screen.getByText('EXTERNAL-IP')).toBeInTheDocument();
    expect(screen.getByText('PORT(S)')).toBeInTheDocument();
  });

  it('renders resource rows with values', () => {
    render(<ResourceBrowser ctxName="dev" namespace="default" live={true} />);
    expect(screen.getByText('my-svc')).toBeInTheDocument();
    expect(screen.getByText('web-svc')).toBeInTheDocument();
    expect(screen.getByText('10.96.0.10')).toBeInTheDocument();
    expect(screen.getByText('1.2.3.4')).toBeInTheDocument();
  });

  it('filters rows by name', () => {
    render(<ResourceBrowser ctxName="dev" namespace="default" live={true} />);
    const input = screen.getByLabelText('Filter resources');
    fireEvent.change(input, { target: { value: 'web' } });
    expect(screen.getByText('web-svc')).toBeInTheDocument();
    expect(screen.queryByText('my-svc')).not.toBeInTheDocument();
  });

  it('right-click opens context menu with Describe', () => {
    render(<ResourceBrowser ctxName="dev" namespace="default" live={true} />);
    const row = screen.getByText('my-svc').closest('tr')!;
    fireEvent.contextMenu(row);
    expect(screen.getByText('Describe')).toBeInTheDocument();
  });
});
