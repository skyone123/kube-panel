import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusFilter } from './StatusFilter';
import { statusOptions } from './podStatus';
import type { PodView } from '../types';

const pod = (status: string, name: string): PodView => ({
  name,
  namespace: 'default',
  ready: '1/1',
  status,
  restarts: 0,
  age: '1m',
  ip: '10.0.0.1',
  node: 'n1',
  containers: ['c'],
  container_images: [],
});

// Two Running, one CrashLoopBackOff → worst-first order, counts 1 then 2.
const options = statusOptions([
  pod('Running', 'a'),
  pod('Running', 'b'),
  pod('CrashLoopBackOff', 'c'),
]);

const openPanel = () => fireEvent.click(screen.getByRole('button', { name: /^Status:/ }));
const panel = () => screen.queryByRole('group', { name: 'Filter pods by status' });
const box = (status: string) =>
  screen.getByLabelText(new RegExp(`^Filter by status ${status} \\(`)) as HTMLInputElement;

describe('StatusFilter', () => {
  it('shows "Status: All" when nothing is selected', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Status: All' })).toBeInTheDocument();
    expect(panel()).not.toBeInTheDocument();
  });

  it('reflects the selection in the button label', () => {
    const { unmount } = render(
      <StatusFilter options={options} selected={['Running']} onChange={() => {}} />,
    );
    expect(screen.getByRole('button', { name: 'Status: Running' })).toBeInTheDocument();
    unmount();

    render(<StatusFilter options={options} selected={['Running', 'Pending']} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Status: 2 selected' })).toBeInTheDocument();
  });

  it('wires the trigger to the panel with the disclosure attributes', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Status: All' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).not.toHaveAttribute('aria-controls');

    openPanel();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(trigger).toHaveAttribute('aria-controls', panel()!.id);
  });

  it('opens a panel listing every status worst-first with its count', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();

    expect(panel()).toBeInTheDocument();

    const boxes = screen.getAllByRole('checkbox');
    expect(boxes).toHaveLength(2);
    // Worst-first, and the count is part of the accessible name so screen
    // readers announce it (an explicit aria-label would shadow .sf-count).
    expect(boxes[0]).toHaveAccessibleName('Filter by status CrashLoopBackOff (1 pod)');
    expect(boxes[1]).toHaveAccessibleName('Filter by status Running (2 pods)');

    expect(box('CrashLoopBackOff').closest('label')!.querySelector('.sf-count')).toHaveTextContent(
      '1',
    );
    expect(box('Running').closest('label')!.querySelector('.sf-count')).toHaveTextContent('2');
  });

  it('checking a status appends it to the selection', () => {
    const onChange = vi.fn();
    render(<StatusFilter options={options} selected={[]} onChange={onChange} />);
    openPanel();

    fireEvent.click(box('CrashLoopBackOff'));
    expect(onChange).toHaveBeenCalledWith(['CrashLoopBackOff']);
  });

  it('checking a second status keeps the first (multi-select)', () => {
    const onChange = vi.fn();
    render(<StatusFilter options={options} selected={['CrashLoopBackOff']} onChange={onChange} />);
    openPanel();

    fireEvent.click(box('Running'));
    expect(onChange).toHaveBeenCalledWith(['CrashLoopBackOff', 'Running']);
  });

  it('unchecking a selected status removes it', () => {
    const onChange = vi.fn();
    render(
      <StatusFilter options={options} selected={['CrashLoopBackOff', 'Running']} onChange={onChange} />,
    );
    openPanel();

    const cb = box('CrashLoopBackOff');
    expect(cb.checked).toBe(true);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith(['Running']);
  });

  it('"All" clears the selection and is disabled while nothing is selected', () => {
    const onChange = vi.fn();
    const { unmount } = render(
      <StatusFilter options={options} selected={['Running']} onChange={onChange} />,
    );
    openPanel();
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(onChange).toHaveBeenCalledWith([]);
    unmount();

    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();
    expect(screen.getByRole('button', { name: 'All' })).toBeDisabled();
  });

  it('closes on Escape', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();
    expect(panel()).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel()).not.toBeInTheDocument();
  });

  it('closes on an outside mousedown but stays open on an inside one', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();

    fireEvent.mouseDown(panel()!);
    expect(panel()).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    expect(panel()).not.toBeInTheDocument();
  });

  it('closes on window resize so a fixed panel cannot drift off its trigger', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();
    expect(panel()).toBeInTheDocument();

    fireEvent(window, new Event('resize'));
    expect(panel()).not.toBeInTheDocument();
  });

  it('toggles the panel from the trigger button', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();
    expect(panel()).toBeInTheDocument();

    openPanel();
    expect(panel()).not.toBeInTheDocument();
  });

  it('returns focus to the trigger when Escape closes a focused panel', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Status: All' });
    openPanel();

    const cb = box('Running');
    cb.focus();
    expect(document.activeElement).toBe(cb);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel()).not.toBeInTheDocument();
    // Otherwise focus falls to <body> and the next Tab restarts at the top.
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus when Escape closes a panel that was never focused', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    const trigger = screen.getByRole('button', { name: 'Status: All' });
    (document.activeElement as HTMLElement | null)?.blur?.();
    openPanel();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(panel()).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(trigger);
  });

  it('closes when focus leaves the panel, but not while it moves inside', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();

    fireEvent.focusOut(box('Running'), { relatedTarget: box('CrashLoopBackOff') });
    expect(panel()).toBeInTheDocument();

    fireEvent.focusOut(box('Running'), { relatedTarget: document.body });
    expect(panel()).not.toBeInTheDocument();
  });

  it('stays open when focus is lost without a target (accessibility toggle, blur)', () => {
    render(<StatusFilter options={options} selected={[]} onChange={() => {}} />);
    openPanel();

    // A screen reader toggling a checkbox, or a window blur, reports
    // relatedTarget === null. Closing here would strand a non-mouse user.
    fireEvent.focusOut(box('Running'), { relatedTarget: null });
    expect(panel()).toBeInTheDocument();
  });

  it('shows an empty state when the pod list has no statuses', () => {
    render(<StatusFilter options={[]} selected={[]} onChange={() => {}} />);
    openPanel();
    expect(screen.getByText('No pods')).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
  });

  it('keeps a selected status listed after it disappears from the pod list', () => {
    const onChange = vi.fn();
    render(<StatusFilter options={options} selected={['Pending']} onChange={onChange} />);
    openPanel();

    // "Pending" is no longer present in `options` — it must still be rendered
    // (count 0) so the user can clear it without falling back to "All".
    const cb = box('Pending');
    expect(cb.checked).toBe(true);
    expect(cb.closest('label')!.querySelector('.sf-count')).toHaveTextContent('0');

    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('sorts a resurrected selection by severity, not at the bottom', () => {
    render(<StatusFilter options={options} selected={['Completed']} onChange={() => {}} />);
    openPanel();

    // "Completed" is no longer in the pod list, so it is re-added with count 0.
    // It is a warning (rank 1) and must land between CrashLoopBackOff (error)
    // and Running (ok). Note plain alphabetical order would put it FIRST
    // ("Completed" < "CrashLoopBackOff"), so this pins the severity sort.
    const names = screen
      .getAllByRole('checkbox')
      .map(c => c.getAttribute('aria-label')!.replace(/^Filter by status | \(.*\)$/g, ''));
    expect(names).toEqual(['CrashLoopBackOff', 'Completed', 'Running']);
  });
});
