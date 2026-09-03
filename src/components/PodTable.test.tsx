import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PodTable } from './PodTable';

const pods = [
  { name: 'nginx', namespace: 'default', ready: '1/1', status: 'Running', restarts: 0, age: '5m', ip: '10.0.0.1', node: 'n1', containers: ['nginx'] },
  { name: 'crashy', namespace: 'default', ready: '0/1', status: 'CrashLoopBackOff', restarts: 7, age: '5m', ip: '10.0.0.2', node: 'n2', containers: ['app'] },
];

describe('PodTable', () => {
  it('filters pods by fuzzy query', () => {
    render(<PodTable pods={pods} query="cra" />);
    expect(screen.getByText('crashy')).toBeInTheDocument();
    expect(screen.queryByText('nginx')).not.toBeInTheDocument();
  });

  it('flags CrashLoopBackOff', () => {
    render(<PodTable pods={pods} query="" />);
    const crashyRow = screen.getByText('crashy').closest('tr')!;
    expect(crashyRow.className).toContain('status-error');
  });
});
