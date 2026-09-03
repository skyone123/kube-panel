import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';

const entries = [
  { id: 1, ts_ms: 1000, context: 'dev', namespace: 'default', argv: ['get','pods'], exit_code: 0, duration_ms: 12, is_stream: false, favorite: false },
  { id: 2, ts_ms: 2000, context: 'prod', namespace: null, argv: ['logs','nginx'], exit_code: 0, duration_ms: 5, is_stream: true, favorite: false },
];

describe('HistoryPanel', () => {
  it('renders argv joined for each entry', () => {
    render(<HistoryPanel entries={entries} query="" />);
    expect(screen.getByText(/get pods/)).toBeInTheDocument();
    expect(screen.getByText(/logs nginx/)).toBeInTheDocument();
  });
  it('filters by query', () => {
    render(<HistoryPanel entries={entries} query="nginx" />);
    expect(screen.queryByText(/get pods/)).not.toBeInTheDocument();
    expect(screen.getByText(/logs nginx/)).toBeInTheDocument();
  });
});
