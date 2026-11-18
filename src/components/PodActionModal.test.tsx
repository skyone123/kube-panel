import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PodActionModal } from './PodActionModal';
import type { PodView } from '../types';

// Hoisted so the vi.mock factory below can reference them.
const { listContexts, getSecrets, getPodSecrets, getSecretData } = vi.hoisted(() => ({
  listContexts: vi.fn(),
  getSecrets: vi.fn(),
  getPodSecrets: vi.fn(),
  getSecretData: vi.fn(),
}));

vi.mock('../api/tauri', () => ({
  listContexts,
  getSecrets,
  getPodSecrets,
  getSecretData,
  // SecretsPanel never calls these in 'secrets' mode, but the modal's import
  // surface pulls them in — stub them so the module graph resolves.
  describePod: vi.fn(),
  getEvents: vi.fn(),
  getConfigmaps: vi.fn(),
  getPodConfigmaps: vi.fn(),
  getConfigmap: vi.fn(),
  getPodYaml: vi.fn(),
  streamEvents: vi.fn(),
  stopLogStream: vi.fn(),
  onEventChunk: vi.fn(),
  onLogStreamEnd: vi.fn(),
}));

const pod: PodView = {
  name: 'web',
  namespace: 'default',
  ready: '1/1',
  status: 'Running',
  restarts: 0,
  age: '5m',
  ip: '10.0.0.1',
  node: 'n1',
  containers: ['app'],
  container_images: [],
};

// Three Secrets in the namespace; only `sec-b` is referenced by the pod.
const allSecrets = [
  { name: 'sec-a', secret_type: 'Opaque', keys: [] },
  { name: 'sec-b', secret_type: 'Opaque', keys: ['TOKEN'] },
  { name: 'sec-c', secret_type: 'Opaque', keys: [] },
];

function renderSecrets() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PodActionModal pod={pod} mode="secrets" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

// All <button class="cm-item"> names in DOM order — the shape of the list.
function listedNames(): string[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('.cm-list .cm-item'))
    .map(b => b.textContent ?? '');
}

describe('PodActionModal · SecretsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listContexts.mockResolvedValue([{ name: 'dev', cluster: 'c', user: 'u', current: true }]);
    getSecrets.mockResolvedValue(allSecrets);
    getPodSecrets.mockResolvedValue(['sec-b']);
    getSecretData.mockResolvedValue({ name: 'sec-b', secret_type: 'Opaque', entries: [] });
  });

  it('by default lists only the Secrets referenced by the pod', async () => {
    renderSecrets();
    await waitFor(() => expect(screen.getByRole('button', { name: 'sec-b' })).toBeInTheDocument());

    expect(listedNames()).toEqual(['sec-b']);
    expect(screen.queryByRole('button', { name: 'sec-a' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'sec-c' })).not.toBeInTheDocument();
    // Header reflects "referenced" mode with the referenced count.
    expect(screen.getByText(/Referenced \(1\)/)).toBeInTheDocument();
    expect(getPodSecrets).toHaveBeenCalledWith('dev', 'default', 'web');
  });

  it('toggling "Show all" lists every Secret with the pod-referenced one first', async () => {
    renderSecrets();
    await waitFor(() => expect(screen.getByRole('button', { name: 'sec-b' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show all Secrets in this namespace' }));

    await waitFor(() => expect(listedNames()).toHaveLength(3));
    // Referenced (sec-b) floats to the top, then the rest in their original order.
    // The referenced row also carries a "pod" badge, hence the 'podsec-b' text.
    expect(listedNames()[0]).toBe('podsec-b');
    expect(listedNames()).toContain('sec-a');
    expect(listedNames()).toContain('sec-c');
    // Header flips to the full-namespace count.
    expect(screen.getByText(/Secrets \(3\)/)).toBeInTheDocument();
  });

  it('marks pod-referenced Secrets with a "pod" badge when "Show all" is on', async () => {
    renderSecrets();
    await waitFor(() => expect(screen.getByRole('button', { name: 'sec-b' })).toBeInTheDocument());

    // No badge in the default "referenced only" view.
    expect(document.querySelector('.cm-item-badge')).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show all Secrets in this namespace' }));
    await waitFor(() => expect(listedNames()).toHaveLength(3));

    const badges = Array.from(document.querySelectorAll('.cm-item-badge'));
    expect(badges).toHaveLength(1);
    expect(badges[0].closest('button')!.textContent).toBe('podsec-b');
  });

  it('clicking a listed Secret fetches and shows its data', async () => {
    renderSecrets();
    await waitFor(() => expect(screen.getByRole('button', { name: 'sec-b' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'sec-b' }));

    await waitFor(() => expect(getSecretData).toHaveBeenCalledWith('dev', 'default', 'sec-b'));
  });

  it('preserves the selection when toggling "Show all"', async () => {
    renderSecrets();
    await waitFor(() => expect(screen.getByRole('button', { name: 'sec-b' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'sec-b' }));
    await waitFor(() => expect(getSecretData).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('checkbox', { name: 'Show all Secrets in this namespace' }));
    await waitFor(() => expect(listedNames()).toHaveLength(3));

    // Selection kept → detail head still renders sec-b's title row.
    const active = document.querySelector('.cm-item.active');
    expect(active?.textContent).toBe('podsec-b');
  });

  it('shows an empty state pointing at "Show all" when the pod references no Secrets', async () => {
    getPodSecrets.mockResolvedValue([]);
    renderSecrets();

    await waitFor(() =>
      expect(screen.getByText(/No Secrets referenced by this pod/)).toBeInTheDocument(),
    );
    // Empty referenced list, header shows 0.
    expect(screen.getByText(/Referenced \(0\)/)).toBeInTheDocument();
    // Namespace-wide Secrets were still fetched — flipping the toggle reveals them.
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show all Secrets in this namespace' }));
    await waitFor(() => expect(listedNames()).toHaveLength(3));
  });

  it('keeps the reveal-two-step intact: Reveal → Confirm reveal → value visible', async () => {
    // base64("s3cr3t") = czNjcjN0
    getSecretData.mockResolvedValue({
      name: 'sec-b',
      secret_type: 'Opaque',
      entries: [{ key: 'TOKEN', value: 'czNjcjN0' }],
    });
    renderSecrets();
    await waitFor(() => expect(screen.getByRole('button', { name: 'sec-b' })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'sec-b' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reveal' })).toBeInTheDocument());

    // Value is masked initially — plaintext must NOT be in the DOM yet.
    expect(screen.queryByText('s3cr3t')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Reveal' }));
    // First click only arms the confirm — still no plaintext.
    expect(screen.queryByText('s3cr3t')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Confirm reveal' }));
    await waitFor(() => expect(screen.getByText('s3cr3t')).toBeInTheDocument());
  });
});
