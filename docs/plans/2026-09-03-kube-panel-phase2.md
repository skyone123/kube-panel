# kube-panel Phase 2 Implementation Plan

> **For agentic workers:** Execute feature-by-feature via the OMC `executor` agent with detailed per-task briefs; controller reviews between tasks (same pattern as the namespace-switcher addition). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Turn the Phase-1 bootable slice into a real daily-driver k8s ops panel by adding the spec's Phase 2 features: streaming logs with search/export, describe+events, configmap query, multi-pod log tail, and the cluster-health badge.

**Architecture:** Same Tauri 2 + Rust + React/TS stack. New pattern for streaming: Rust spawns long-lived `kubectl logs -f` children, holds them in a `StreamRegistry` (Mutex<HashMap<id, Child>>), and pushes stdout chunks to the frontend via Tauri `emit("log_chunk", ...)`. Frontend subscribes with `listen()`, appends to a capped ring buffer rendered in a virtualized log pane, with regex search + prev/next + export-to-file. Phase 3 features (port-forward, exec, rollout, yaml-apply, favorites, clipboard helpers) come after this plan.

**Tech additions:** `@tauri-apps/api/event` (frontend `listen`); Rust `tauri::Emitter` (already in tauri 2); frontend log viewer uses a lightweight virtualized `<pre>` (or Monaco in a later polish pass — keep deps light for now); regex via the browser-native `RegExp` (no new dep).

## Global Constraints (carry forward from Phase 1)

- Windows-first. No `python`/`python3`.
- All cluster access shells out to `kubectl`; never a native k8s client.
- History stores metadata ONLY (no stdout/stderr) — spec §6.4. Streaming log chunks go to the frontend buffer only; they are NOT written to history. (The `kubectl logs -f` invocation IS recorded as a history row with `is_stream=true`.)
- The `KubeRuntime::run` one-shot path is unchanged; streaming uses a NEW path (`Kubectl::run_stream` or a streaming variant) because it must NOT await completion — it emits chunks and returns a stream id.
- No fake completion. TDD where logic exists (Rust stream registry start/stop; chunk framing; configmap parse; events parse). GUI steps device-verify-owed.
- Commits: conventional, one per logical feature.

## File structure additions (Phase 2)

```
src-tauri/src/
  stream.rs          # NEW: StreamRegistry (id -> Child), start/stop, emit chunks
  commands.rs        # NEW commands: stream_pod_logs, stop_log_stream, describe_pod, get_events, get_configmaps, get_pod_configmaps, can_i
  models.rs          # NEW parsers: parse_configmap_list, parse_events, parse_describe (describe is text — no parse, return String)
  lib.rs             # register new commands + manage StreamRegistry state
src/components/
  LogViewer.tsx      # REWRITE: streaming via listen(), ring buffer, follow, search, export
  LogControls.tsx    # NEW: container / --previous / --since / --tail / follow toggle
  DescribePanel.tsx  # NEW: kubectl describe pod (text) + events table
  ConfigMapPanel.tsx # NEW: pod-referenced CMs + all-CMs fuzzy(substring) search
  HealthBadge.tsx    # NEW: can-i + healthz on context switch
  PodTable.tsx       # add multi-select for multi-pod tail (Phase 2 feature 4)
src/api/tauri.ts     # new wrappers + listen-based stream helpers
```

## Feature 1: Streaming logs + search + export

### P2.1 — Rust streaming backend (`stream.rs` + commands + state)
- [ ] `StreamRegistry`: `Mutex<HashMap<Uuid, Child>>`. `start(cmd) -> Uuid` spawns `kubectl logs -f ... --max-log-...`, registers child, returns id. `stop(id)` kills + removes. On each stdout line, `app.emit("log_chunk", { id, text })`.
- [ ] `stream_pod_logs` command (async, returns stream id; records a history row `is_stream=true`).
- [ ] `stop_log_stream(id)` command.
- [ ] TDD: stubbed kubectl `.cmd` that emits a few lines slowly; assert chunks arrive + stop kills the child.

### P2.2 — Frontend streaming LogViewer
- [ ] `listen<LogChunk>('log_chunk')` filtered by current stream id; append to buffer (cap ~50k lines, ring).
- [ ] Follow-tail (auto-scroll) toggle; pause follow on manual scroll-up.
- [ ] Controls: container dropdown, `--previous`, `--since` (5m/1h/all), `--tail` (N), follow on/off.
- [ ] Stop button → `stop_log_stream(id)`; switching pod stops the old stream first.

### P2.3 — Log search + export
- [ ] Regex + case-sensitive toggle; highlight matches; prev/next; match count.
- [ ] Export current buffer to `.log` via Tauri save dialog (or `save` plugin).

## Feature 2: Describe + Events

### P2.4 — `describe_pod` + `get_events` commands + events parser
- [ ] `describe_pod(ctx, ns, pod)` → `kubectl describe pod <pod>` → String (text, no parse; highlight CrashLoop/OOM keywords client-side).
- [ ] `get_events(ctx, ns)` → `kubectl get events -o json --sort-by=.lastTimestamp` → parse to `EventView[]` (lastTimestamp, type, reason, message, involvedObject.name).
- [ ] TDD: events parser.

### P2.5 — DescribePanel UI
- [ ] Tab/panel: describe text (monospace, keyword highlight) + events table (sort by time, color by type=Warning/Normal).

## Feature 3: ConfigMap query

### P2.6 — `get_configmaps` + `get_pod_configmaps` commands + parser
- [ ] `get_configmaps(ctx, ns)` → `kubectl get cm -o json` → `ConfigMapView[]` (name, keys[]).
- [ ] `get_pod_configmaps(ctx, ns, pod)` → parse pod JSON envFrom/env.valueFrom.configMapKeyRef + volumes → `Vec<String>` (CM names referenced).
- [ ] TDD: configmap parse + pod-CM-ref extraction.

### P2.7 — ConfigMapPanel UI
- [ ] Left: pod-referenced CMs (click → view data key/value, copy, export). Right: all CMs substring search + view.

## Feature 4: Multi-pod log tail

### P2.8 — Multi-stream merge
- [ ] PodTable multi-select; "merge tail" spawns one stream per pod; chunks tagged with `[pod]` prefix; one merged buffer.
- [ ] Rust: `stream_multi_pod_logs(pods[]) -> Vec<stream_id>` reuses StreamRegistry.

## Feature 5: Cluster health badge

### P2.9 — `can_i` + healthz
- [ ] `check_cluster_health(ctx)` → `{ api_reachable: bool, can_list_pods: bool }` via `kubectl get --raw /healthz` + `kubectl auth can-i list pods`.
- [ ] HealthBadge in ContextSwitcher: green/yellow/red.

## Verification gate
- [ ] `cargo test --lib` all green; `pnpm vitest run` all green; `cargo build` + `pnpm build` clean.
- [ ] Device-verify (user, real cluster): streaming logs follow live; search jumps; export writes file; describe+events render; configmap panel shows pod refs; multi-pod merge tail; health badge colors on context switch.

## Deferred to Phase 3
port-forward manager, exec (ConPTY + xterm.js), rollout actions, yaml apply, favorites/snippets, clipboard helpers, anomaly-highlight polish.
