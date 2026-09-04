# kube-panel

**English** · [中文](README.zh-CN.md)

A Windows-first **kubectl ops panel** — a single desktop app that turns the
daily kubectl grind (switching contexts, finding pods, reading logs, hunting
down ConfigMaps, replaying commands) into a keyboard-friendly GUI, plus a
few things the terminal just can't do well (regex log search with prev/next,
multi-pod merged tail, live port-forward management).

Built with [Tauri 2](https://tauri.app/) (Rust backend + React 18 / TypeScript
frontend). **All cluster access shells out to your local `kubectl`** — so your
existing kubeconfig, cloud auth plugins (aws/gcp/azure exec, kubelogin), and
krew plugins work unchanged. The app never speaks to the cluster directly.

> Status: **alpha / daily-driver-in-progress**. Windows 11 is the primary
> target; Linux/macOS should work (Tauri is cross-platform) but are not
> packaged yet.

---

## Features

### Context & namespace
- Parses `~/.kube/config` (and `KUBECONFIG` multi-file lists) directly with
  `serde_yaml` — no kubectl call needed, works offline.
- Context switcher (annotates the current context, cluster, user, namespace).
- Namespace switcher with an **all-namespaces** default view (so you can find
  any pod regardless of namespace).

### Pods
- Pod table with client-side substring filter (name / namespace / node), status
  color pills (Running=green, CrashLoopBackOff/ImagePullBackOff/Error=red,
  other non-Running=amber), high-restart highlighting.
- **Right-click any pod** for a context menu:
  - Copy name / Copy `kubectl logs <pod>` command
  - **Show images** — per-container image tag **and** imageID digest
  - **Show ConfigMaps** — the ConfigMaps referenced by this pod
    (`envFrom`/`env.valueFrom.configMapKeyRef`/volumes), with on-demand
    key/value viewing, copy, and export
  - **Describe** — `kubectl describe pod` text with CrashLoop/OOM keyword
    highlighting
  - **Events** — structured events table (time/type/reason/message), filterable
    to the pod or the whole namespace

### Logs
- **Streaming** `kubectl logs -f` via a Rust `StreamRegistry` — chunks pushed
  to the frontend over a Tauri event; 5000-line ring buffer; follow-tail with
  auto-pause on manual scroll-up.
- Controls: container dropdown, `--previous`, `--since` (5m/1h/all), `--tail`,
  follow toggle, Stop.
- **Fullscreen** mode.
- **Regex search** with case-sensitive toggle, match count, prev/next jump,
  `<mark>` highlighting.
- **Export** current buffer to `.log`.
- **Multi-pod merged tail** — select ≥2 pods, each spawns a `kubectl logs -f`,
  merged into one stream with `[pod]` prefixes.

### Deployments & rollouts
- Deployments tab (Ready / Updated / Replicas / Age / Images, substring filter).
- Right-click a deployment: **restart / scale / undo / history**. Write
  operations go through a **confirm modal that shows the exact kubectl command**
  before executing.

### Port-forward manager
- Table of active port-forwards (target, namespace, local→remote, status,
  started). Live status updates via events (running / stopped / failed with
  stderr tail).
- New session form with confirm-before-start. Stop / clear actions.
- Children are `kill_on_drop` so closing the app reaps them.

### Command history
- Every kubectl invocation records **metadata only**: context, namespace, argv,
  exit code, duration, `is_stream` flag. Persisted in a local SQLite DB at
  `%USERPROFILE%\.kube-panel\history.db`.
- Searchable by argv / context / namespace.
- **No stdout/stderr is ever stored** — kubectl output frequently contains
  secrets (`kubectl get secret -o yaml` base64, ConfigMap DB connection
  strings, `describe` env vars). Metadata-only prevents leaking them to disk.

---

## Security notes

- **No shell, no injection.** All kubectl invocations use
  `tokio::process::Command` with argv arrays — never a shell. Pod/deployment
  names are passed as individual argv elements, so they cannot break out into
  a separate command.
- **Write ops are gated.** Destructive/write operations (rollout
  restart/scale/undo, port-forward start) show the exact command in a confirm
  modal before executing. **Context switch** (`kubectl config use-context`) is
  intentionally **not** gated — it's treated as non-destructive navigation (it
  sets `current-context` in `~/.kube/config` but creates/destroys no
  resources). The actual destructive ops (restart/scale/undo) remain gated
  regardless of which context is active, so the blast radius of an accidental
  switch is limited to "subsequent commands land on the wrong context".
- **No `delete` / `--force` / `apply -f` / `exec`** operations exist in the app.
- **History is metadata-only** (see above) — no command output touches disk.
- **kubeconfig is parsed, not logged.** The app reads `~/.kube/config` to list
  contexts; kubeconfig content (tokens, certs, exec configs) is never printed
  or persisted by the app.
- **Tauri CSP** is currently `null` (dev default). Before a stable release,
  pin a restrictive CSP. See [the security review](docs/../.superpowers/sdd/kube-panel-security-review.md)
  if present, or `src-tauri/tauri.conf.json`.

