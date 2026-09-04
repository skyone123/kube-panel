<div align="center">

# 🛰️ kube-panel

A Windows-first **kubectl ops panel** — context switching, pod search,
streaming logs with regex search, multi-pod merged tail, ConfigMaps,
describe/events, deployments + rollout, and live port-forward management
in one desktop app.

[![Release CI](https://github.com/skyone123/kube-panel/actions/workflows/release.yml/badge.svg)](https://github.com/skyone123/kube-panel/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4.svg?logo=windows11&logoColor=white)](https://github.com/skyone123/kube-panel/releases)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange.svg?logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584.svg?logo=rust)](https://www.rust-lang.org/)

**English** · [中文](README.zh-CN.md)

</div>

---

> 💡 **The idea:** the daily kubectl grind (switching contexts, grepping pods,
> tailing logs, hunting down ConfigMaps, replaying commands) is slow in a
> terminal and invisible across sessions. kube-panel turns it into a keyboard-
> friendly GUI, plus a few things the terminal just can't do well.
>
> **No native k8s client.** All cluster access shells out to your local
> `kubectl` — your existing kubeconfig, cloud auth plugins (aws/gcp/azure exec,
> kubelogin), and krew plugins work unchanged. The app never speaks to the
> cluster directly.

---

## ✨ Features

| Area | What you get |
| :--- | :--- |
| 🧭 **Context & namespace** | Parse `~/.kube/config` + `KUBECONFIG` offline; one-click context switch; all-namespaces default view so you find any pod. |
| 📋 **Pods** | Substring filter (name / namespace / node), status color pills, high-restart highlighting, **right-click → images / ConfigMaps / describe / events / YAML**. |
| 🖥️ **Nodes** | Node table with **Ready / pressure (Memory/PID/Disk) / roles / version / OS**, allocatable summary, live auto-refresh, right-click describe. |
| 📜 **Logs** | Streaming `kubectl logs -f` (ring buffer, follow-tail, `--previous`/`--since`/`--tail`, container dropdown), **fullscreen**, **regex search** with prev/next + match count, **export to `.log`**. |
| 🔀 **Multi-pod tail** | Select ≥2 pods → one merged stream with `[pod]` prefixes. |
| 🚀 **Deployments & rollout** | Deployments tab + right-click **restart / scale / undo / history**, each behind a confirm modal showing the exact command. |
| 🔌 **Port-forward manager** | Live session table (running / stopped / failed), confirm-before-start, stop/clear, children reaped on app exit. |
| 🗂️ **Resource browser** | Services / Ingresses / PVC / StatefulSets / DaemonSets / Jobs / CronJobs — one kind-aware table with dynamic columns, substring filter, right-click describe. |
| 💻 **Exec terminal** | Right-click a pod → `kubectl exec -it` in an interactive xterm.js terminal (ConPTY). Container + command picker (default `sh`), resize-aware. |
| 🧱 **Command history** | Searchable, persisted to SQLite. **Metadata-only** — no stdout/stderr ever touches disk (kubectl output often carries secrets). |
| 💬 **Chinese hints** | Every key control shows a concise Chinese tooltip on hover; safety-relevant controls note their non-destructive / gated nature. |

<details>
<summary><b>🎯 Right-click pod menu — full detail</b></summary>

- **Copy name** / **Copy `kubectl logs <pod>`**
- **Show images** — per-container image tag **and** imageID digest
- **Show ConfigMaps** — the ConfigMaps this pod references (`envFrom` /
  `env.valueFrom.configMapKeyRef` / `volumes`), with on-demand key/value
  viewing, copy, and export
- **Describe** — `kubectl describe pod` text, CrashLoop/OOM keyword highlighting
- **Events** — structured table (time / type / reason / message), filterable
  to the pod or the whole namespace
- **Exec** — `kubectl exec -it` interactive terminal (xterm.js + ConPTY),
  pick container + command (default `sh`)

</details>

---

## 📦 Install (Windows)

1. Go to the [**Releases**](https://github.com/skyone123/kube-panel/releases) page.
2. Download the latest `.exe` installer (NSIS) or portable bundle.
3. Make sure `kubectl` is installed:
   ```powershell
   winget install Kubernetes.kubectl
   ```
4. Run kube-panel, pick a context, and go.

> Each `v*` tag triggers a GitHub Actions build that attaches the Windows
> `.exe` to a draft Release (publish it from the Releases UI to make it public).

---

## 🛠️ Development

**Prerequisites:** Windows 11 · `kubectl` on PATH · Node.js + pnpm · Rust (rustup)

```bash
pnpm install
pnpm tauri dev      # hot-reload dev app (Vite HMR + cargo rebuild on Rust changes)
```

### Tests

```bash
# Rust unit/integration tests (parsers, stream/pf registries, history DB)
cd src-tauri && cargo test --lib

# Frontend component + API tests
pnpm vitest run
```

### Production build

```bash
pnpm tauri build    # NSIS installer + portable .exe → src-tauri/target/release/bundle/
```

The binary does **not** bundle `kubectl` — it's detected at runtime, with a
winget hint if missing.

---

## 🏗️ Architecture

```
kube-panel/
├─ src-tauri/                 # Rust backend (Tauri commands)
│  ├─ src/
│  │  ├─ kubeconfig.rs        # parse ~/.kube/config + KUBECONFIG (serde_yaml)
│  │  ├─ kubectl.rs           # build Command (argv, --context, -n, --kubeconfig)
│  │  ├─ runtime.rs           # KubeRuntime: run (one-shot, history) + build_cmd (stream)
│  │  ├─ commands.rs          # all #[tauri::command] fns
│  │  ├─ stream.rs            # StreamRegistry: kubectl logs -f children (single + multi)
│  │  ├─ portforward.rs       # PfRegistry: port-forward lifecycle (monitor + stop channel)
│  │  ├─ exec.rs              # ExecRegistry: kubectl exec -it PTY (portable-pty + reader thread)
│  │  ├─ history.rs           # SQLite history CRUD (metadata-only)
│  │  └─ models.rs            # JSON parsers: pods, deployments, configmaps, events
│  ├─ tauri.conf.json
│  └─ Cargo.toml
├─ src/                       # React 18 + TS frontend
│  ├─ App.tsx
│  ├─ components/             # PodTable, DeploymentTable, LogViewer, MergedLogViewer,
│  │                          # PodActionModal, RolloutModal, PortForwardPanel,
│  │                          # ResourceBrowser, ExecTerminal, …
│  ├─ api/tauri.ts            # invoke() wrappers + event listeners (log_chunk, pf_status)
│  ├─ stores/appStore.ts      # zustand (namespace)
│  └─ types.ts                # TS types mirroring Rust serde::Serialize output
├─ docs/                      # design spec + phased plans
└─ .github/workflows/release.yml
```

<details>
<summary><b>🔧 Key design decisions</b></summary>

- **Shell out, don't bind.** The `kube` Rust crate isn't used for cluster
  access — only `serde_yaml` to parse the kubeconfig file. Cloud auth exec
  plugins and krew plugins stay transparent.
- **`KUBECONFIG` agreement rule.** When `KUBECONFIG` is set, the runner passes
  **no** `--kubeconfig` (kubectl reads the env); otherwise it passes
  `~/.kube/config`. Parser and runner agree.
- **Streaming = events, not awaits.** Long-lived `kubectl logs -f` /
  `port-forward` children live in a registry; stdout chunks are emitted to the
  frontend via Tauri events (`log_chunk`, `pf_status`). The one-shot `run` path
  records history; streaming records a single `is_stream=true` row and never
  persists chunk text.
- **Race-free context.** The current context is derived from the `['contexts']`
  query (single source of truth), so pod/deployment queries change key on
  switch and refetch fresh — no stale-context race.

</details>

---

## 🔐 Security

- ✅ **No shell, no injection** — all kubectl calls use `tokio::process::Command`
  with argv arrays. Pod/deployment names are discrete argv elements; `--since` /
  `--tail` are single `--key=value` tokens.
- ✅ **No destructive commands** — `delete` / `apply -f` / `exec` / `patch` /
  `--force` are absent from the codebase.
- ✅ **Write ops are gated** — rollout restart/scale/undo and port-forward start
  show the exact command in a confirm modal. **Context switch** is intentionally
  ungated (non-destructive navigation — blast radius is limited because the real
  destructive ops stay gated).
- ✅ **History is metadata-only** — no stdout/stderr column; kubectl output
  (which can carry `secret` base64, ConfigMap DB strings, describe env vars)
  never touches `~/.kube-panel/history.db`.
- ✅ **kubeconfig is parsed, not logged** — only context/cluster/user **names**
  cross IPC; tokens, certs, and exec configs are dropped by serde.
- ⚠️ **Tauri CSP** is currently `null` (dev default) — pin a restrictive CSP
  before a stable release. Tracked as a TODO.

See the design doc for the full security rationale (§6.4).

---

## 🗺️ Roadmap

**Done**
- [x] Context / namespace switching
- [x] Pod table + filter + anomaly highlight
- [x] Streaming logs + regex search + export + fullscreen
- [x] Multi-pod merged tail
- [x] Pod right-click: images / configmaps / describe / events / **YAML**
- [x] Deployments view + rollout restart/scale/undo/history
- [x] Port-forward manager
- [x] Command history (metadata-only, searchable)
- [x] **Live auto-refresh** of pod / deployment / node tables
- [x] **Node view** (status, roles, pressure, allocatable, describe)
- [x] **Live event stream** (`kubectl --raw` watch)
- [x] **Resource browser** (svc / ingress / pvc / statefulset / daemonset / job / cronjob)
- [x] **Exec terminal** (ConPTY + xterm.js, interactive `kubectl exec -it`)
- [x] **Chinese tooltip hints** on UI controls (~66 native `title` tooltips)

**Planned / deferred**
- [ ] YAML apply (dry-run preview → confirm → apply)
- [ ] Cluster health badge (`get --raw /healthz` + `auth can-i`)
- [ ] Favorites / command snippets
- [ ] Anomaly-highlight polish (restart-spike detection, OOMKilled icon)
- [ ] Restrictive Tauri CSP

Full spec: [`docs/specs/2026-09-03-kube-panel-design.md`](docs/specs/2026-09-03-kube-panel-design.md)

---

## 🤝 Contributing

PRs welcome. Keep the TDD pattern where logic exists (Rust parsers, registries;
TS components via Vitest). Write ops must stay behind a confirm modal; history
must stay metadata-only.

---

## 📄 License

[MIT](LICENSE) © luyuxin