---

## Prerequisites

- **Windows 11** (primary). The UI is a WebView2 app (Win11 ships WebView2).
- **`kubectl` on PATH.** The app calls `kubectl`; without it, nothing works.
  Install: `winget install Kubernetes.kubectl`.
- **Node.js + pnpm** for the frontend.
- **Rust toolchain** (`rustup`) for the backend.

## Development

```bash
pnpm install
pnpm tauri dev      # hot-reload dev app (Vite HMR + cargo rebuild on Rust changes)
```

### Tests

```bash
# Rust unit/integration tests (parsers, stream registry, pf registry, history)
cd src-tauri && cargo test --lib

# Frontend component + API tests (Vitest)
pnpm vitest run
```

## Build

```bash
pnpm tauri build    # produces NSIS installer + portable .exe in src-tauri/target/release/bundle/
```

The binary does **not** bundle kubectl — it's detected at runtime, with a
winget hint if missing.

---

## Architecture

```
kube-panel/
  src-tauri/                 # Rust backend (Tauri commands)
    src/
      kubeconfig.rs          # parse ~/.kube/config + KUBECONFIG (serde_yaml)
      kubectl.rs              # build Command (argv, --context, -n, --kubeconfig agreement)
      runtime.rs              # KubeRuntime: run (one-shot, history-recorded) + build_cmd (streaming)
      commands.rs             # all #[tauri::command] fns
      stream.rs               # StreamRegistry: long-lived kubectl logs -f children (single + multi)
      portforward.rs          # PfRegistry: kubectl port-forward lifecycle (monitor + stop channel)
      history.rs              # SQLite command-history CRUD (metadata-only)
      models.rs               # JSON parsers: pods, deployments, configmaps, events, pod-cm-refs
    tauri.conf.json
    Cargo.toml
  src/                       # React 18 + TS frontend
    App.tsx                  # layout: sidebar + topbar + pods/deployments tabs + logs + history
    components/
      PodTable.tsx            # pod table + multi-select + right-click context menu
      DeploymentTable.tsx     # deployments table + rollout context menu
      LogViewer.tsx           # streaming single-pod logs (ring buffer, follow, regex search, export)
      MergedLogViewer.tsx    # multi-pod merged tail
      PodActionModal.tsx     # images / configmaps / describe / events panels
      RolloutModal.tsx       # restart/scale/undo/history with confirm-before-invoke
      PortForwardPanel.tsx   # port-forward session table + new-session form
      ContextSwitcher.tsx
      NamespaceSwitcher.tsx
      HistoryPanel.tsx
    api/tauri.ts             # invoke() wrappers + event listeners (log_chunk, pf_status)
    stores/appStore.ts       # zustand (namespace)
    types.ts                 # shared TS types mirroring Rust serde Serialize output
  docs/
    specs/2026-09-03-kube-panel-design.md   # full design doc (Chinese)
    plans/                                   # phased implementation plans
```

### Key design decisions
- **Shell out, don't bind.** The `kube` Rust crate is not used for cluster
  access — only `serde_yaml` to parse the kubeconfig file structure. This keeps
  cloud auth exec plugins and krew plugins transparent.
- **`KUBECONFIG` agreement rule.** When `KUBECONFIG` is set in the
  environment, the runner passes **no** `--kubeconfig` (kubectl reads the env);
  otherwise it passes `~/.kube/config`. The parser and the runner agree.
- **Streaming = events, not awaits.** Long-lived `kubectl logs -f` /
  `port-forward` children live in a registry; stdout chunks are emitted to the
  frontend via Tauri events (`log_chunk`, `pf_status`). The one-shot `run`
  path records history; streaming records a single `is_stream=true` row and
  never persists chunk text.
- **TanStack Query race-free context.** The current context is derived from
  the `['contexts']` query (single source of truth), so pod/deployment queries
  change key on context switch and refetch fresh — no stale-context race.

---

## Roadmap

Done:
- ✅ Context / namespace switching
- ✅ Pod table + filter + anomaly highlight
- ✅ Streaming logs + regex search + export + fullscreen
- ✅ Multi-pod merged tail
- ✅ Pod right-click: images / configmaps / describe / events
- ✅ Deployments view + rollout restart/scale/undo/history
- ✅ Port-forward manager
- ✅ Command history (metadata-only, searchable)

Planned / deferred:
- ⬜ Exec terminal (ConPTY + xterm.js) — Windows PTY is complex; deferred.
- ⬜ YAML apply (dry-run preview → confirm → apply)
- ⬜ Cluster health badge (`get --raw /healthz` + `auth can-i`)
- ⬜ Favorites / command snippets
- ⬜ Resource browser beyond pods/deployments (svc, ingress, pvc, …)
- ⬜ Anomaly-highlight polish (restart-spike detection, OOMKilled icon)

See `docs/specs/2026-09-03-kube-panel-design.md` for the full spec and
`docs/plans/` for phased status.

## License

[MIT](LICENSE).
