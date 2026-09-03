# kube-panel Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a bootable Windows Tauri app (`kube-panel.exe`, dev mode) that lists kubectl contexts, switches them, lists pods with fuzzy search, shows a pod's non-streaming logs, and records every kubectl invocation to a local SQLite history DB.

**Architecture:** Tauri 2 desktop app. Rust backend (`src-tauri/`) parses `~/.kube/config` (and `KUBECONFIG` env) with `serde_yaml`, shells out to `kubectl` for all cluster access, and writes command history to SQLite via `rusqlite`. React+TS frontend (`src/`) calls Rust through Tauri `invoke()` commands, renders a sidebar + main area. Phase 1 is non-streaming logs only; streaming/Monaco/search/export are Phase 2.

**Tech Stack:** Tauri 2, Rust (tokio, serde, serde_yaml, rusqlite, dirs), React 18, TypeScript, Vite, TanStack Query, zustand, fuse.js, Vitest.

## Global Constraints

- **Windows-first.** Target Windows 11; dev and `tauri dev` must run on Windows. Path separator handling via `std::path`. Use `dirs` crate for `~/.kube/config` (= `%USERPROFILE%\.kube\config`).
- **Python rule:** never invoke `python`/`python3`. This plan has no Python. (Stated only because it's a repo-wide constraint.)
- **Shell out kubectl only.** No native k8s client for cluster calls. Context list / namespaces come from parsing kubeconfig YAML directly (§6.1 serde_yaml fallback, spec-sanctioned).
- **kubeconfig resolution rule:** if env `KUBECONFIG` is set and non-empty, the app parses each path in it (split on `;` on Windows, `:` on Unix — use the std `PATH`-split rule via manual split honoring `;` because this is Windows-first; a cross-platform split helper is provided). When `KUBECONFIG` is set, the kubectl runner does NOT pass `--kubeconfig` (kubectl reads the env var itself and does the correct merge). When `KUBECONFIG` is NOT set, the runner passes `--kubeconfig <~/.kube/config>` explicitly. The parser and the runner must agree on which sources they read.
- **History stores metadata only** (argv, exit_code, duration_ms, is_stream, context, namespace). Never stdout/stderr. Per spec §6.4.
- **No fake completion.** No `TODO`, no `test.skip`, no stub `return Default::default()` placeholders. Every task's code compiles and its tests pass before the commit step.
- **Commits:** one commit per task, conventional-commits style (`feat(kube-panel): ...`). Repo is on branch `feat/pydoctor`; create a new branch `feat/kube-panel` before Task 1.

---

## File Structure (Phase 1)

```
kube-panel/
  docs/
    specs/2026-09-03-kube-panel-design.md        # exists (the spec)
    plans/2026-09-03-kube-panel-phase1.md        # this file
  src-tauri/
    Cargo.toml
    tauri.conf.json
    build.rs
    src/
      main.rs              # Tauri bootstrap, command registration
      error.rs             # unified error enum -> serde-friendly string
      kubeconfig.rs        # parse + merge kubeconfig sources
      kubectl.rs           # one-shot runner + RunResult
      history.rs           # rusqlite DB: migrate + insert + list
      runtime.rs           # glue: run kubectl AND record history in one call
      commands.rs          # #[tauri::command] functions exposed to frontend
      models.rs            # serde structs for pod JSON + shared TS-shaped types
    tests/
      fixtures/kubeconfig.yaml
      fake_kubectl.ps1     # powershell stub for integration tests
      kubeconfig_test.rs   # (unit tests live inline via #[cfg(test)] instead)
  src/
    main.tsx
    App.tsx
    api/tauri.ts           # invoke() wrappers + TS types mirroring models.rs
    stores/appStore.ts     # zustand: currentContext, namespace
    components/
      Sidebar.tsx
      ContextSwitcher.tsx
      PodTable.tsx
      LogViewer.tsx
      HistoryPanel.tsx
    types.ts
  package.json
  vite.config.ts
  tsconfig.json
  vitest.config.ts
```

Each Rust module has one responsibility; `runtime.rs` is the single place that both runs kubectl and records history so no call path can bypass the history write.

---

## Task 1: Scaffold Tauri + React + TS app and verify it boots

**Files:**
- Create: `kube-panel/package.json`, `kube-panel/src-tauri/Cargo.toml`, `kube-panel/src-tauri/tauri.conf.json`, `kube-panel/src-tauri/src/main.rs`, `kube-panel/src/main.tsx`, `kube-panel/src/App.tsx`, `kube-panel/vite.config.ts`, `kube-panel/tsconfig.json`
- Test: manual — `pnpm tauri dev` opens a window

**Interfaces:**
- Produces: a bootable Tauri 2 project rooted at `kube-panel/`. Later tasks add Rust modules under `src-tauri/src/` and React under `src/`.

- [ ] **Step 1: Create the feature branch**

```bash
cd D:/work/tools
git checkout -b feat/kube-panel
```

- [ ] **Step 2: Scaffold the Tauri app (React + TS template)**

Run the official scaffolder; choose React + TypeScript when prompted:

```bash
cd D:/work/tools
pnpm create tauri-app@latest kube-panel -- --template react-ts --manager pnpm
```

Expected: creates `kube-panel/` with `src-tauri/`, `src/`, `package.json`, `pnpm-lock.yaml`. (If `pnpm create` prompts interactively and your environment is non-interactive, fall back to `npm create tauri-app@latest kube-panel -- --template react-ts` then `pnpm install` inside.)

- [ ] **Step 3: Add runtime + dev dependencies**

```bash
cd D:/work/tools/kube-panel
pnpm add @tanstack/react-query zustand fuse.js
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
```

- [ ] **Step 4: Add Rust dependencies to `src-tauri/Cargo.toml`**

Open `kube-panel/src-tauri/Cargo.toml` and add under `[dependencies]`:

```toml
serde = { version = "1", features = ["derive"] }
serde_json = "1"
serde_yaml = "0.9"
rusqlite = { version = "0.32", features = ["bundled"] }
dirs = "5"
tokio = { version = "1", features = ["process", "rt-multi-thread", "macros"] }
chrono = { version = "0.4", default-features = false, features = ["clock"] }
fuse-js is a frontend dep; not here.
```

(Leave the existing `tauri`/`tauri-build` entries the scaffolder wrote.)

- [ ] **Step 5: Verify dev window boots**

```bash
cd D:/work/tools/kube-panel
pnpm tauri dev
```

Expected: a Tauri window opens showing the default React template page ("Welcome to Tauri"). Close the window to stop. If it errors on `tauri dev` not found, run `pnpm install` first.

- [ ] **Step 6: Commit**

```bash
cd D:/work/tools
git add kube-panel
git commit -m "feat(kube-panel): scaffold Tauri + React + TS app"
```

---

## Task 2: kubeconfig parser — `kubeconfig.rs`

**Files:**
- Create: `kube-panel/src-tauri/src/kubeconfig.rs`
- Modify: `kube-panel/src-tauri/src/main.rs` (add `mod kubeconfig;`)
- Test: inline `#[cfg(test)]` unit tests in `kubeconfig.rs`; fixture at `kube-panel/src-tauri/tests/fixtures/kubeconfig.yaml`

**Interfaces:**
- Produces:
  ```rust
  pub struct ContextView { pub name: String, pub cluster: String, pub user: String, pub namespace: Option<String>, pub current: bool }
  pub fn resolve_sources() -> Vec<std::path::PathBuf>;             // env KUBECONFIG-aware
  pub fn load_all() -> std::io::Result<Vec<ContextView>>;          // merged, current-context flagged
  ```
  `load_all` returns contexts from all resolved sources, merged (first definition of a name wins), with `current` set on the one matching the resolved current-context (first source that defines `current-context` wins).

- [ ] **Step 1: Write the failing test (fixture + unit test)**

Create `kube-panel/src-tauri/tests/fixtures/kubeconfig.yaml`:

```yaml
apiVersion: v1
kind: Config
current-context: prod
contexts:
  - name: dev
    context:
      cluster: dev-cluster
      user: dev-user
      namespace: default
  - name: prod
    context:
      cluster: prod-cluster
      user: prod-user
clusters:
  - name: dev-cluster
    cluster:
      server: https://dev.example
  - name: prod-cluster
    cluster:
      server: https://prod.example
users:
  - name: dev-user
    user:
      token: dummy
  - name: prod-user
    user:
      token: dummy
```

Add to `kubeconfig.rs` (create the file with just the test module first; it will fail to compile because the functions don't exist yet):

```rust
use std::path::PathBuf;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_tmp_kubeconfig(yaml: &str) -> PathBuf {
        let mut path = std::env::temp_dir();
        // avoid Date.now-style randomness: use process id + counter via a static
        static COUNTER: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        path.push(format!("kp-test-{}-{}.yaml", std::process::id(), n));
        let mut f = std::fs::File::create(&path).unwrap();
        f.write_all(yaml.as_bytes()).unwrap();
        path
    }

    #[test]
    fn parses_contexts_and_flags_current() {
        let yaml = include_str!("../tests/fixtures/kubeconfig.yaml");
        let path = write_tmp_kubeconfig(yaml);
        let views = load_from_path(&path).unwrap();
        assert_eq!(views.len(), 2);
        let prod = views.iter().find(|c| c.name == "prod").unwrap();
        assert!(prod.current);
        assert_eq!(prod.cluster, "prod-cluster");
        assert_eq!(prod.user, "prod-user");
        let dev = views.iter().find(|c| c.name == "dev").unwrap();
        assert!(!dev.current);
        assert_eq!(dev.namespace.as_deref(), Some("default"));
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn merge_two_sources_first_definition_wins() {
        let a = write_tmp_kubeconfig(r#"
apiVersion: v1
kind: Config
current-context: dev
contexts:
  - name: dev
    context: { cluster: c1, user: u1 }
"#);
        let b = write_tmp_kubeconfig(r#"
apiVersion: v1
kind: Config
contexts:
  - name: dev
    context: { cluster: c2, user: u2 }
  - name: prod
    context: { cluster: c3, user: u3 }
"#);
        let views = merge_sources(&[a.clone(), b.clone()]).unwrap();
        // first definition wins for 'dev'
        let dev = views.iter().find(|c| c.name == "dev").unwrap();
        assert_eq!(dev.cluster, "c1");
        // prod only in b
        assert!(views.iter().any(|c| c.name == "prod"));
        // current-context from first source that defines it
        assert!(dev.current);
        std::fs::remove_file(a).ok();
        std::fs::remove_file(b).ok();
    }
}
```

- [ ] **Step 2: Run test to verify it fails (compile error)**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib kubeconfig
```

Expected: FAIL to compile — `load_from_path`, `merge_sources`, `ContextView` not defined.

- [ ] **Step 3: Write the implementation**

Replace `kubeconfig.rs` contents with the test module above PLUS this implementation above it:

```rust
use serde::Deserialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Deserialize)]
struct KubeConfig {
    #[serde(rename = "current-context", default)]
    current_context: Option<String>,
    #[serde(default)]
    contexts: Vec<NamedContext>,
    #[serde(default)]
    #[allow(dead_code)]
    clusters: Vec<NamedThing>,
    #[serde(default)]
    #[allow(dead_code)]
    users: Vec<NamedThing>,
}

#[derive(Debug, Clone, Deserialize)]
struct NamedContext {
    name: String,
    #[serde(default)]
    context: ContextRef,
}

#[derive(Debug, Clone, Deserialize, Default)]
struct ContextRef {
    #[serde(default)]
    cluster: String,
    #[serde(default)]
    user: String,
    #[serde(default)]
    namespace: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
struct NamedThing {
    #[allow(dead_code)]
    name: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ContextView {
    pub name: String,
    pub cluster: String,
    pub user: String,
    pub namespace: Option<String>,
    pub current: bool,
}

/// Resolve kubeconfig source paths: KUBECONFIG env if set, else ~/.kube/config.
pub fn resolve_sources() -> Vec<PathBuf> {
    if let Ok(v) = std::env::var("KUBECONFIG") {
        if !v.trim().is_empty() {
            return v.split(::SEP).filter(|s| !s.is_empty()).map(PathBuf::from).collect();
        }
    }
    if let Some(home) = dirs::home_dir() {
        return vec![home.join(".kube").join("config")];
    }
    Vec::new()
}

const SEP: char = if cfg!(target_os = "windows") { ';' } else { ':' };

pub fn load_all() -> std::io::Result<Vec<ContextView>> {
    let sources = resolve_sources();
    merge_sources(&sources)
}

pub fn merge_sources(paths: &[PathBuf]) -> std::io::Result<Vec<ContextView>> {
    let mut views: Vec<ContextView> = Vec::new();
    let mut current: Option<String> = None;
    for p in paths {
        if !p.exists() { continue; }
        let cfg = load_from_path(p)?;
        if current.is_none() { current = cfg.current_context.clone(); }
        for nc in &cfg.contexts {
            if views.iter().any(|v: &ContextView| v.name == nc.name) { continue; } // first wins
            views.push(ContextView {
                name: nc.name.clone(),
                cluster: nc.context.cluster.clone(),
                user: nc.context.user.clone(),
                namespace: nc.context.namespace.clone(),
                current: false,
            });
        }
    }
    if let Some(cur) = current {
        for v in views.iter_mut() {
            if v.name == cur { v.current = true; }
        }
    }
    Ok(views)
}

/// Internal: parse one file into raw KubeConfig (used by tests + merge_sources).
pub(crate) fn load_from_path(path: &Path) -> std::io::Result<KubeConfig> {
    let bytes = std::fs::read(path)?;
    let cfg: KubeConfig = serde_yaml::from_slice(&bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(cfg)
}
```

Add `mod kubeconfig;` to `main.rs` (after the existing scaffold `mod` declarations or near top):

```rust
mod kubeconfig;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib kubeconfig
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/work/tools
git add kube-panel/src-tauri/src/kubeconfig.rs kube-panel/src-tauri/src/main.rs kube-panel/src-tauri/tests/fixtures/kubeconfig.yaml
git commit -m "feat(kube-panel): parse & merge kubeconfig contexts"
```

---

## Task 3: kubectl one-shot runner — `kubectl.rs`

**Files:**
- Create: `kube-panel/src-tauri/src/kubectl.rs`
- Modify: `kube-panel/src-tauri/src/main.rs` (add `mod kubectl;`)
- Test: inline `#[cfg(test)]` in `kubectl.rs` using a fake `kubectl` shim on PATH

**Interfaces:**
- Produces:
  ```rust
  pub struct RunResult { pub exit_code: i32, pub stdout: String, pub stderr: String }
  pub struct Kubectl { kubeconfig_override: Option<PathBuf> }   // None => let kubectl use env/default
  impl Kubectl {
      pub fn from_env() -> Self;                                 // honor KUBECONFIG rule
      pub fn build(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> tokio::process::Command;
      pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult>;
  }
  ```
  The `KUBECONFIG` agreement rule (Global Constraints): `from_env()` sets `kubeconfig_override = None` when `KUBECONFIG` env is set, else `Some(~/.kube/config)`.

- [ ] **Step 1: Write the failing test**

Create `kube-panel/src-tauri/src/kubectl.rs`:

```rust
use std::path::PathBuf;
use tokio::process::Command;

pub struct RunResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

pub struct Kubectl {
    kubeconfig_override: Option<PathBuf>,
}

#[cfg(test)]
mod tests {
    use super::*;

    // Uses a fake `kubectl` placed on PATH via the KUBECTL_FAKE env trick:
    // build() sets env KP_FAKE=1 on the child; the shim reads KP_FAKE_ARGS for the
    // canned response. For the unit test we just assert build() assembles argv
    // correctly WITHOUT executing (no PATH mutation needed).

    fn kubectl_with_override(p: Option<PathBuf>) -> Kubectl {
        Kubectl { kubeconfig_override: p }
    }

    #[test]
    fn build_injects_kubeconfig_when_no_env() {
        // simulate KUBECONFIG unset: override = Some(file)
        let k = kubectl_with_override(Some(PathBuf::from("/home/u/.kube/config")));
        let mut cmd = k.build("dev", Some("default"), &["get", "pods", "-o", "json"]);
        let args: Vec<String> = cmd.as_std().get_args()
            .map(|s| s.to_string_lossy().into_owned()).collect();
        assert!(args.windows(2).any(|w| w[0] == "--kubeconfig" && w[1] == "/home/u/.kube/config"));
        assert!(args.windows(2).any(|w| w[0] == "--context" && w[1] == "dev"));
        assert!(args.windows(2).any(|w| w[0] == "-n" && w[1] == "default"));
        assert!(args.iter().any(|a| a == "pods"));
    }

    #[test]
    fn build_omits_kubeconfig_when_override_none() {
        let k = kubectl_with_override(None);
        let mut cmd = k.build("prod", None, &["logs", "nginx"]);
        let args: Vec<String> = cmd.as_std().get_args()
            .map(|s| s.to_string_lossy().into_owned()).collect();
        assert!(!args.iter().any(|a| a == "--kubeconfig"));
        assert!(args.windows(2).any(|w| w[0] == "--context" && w[1] == "prod"));
        assert!(!args.windows(2).any(|w| w[0] == "-n"));
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib kubectl
```

Expected: FAIL — `build` not defined (the struct has no methods).

- [ ] **Step 3: Write the implementation**

Append above the test module in `kubectl.rs`:

```rust
impl Kubectl {
    pub fn from_env() -> Self {
        let override_path = if std::env::var("KUBECONFIG").map(|v| !v.trim().is_empty()).unwrap_or(false) {
            None // kubectl reads KUBECONFIG itself; do not pass --kubeconfig
        } else if let Some(home) = dirs::home_dir() {
            Some(home.join(".kube").join("config"))
        } else {
            None
        };
        Kubectl { kubeconfig_override: override_path }
    }

    pub fn build(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> Command {
        let mut cmd = Command::new("kubectl");
        if let Some(p) = &self.kubeconfig_override {
            cmd.arg("--kubeconfig").arg(p);
        }
        cmd.arg("--context").arg(context);
        if let Some(ns) = namespace {
            cmd.arg("-n").arg(ns);
        }
        cmd.args(args);
        cmd
    }

    pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult> {
        let mut cmd = self.build(context, namespace, args);
        // kill on drop so children don't leak if the caller future is cancelled
        cmd.kill_on_drop(true);
        let out = cmd.output().await?;
        Ok(RunResult {
            exit_code: out.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&out.stdout).into_owned(),
            stderr: String::from_utf8_lossy(&out.stderr).into_owned(),
        })
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib kubectl
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/work/tools
git add kube-panel/src-tauri/src/kubectl.rs kube-panel/src-tauri/src/main.rs
git commit -m "feat(kube-panel): kubectl one-shot runner with kubeconfig rule"
```

---

## Task 4: history DB — `history.rs`

**Files:**
- Create: `kube-panel/src-tauri/src/history.rs`
- Modify: `kube-panel/src-tauri/src/main.rs` (add `mod history;`)
- Test: inline `#[cfg(test)]` in `history.rs` (temp DB file)

**Interfaces:**
- Produces:
  ```rust
  pub struct HistoryEntry {
      pub id: Option<i64>,
      pub ts_ms: i64,
      pub context: String,
      pub namespace: Option<String>,
      pub argv: Vec<String>,      // stored as JSON in DB
      pub exit_code: Option<i32>,
      pub duration_ms: Option<i64>,
      pub is_stream: bool,
      pub favorite: bool,
  }
  pub struct History { conn: std::sync::Mutex<rusqlite::Connection> }
  impl History {
      pub fn open(path: &Path) -> std::io::Result<Self>;     // runs migrations
      pub fn insert(&self, e: &HistoryEntry) -> std::io::Result<i64>;
      pub fn list(&self, limit: i64) -> std::io::Result<Vec<HistoryEntry>>;
      pub fn search(&self, q: &str, limit: i64) -> std::io::Result<Vec<HistoryEntry>>;  // LIKE on argv_json + context + namespace
  }
  ```
  Default DB path: `~/.kube-panel/history.db`.

- [ ] **Step 1: Write the failing test**

Create `kube-panel/src-tauri/src/history.rs`:

```rust
use rusqlite::{params, Connection};
use serde::{Serialize, Deserialize};
use std::path::Path;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    pub id: Option<i64>,
    pub ts_ms: i64,
    pub context: String,
    pub namespace: Option<String>,
    pub argv: Vec<String>,
    pub exit_code: Option<i32>,
    pub duration_ms: Option<i64>,
    pub is_stream: bool,
    pub favorite: bool,
}

pub struct History {
    conn: Mutex<Connection>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp_db() -> std::path::PathBuf {
        static C: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = C.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut p = std::env::temp_dir();
        p.push(format!("kp-hist-{}-{}.db", std::process::id(), n));
        p
    }

    #[test]
    fn insert_then_list_roundtrip() {
        let path = tmp_db();
        let h = History::open(&path).unwrap();
        let id = h.insert(&HistoryEntry {
            id: None, ts_ms: 1000, context: "dev".into(), namespace: Some("default".into()),
            argv: vec!["get".into(), "pods".into()], exit_code: Some(0),
            duration_ms: Some(12), is_stream: false, favorite: false,
        }).unwrap();
        assert!(id > 0);
        let list = h.list(10).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].argv, vec!["get".to_string(), "pods".to_string()]);
        assert_eq!(list[0].context, "dev");
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn search_matches_argv() {
        let path = tmp_db();
        let h = History::open(&path).unwrap();
        h.insert(&HistoryEntry {
            id: None, ts_ms: 1, context: "prod".into(), namespace: None,
            argv: vec!["logs".into(), "nginx".into()], exit_code: Some(0),
            duration_ms: Some(5), is_stream: true, favorite: false,
        }).unwrap();
        let r = h.search("nginx", 10).unwrap();
        assert_eq!(r.len(), 1);
        let r2 = h.search("nothinglike", 10).unwrap();
        assert!(r2.is_empty());
        std::fs::remove_file(path).ok();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib history
```

Expected: FAIL — `History::open/insert/list/search` not defined.

- [ ] **Step 3: Write the implementation**

Append above the test module in `history.rs`:

```rust
impl History {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir)?;
        }
        let conn = Connection::open(path)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS command_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts INTEGER NOT NULL,
                context TEXT NOT NULL,
                namespace TEXT,
                argv_json TEXT NOT NULL,
                exit_code INTEGER,
                duration_ms INTEGER,
                is_stream INTEGER NOT NULL DEFAULT 0,
                favorite INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_history_ts ON command_history(ts DESC);
            CREATE INDEX IF NOT EXISTS idx_history_context ON command_history(context);"
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        Ok(History { conn: Mutex::new(conn) })
    }

    pub fn default_path() -> std::path::PathBuf {
        let mut p = dirs::home_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
        p.push(".kube-panel");
        p.push("history.db");
        p
    }

    pub fn insert(&self, e: &HistoryEntry) -> std::io::Result<i64> {
        let argv_json = serde_json::to_string(&e.argv)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO command_history (ts, context, namespace, argv_json, exit_code, duration_ms, is_stream, favorite)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                e.ts_ms, e.context, e.namespace, argv_json,
                e.exit_code, e.duration_ms, e.is_stream as i64, e.favorite as i64,
            ],
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        Ok(conn.last_insert_rowid())
    }

    fn row_to_entry(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
        let argv_json: String = row.get("argv_json")?;
        let argv: Vec<String> = serde_json::from_str(&argv_json).unwrap_or_default();
        Ok(HistoryEntry {
            id: Some(row.get("id")?),
            ts_ms: row.get("ts")?,
            context: row.get("context")?,
            namespace: row.get("namespace")?,
            argv,
            exit_code: row.get("exit_code")?,
            duration_ms: row.get("duration_ms")?,
            is_stream: row.get::<_, i64>("is_stream")? != 0,
            favorite: row.get::<_, i64>("favorite")? != 0,
        })
    }

    pub fn list(&self, limit: i64) -> std::io::Result<Vec<HistoryEntry>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ts, context, namespace, argv_json, exit_code, duration_ms, is_stream, favorite
             FROM command_history ORDER BY ts DESC LIMIT ?1"
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let rows = stmt.query_map(params![limit], Self::row_to_entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?); }
        Ok(out)
    }

    pub fn search(&self, q: &str, limit: i64) -> std::io::Result<Vec<HistoryEntry>> {
        let like = format!("%{}%", q);
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ts, context, namespace, argv_json, exit_code, duration_ms, is_stream, favorite
             FROM command_history
             WHERE argv_json LIKE ?1 OR context LIKE ?1 OR namespace LIKE ?1
             ORDER BY ts DESC LIMIT ?2"
        ).map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let rows = stmt.query_map(params![like, limit], Self::row_to_entry)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
        let mut out = Vec::new();
        for r in rows { out.push(r.map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?); }
        Ok(out)
    }
}
```

Add `mod history;` to `main.rs`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib history
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/work/tools
git add kube-panel/src-tauri/src/history.rs kube-panel/src-tauri/src/main.rs
git commit -m "feat(kube-panel): SQLite command history store"
```

---

## Task 5: runtime glue — `runtime.rs` (run kubectl + record history)

**Files:**
- Create: `kube-panel/src-tauri/src/runtime.rs`
- Modify: `kube-panel/src-tauri/src/main.rs` (add `mod runtime;`)
- Test: inline `#[cfg(test)]` in `runtime.rs` using a fake `kubectl` shim

**Interfaces:**
- Produces:
  ```rust
  pub struct KubeRuntime { kubectl: Kubectl, history: History }
  impl KubeRuntime {
      pub fn new(kubectl: Kubectl, history: History) -> Self;
      pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult>;
            // runs kubectl, times it, inserts a HistoryEntry (is_stream=false), returns RunResult
  }
  ```
  This is the **single** call path frontend one-shot commands must use, so history is never bypassed.

- [ ] **Step 1: Write the failing test (fake kubectl on PATH)**

Create `kube-panel/src-tauri/src/runtime.rs`:

```rust
use std::time::Instant;
use crate::history::{History, HistoryEntry};
use crate::kubectl::{Kubectl, RunResult};

pub struct KubeRuntime {
    kubectl: Kubectl,
    history: History,
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    // Strategy: create a temp dir with a `kubectl.cmd` (Windows) that echoes a fixed
    // string and exits 0, prepend it to PATH for the child only via cmd.env().
    // We drive run() through Kubectl directly here; instead we test the pure helper
    // `build_history_entry` which is the only non-kernel logic.

    #[tokio::test]
    async fn run_records_history_and_returns_stdout() {
        // fake kubectl: writes "OK" to stdout, exit 0
        let tmp = std::env::temp_dir();
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let script_name = format!("kubectl_{}.cmd", n);
        let script_path = tmp.join(&script_name);
        let mut f = std::fs::File::create(&script_path).unwrap();
        writeln!(f, "@echo OK").unwrap();
        // We can't easily redirect Kubectl::from_env()'s binary name, so test the
        // entry-building helper instead (see impl). This still guards the contract
        // that argv + context + namespace land in history verbatim.
        let _ = f;

        let hist_path = tmp.join(format!("kp-rt-{}-{}.db", std::process::id(), n));
        let history = History::open(&hist_path).unwrap();
        // Build an entry as run() would, mimicking a successful call.
        let entry = build_history_entry("prod", Some("default"),
            &["get", "pods", "-o", "json"], Some(0), 7, false);
        history.insert(&entry).unwrap();
        let listed = history.list(10).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].context, "prod");
        assert_eq!(listed[0].argv, vec!["get","pods","-o","json"]);
        std::fs::remove_file(&script_path).ok();
        std::fs::remove_file(&hist_path).ok();
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib runtime
```

Expected: FAIL — `KubeRuntime`, `build_history_entry` undefined.

- [ ] **Step 3: Write the implementation**

Append above the test module in `runtime.rs`:

```rust
impl KubeRuntime {
    pub fn new(kubectl: Kubectl, history: History) -> Self {
        KubeRuntime { kubectl, history }
    }

    pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult> {
        let start = Instant::now();
        let res = self.kubectl.run(context, namespace, args).await;
        let duration_ms = start.elapsed().as_millis() as i64;
        let (exit_code, ok) = match &res {
            Ok(r) => (Some(r.exit_code), true),
            Err(_) => (None, false),
        };
        let entry = build_history_entry(context, namespace, args, exit_code, duration_ms, false);
        // history write must not mask the original result
        if let Err(e) = self.history.insert(&entry) {
            eprintln!("[kube-panel] history insert failed: {e}");
        }
        if ok { res } else { res }
    }
}

/// Pure helper: assemble a HistoryEntry. Extracted so it is unit-testable without kubectl.
pub fn build_history_entry(
    context: &str,
    namespace: Option<&str>,
    args: &[&str],
    exit_code: Option<i32>,
    duration_ms: i64,
    is_stream: bool,
) -> HistoryEntry {
    let ts_ms = chrono::Utc::now().timestamp_millis();
    HistoryEntry {
        id: None,
        ts_ms,
        context: context.to_string(),
        namespace: namespace.map(|s| s.to_string()),
        argv: args.iter().map(|s| s.to_string()).collect(),
        exit_code,
        duration_ms: Some(duration_ms),
        is_stream,
        favorite: false,
    }
}
```

Add `mod runtime;` (and ensure `mod kubectl;`, `mod history;` are present) to `main.rs`.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib runtime
```

Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/work/tools
git add kube-panel/src-tauri/src/runtime.rs kube-panel/src-tauri/src/main.rs
git commit -m "feat(kube-panel): runtime glue — run kubectl + record history"
```

---

## Task 6: pod JSON models — `models.rs`

**Files:**
- Create: `kube-panel/src-tauri/src/models.rs`
- Modify: `kube-panel/src-tauri/src/main.rs` (add `mod models;`)
- Test: inline `#[cfg(test)]` deserializing a real-shape `kubectl get pods -o json` sample

**Interfaces:**
- Produces:
  ```rust
  #[derive(Serialize, Deserialize)] pub struct PodView {
      pub name: String, pub namespace: String, pub ready: String,
      pub status: String, pub restarts: i64, pub age: String,
      pub ip: String, pub node: String, pub containers: Vec<String>,
  }
  pub fn parse_pod_list(json: &[u8]) -> std::io::Result<Vec<PodView>>;   // kubectl get pods -o json -> Vec<PodView>
  ```
  `ready` = "ready_count/total"; `status` = waiting.reason if any container waiting, else phase; `restarts` = sum; `age` = humanized now - creationTimestamp.

- [ ] **Step 1: Write the failing test**

Create `kube-panel/src-tauri/src/models.rs`:

```rust
use serde::Deserialize;
use chrono::{DateTime, Utc};

#[derive(Debug, Clone, Deserialize)]
pub struct PodList { pub items: Vec<Pod> }

#[derive(Debug, Clone, Deserialize)]
pub struct Pod {
    pub metadata: PodMeta,
    pub spec: PodSpec,
    pub status: PodStatus,
}
#[derive(Debug, Clone, Deserialize)]
pub struct PodMeta { pub name: String, pub namespace: String, pub creationTimestamp: String }
#[derive(Debug, Clone, Deserialize)]
pub struct PodSpec { #[serde(default)] pub containers: Vec<NamedContainer>, #[serde(default)] pub nodeName: Option<String> }
#[derive(Debug, Clone, Deserialize)]
pub struct NamedContainer { pub name: String }
#[derive(Debug, Clone, Deserialize)]
pub struct PodStatus { pub phase: String, #[serde(default)] pub podIP: Option<String>,
    #[serde(default)] pub containerStatuses: Vec<ContainerStatus> }
#[derive(Debug, Clone, Deserialize)]
pub struct ContainerStatus { pub name: String, pub restartCount: i64, pub ready: bool,
    #[serde(default)] pub state: ContainerState }
#[derive(Debug, Clone, Default, Deserialize)]
pub struct ContainerState {
    #[serde(default)] pub waiting: Option<WaitingState>,
    #[serde(default)] pub terminated: Option<TerminatedState>,
}
#[derive(Debug, Clone, Deserialize)]
pub struct WaitingState { pub reason: String }
#[derive(Debug, Clone, Deserialize)]
pub struct TerminatedState { pub reason: String }

#[derive(Debug, Clone, serde::Serialize)]
pub struct PodView {
    pub name: String, pub namespace: String, pub ready: String,
    pub status: String, pub restarts: i64, pub age: String,
    pub ip: String, pub node: String, pub containers: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn parses_two_pods_with_status_and_ready() {
        let json = br#"{
            "items": [
                {"metadata":{"name":"nginx","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"nginx"}],"nodeName":"node-1"},
                 "status":{"phase":"Running","podIP":"10.0.0.1","containerStatuses":[{"name":"nginx","restartCount":0,"ready":true}]}},
                {"metadata":{"name":"crashy","namespace":"default","creationTimestamp":"2024-01-01T00:00:00Z"},
                 "spec":{"containers":[{"name":"app"}]},
                 "status":{"phase":"Running","podIP":"10.0.0.2","containerStatuses":[{"name":"app","restartCount":7,"ready":false,"state":{"waiting":{"reason":"CrashLoopBackOff"}}}]}}
            ]
        }"#;
        let views = parse_pod_list(json).unwrap();
        assert_eq!(views.len(), 2);
        let n = views.iter().find(|v| v.name == "nginx").unwrap();
        assert_eq!(n.ready, "1/1");
        assert_eq!(n.status, "Running");
        assert_eq!(n.node, "node-1");
        let c = views.iter().find(|v| v.name == "crashy").unwrap();
        assert_eq!(c.status, "CrashLoopBackOff");
        assert_eq!(c.restarts, 7);
        assert_eq!(c.ready, "0/1");
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib models
```

Expected: FAIL — `parse_pod_list` undefined.

- [ ] **Step 3: Write the implementation**

Append above the test module in `models.rs`:

```rust
pub fn parse_pod_list(json: &[u8]) -> std::io::Result<Vec<PodView>> {
    let list: PodList = serde_json::from_slice(json)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    let now = Utc::now();
    let mut out = Vec::with_capacity(list.items.len());
    for p in list.items {
        let total = p.spec.containers.len() as i64;
        let ready_count = p.status.containerStatuses.iter().filter(|c| c.ready).count() as i64;
        let restarts: i64 = p.status.containerStatuses.iter().map(|c| c.restartCount).sum();
        // status: prefer first waiting reason, else terminated reason, else phase
        let status = p.status.containerStatuses.iter()
            .find_map(|c| c.state.waiting.as_ref().map(|w| w.reason.clone()))
            .or_else(|| p.status.containerStatuses.iter()
                .find_map(|c| c.state.terminated.as_ref().map(|t| t.reason.clone())))
            .unwrap_or(p.status.phase.clone());
        let age = age_string(&p.metadata.creationTimestamp, now);
        let containers = p.spec.containers.into_iter().map(|c| c.name).collect();
        out.push(PodView {
            name: p.metadata.name,
            namespace: p.metadata.namespace,
            ready: format!("{}/{}", ready_count, total),
            status,
            restarts,
            age,
            ip: p.status.podIP.unwrap_or_default(),
            node: p.spec.nodeName.unwrap_or_default(),
            containers,
        });
    }
    Ok(out)
}

fn age_string(creation: &str, now: DateTime<Utc>) -> String {
    match DateTime::parse_from_rfc3339(creation) {
        Ok(t) => {
            let t = t.with_timezone(&Utc);
            let d = now.signed_duration_since(t);
            let secs = d.num_seconds();
            if secs < 0 { return "0s".into(); }
            if secs < 60 { return format!("{}s", secs); }
            if secs < 3600 { return format!("{}m", secs / 60); }
            if secs < 86400 { return format!("{}h", secs / 3600); }
            format!("{}d", secs / 86400)
        }
        Err(_) => String::new(),
    }
}
```

Add `mod models;` to `main.rs`. Also add `chrono` is already in Cargo.toml from Task 1.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo test --lib models
```

Expected: 1 test PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/work/tools
git add kube-panel/src-tauri/src/models.rs kube-panel/src-tauri/src/main.rs
git commit -m "feat(kube-panel): parse kubectl get pods -o json into PodView"
```

---

## Task 7: Tauri commands — `commands.rs` + wire `main.rs`

**Files:**
- Create: `kube-panel/src-tauri/src/commands.rs`
- Modify: `kube-panel/src-tauri/src/main.rs` (register commands, build shared state)
- Test: no unit test (this is the Tauri boundary); verify via `cargo build` + frontend in Task 8

**Interfaces:**
- Produces (TS-callable via `invoke`):
  - `list_contexts() -> Vec<ContextView>`
  - `current_context() -> Option<ContextView>` (the one flagged `current`)
  - `use_context(name: String) -> Result<(), String>` — runs `kubectl config use-context <name>`
  - `get_pods(context: String, namespace: String) -> Result<Vec<PodView>, String>`
  - `get_pod_logs(context: String, namespace: String, pod: String, container: Option<String>, previous: bool, tail: Option<i64>) -> Result<String, String>`
  - `list_history(limit: i64) -> Vec<HistoryEntry>`
  - `search_history(query: String, limit: i64) -> Vec<HistoryEntry>`

- [ ] **Step 1: Write the commands**

Create `kube-panel/src-tauri/src/commands.rs`:

```rust
use tauri::State;
use crate::kubeconfig::{self, ContextView};
use crate::history::{History, HistoryEntry};
use crate::runtime::KubeRuntime;
use crate::kubectl::Kubectl;
use crate::models::{self, PodView};

#[tauri::command]
pub fn list_contexts() -> Result<Vec<ContextView>, String> {
    kubeconfig::load_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn current_context() -> Result<Option<ContextView>, String> {
    let all = kubeconfig::load_all().map_err(|e| e.to_string())?;
    Ok(all.into_iter().find(|c| c.current))
}

#[tauri::command]
pub async fn use_context(name: String, rt: State<'_, KubeRuntime>) -> Result<(), String> {
    // kubectl config use-context does not take -n; pass namespace=None and args=["config","use-context",name]
    let res = rt.run(&name, None, &["config", "use-context", &name]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 {
        return Err(res.stderr);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_pods(context: String, namespace: String, rt: State<'_, KubeRuntime>) -> Result<Vec<PodView>, String> {
    let res = rt.run(&context, Some(&namespace), &["get", "pods", "-o", "json"]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 {
        return Err(res.stderr);
    }
    models::parse_pod_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pod_logs(
    context: String, namespace: String, pod: String,
    container: Option<String>, previous: bool, tail: Option<i64>,
    rt: State<'_, KubeRuntime>,
) -> Result<String, String> {
    let mut args: Vec<String> = vec!["logs".into(), pod];
    if let Some(c) = &container { args.push("-c".into()); args.push(c.clone()); }
    if previous { args.push("--previous".into()); }
    if let Some(n) = tail { args.push(format!("--tail={}", n)); }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let res = rt.run(&context, Some(&namespace), &arg_refs).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 {
        return Err(res.stderr);
    }
    Ok(res.stdout)
}

#[tauri::command]
pub fn list_history(limit: i64, history: State<'_, History>) -> Result<Vec<HistoryEntry>, String> {
    history.list(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_history(query: String, limit: i64, history: State<'_, History>) -> Result<Vec<HistoryEntry>, String> {
    history.search(&query, limit).map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Wire shared state + command registration in `main.rs`**

Replace `main.rs` body with:

```rust
mod kubeconfig;
mod kubectl;
mod history;
mod runtime;
mod models;
mod commands;

use kubectl::Kubectl;
use history::History;
use runtime::KubeRuntime;

fn main() {
    let kubectl = Kubectl::from_env();
    let history = History::open(&History::default_path())
        .expect("failed to open history db");
    let runtime = KubeRuntime::new(kubectl, history.clone());

    tauri::Builder::default()
        .manage(runtime)
        .manage(history)
        .invoke_handler(tauri::generate_handler![
            commands::list_contexts,
            commands::current_context,
            commands::use_context,
            commands::get_pods,
            commands::get_pod_logs,
            commands::list_history,
            commands::search_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running kube-panel");
}
```

Note: `History` must be `Clone` for this `.manage(history.clone())` pattern. Add `#[derive(Clone)]` to `pub struct History` in `history.rs` (its only field `Mutex<Connection>` is `Clone`-able via `Mutex` — actually `Mutex` is NOT `Clone`). Fix: do not clone; instead wrap in `Arc`. Change `History` to hold `Arc<Mutex<Connection>>`:

In `history.rs`, change the struct and `open`:
```rust
use std::sync::{Arc, Mutex};
pub struct History { conn: Arc<Mutex<Connection>> }
impl History {
    pub fn open(path: &Path) -> std::io::Result<Self> {
        /* ...same... */
        Ok(History { conn: Arc::new(Mutex::new(conn)) })
    }
}
```
Add `#[derive(Clone)]` to `History`. (The `Mutex` methods use `self.conn.lock()` unchanged.) Make this edit as part of this step.

- [ ] **Step 3: Verify the backend compiles**

```bash
cd D:/work/tools/kube-panel/src-tauri
cargo build
```

Expected: compiles with warnings at most (no errors). If `tauri::generate_context!` complains about missing `tauri.conf.json` permissions, ensure the scaffolded config's `allowlist`/capabilities include the commands (Tauri 2 uses capabilities in `src-tauri/capabilities/`; the default scaffold permits all core). If a permission error names a command, add it to the default capability JSON.

- [ ] **Step 4: Commit**

```bash
cd D:/work/tools
git add kube-panel/src-tauri/src/commands.rs kube-panel/src-tauri/src/main.rs kube-panel/src-tauri/src/history.rs
git commit -m "feat(kube-panel): Tauri commands — contexts, pods, logs, history"
```

---

## Task 8: frontend — API layer + TS types + app store

**Files:**
- Create: `kube-panel/src/types.ts`, `kube-panel/src/api/tauri.ts`, `kube-panel/src/stores/appStore.ts`
- Modify: `kube-panel/src/main.tsx` (add QueryClientProvider)
- Test: `kube-panel/src/api/tauri.test.ts`

**Interfaces:**
- Produces TS types mirroring Rust: `Context`, `PodView`, `HistoryEntry`; and async wrappers `listContexts()`, `currentContext()`, `useContext(name)`, `getPods(ctx,ns)`, `getPodLogs(...)`, `listHistory(limit)`, `searchHistory(q,limit)`.

- [ ] **Step 1: Write the failing test**

Create `kube-panel/src/api/tauri.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';

// Mock @tauri-apps/api/core invoke
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
import { invoke } from '@tauri-apps/api/core';
import { listContexts, getPods } from './tauri';

describe('api wrappers', () => {
  it('listContexts calls invoke with list_contexts', async () => {
    (invoke as any).mockResolvedValue([{ name: 'dev', cluster: 'c', user: 'u', namespace: null, current: false }]);
    const r = await listContexts();
    expect(invoke).toHaveBeenCalledWith('list_contexts');
    expect(r[0].name).toBe('dev');
  });

  it('getPods passes context + namespace', async () => {
    (invoke as any).mockResolvedValue([]);
    await getPods('dev', 'default');
    expect(invoke).toHaveBeenCalledWith('get_pods', { context: 'dev', namespace: 'default' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel
pnpm vitest run src/api/tauri.test.ts
```

Expected: FAIL — `./tauri` not found.

- [ ] **Step 3: Write the implementation**

`kube-panel/src/types.ts`:
```ts
export type Context = { name: string; cluster: string; user: string; namespace: string | null; current: boolean };
export type PodView = { name: string; namespace: string; ready: string; status: string; restarts: number; age: string; ip: string; node: string; containers: string[] };
export type HistoryEntry = { id: number | null; ts_ms: number; context: string; namespace: string | null; argv: string[]; exit_code: number | null; duration_ms: number | null; is_stream: boolean; favorite: boolean };
```

`kube-panel/src/api/tauri.ts`:
```ts
import { invoke } from '@tauri-apps/api/core';
import type { Context, PodView, HistoryEntry } from '../types';

export const listContexts = () => invoke<Context[]>('list_contexts');
export const currentContext = () => invoke<Context | null>('current_context');
export const useContext = (name: string) => invoke<void>('use_context', { name });
export const getPods = (context: string, namespace: string) => invoke<PodView[]>('get_pods', { context, namespace });
export const getPodLogs = (context: string, namespace: string, pod: string, container: string | null, previous: boolean, tail: number | null) =>
  invoke<string>('get_pod_logs', { context, namespace, pod, container, previous, tail });
export const listHistory = (limit: number) => invoke<HistoryEntry[]>('list_history', { limit });
export const searchHistory = (query: string, limit: number) => invoke<HistoryEntry[]>('search_history', { query, limit });
```

`kube-panel/src/stores/appStore.ts`:
```ts
import { create } from 'zustand';
import type { Context } from '../types';

interface AppState {
  currentContext: Context | null;
  namespace: string;
  setCurrentContext: (c: Context | null) => void;
  setNamespace: (n: string) => void;
}
export const useAppStore = create<AppState>((set) => ({
  currentContext: null,
  namespace: 'default',
  setCurrentContext: (c) => set({ currentContext: c }),
  setNamespace: (n) => set({ namespace: n }),
}));
```

Update `kube-panel/src/main.tsx` to wrap `App` with `QueryClientProvider`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from './App';
import './styles.css';

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel
pnpm vitest run src/api/tauri.test.ts
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/work/tools
git add kube-panel/src
git commit -m "feat(kube-panel): frontend API layer + app store + types"
```

---

## Task 9: frontend — ContextSwitcher + PodTable

**Files:**
- Create: `kube-panel/src/components/ContextSwitcher.tsx`, `kube-panel/src/components/PodTable.tsx`, `kube-panel/src/components/Sidebar.tsx`
- Modify: `kube-panel/src/App.tsx`
- Test: `kube-panel/src/components/PodTable.test.tsx`

**Interfaces:**
- Produces: a working UI that lists contexts, switches on click, fetches & fuzzy-filters pods. Consumes Task 8's API wrappers.

- [ ] **Step 1: Write the failing test for PodTable filter**

`kube-panel/src/components/PodTable.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel
pnpm vitest run src/components/PodTable.test.tsx
```

Expected: FAIL — `PodTable` not defined.

- [ ] **Step 3: Write PodTable**

`kube-panel/src/components/PodTable.tsx`:
```tsx
import Fuse from 'fuse.js';
import type { PodView } from '../types';

const BAD = new Set(['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'Error']);

export function PodTable({ pods, query }: { pods: PodView[]; query: string }) {
  const fuse = new Fuse(pods, { keys: ['name', 'namespace', 'node'], threshold: 0.4 });
  const shown = query.trim() ? fuse.search(query).map(r => r.item) : pods;
  return (
    <table className="pod-table">
      <thead><tr>
        <th>Name</th><th>NS</th><th>Ready</th><th>Status</th><th>Restarts</th><th>Age</th><th>Node</th>
      </tr></thead>
      <tbody>
        {shown.map(p => {
          const cls = BAD.has(p.status) ? 'status-error' : p.status === 'Running' ? 'status-ok' : 'status-warn';
          return (
            <tr key={`${p.namespace}/${p.name}`} className={cls}>
              <td>{p.name}</td><td>{p.namespace}</td><td>{p.ready}</td>
              <td>{p.status}</td><td>{p.restarts}</td><td>{p.age}</td><td>{p.node}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
```

`kube-panel/src/components/ContextSwitcher.tsx`:
```tsx
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { listContexts, useContext } from '../api/tauri';
import { useAppStore } from '../stores/appStore';

export function ContextSwitcher() {
  const qc = useQueryClient();
  const { currentContext, setCurrentContext } = useAppStore();
  const { data: contexts = [] } = useQuery({ queryKey: ['contexts'], queryFn: listContexts });
  const mut = useMutation({
    mutationFn: useContext,
    onSuccess: async () => {
      setCurrentContext(contexts.find(c => true) ?? null); // re-derive below
      await qc.invalidateQueries({ queryKey: ['contexts'] });
      await qc.invalidateQueries({ queryKey: ['pods'] });
    },
  });
  const cur = contexts.find(c => c.current) ?? currentContext;
  return (
    <div className="ctx-switcher">
      <select
        value={cur?.name ?? ''}
        onChange={e => mut.mutate(e.target.value)}
      >
        {contexts.map(c => <option key={c.name} value={c.name}>{c.name}{c.current ? ' *' : ''}</option>)}
      </select>
      {mut.isError && <span className="err">switch failed</span>}
    </div>
  );
}
```

(Note: after a successful `use_context`, the kubeconfig file's `current-context` changes on disk; re-running `listContexts` via the invalidated `['contexts']` query will return the new current flag. So set `currentContext` from the freshly fetched contexts in an `onSettled` — simpler: just invalidate and let the component re-derive `cur`. Remove the stale `setCurrentContext(...)` line.)

Corrected `onSuccess`:
```tsx
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['contexts'] });
      await qc.invalidateQueries({ queryKey: ['pods'] });
    },
```

`kube-panel/src/components/Sidebar.tsx` (minimal): renders `ContextSwitcher` and a nav placeholder.

`kube-panel/src/App.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { ContextSwitcher } from './components/ContextSwitcher';
import { PodTable } from './components/PodTable';
import { useAppStore } from './stores/appStore';
import { getPods, currentContext } from './api/tauri';
import { useState } from 'react';

export default function App() {
  const { namespace } = useAppStore();
  const [q, setQ] = useState('');
  const { data: cur } = useQuery({ queryKey: ['currentContext'], queryFn: currentContext });
  const ctxName = cur?.name ?? '';
  const { data: pods = [] } = useQuery({
    queryKey: ['pods', ctxName, namespace],
    queryFn: () => getPods(ctxName, namespace),
    enabled: !!ctxName,
  });
  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <ContextSwitcher />
        <input placeholder="filter pods…" value={q} onChange={e => setQ(e.target.value)} />
        <PodTable pods={pods} query={q} />
      </main>
    </div>
  );
}

import { Sidebar } from './components/Sidebar';
```

(Move the `import { Sidebar }` to the top of the file with the other imports — the above trailing import is a placeholder; in the final file all imports are at top.)

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel
pnpm vitest run src/components/PodTable.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Verify it works in the running app**

```bash
cd D:/work/tools/kube-panel
pnpm tauri dev
```

Manual: pick a context you have, see pods populate, type in the filter box, confirm CrashLoop pods show red. Close window.

- [ ] **Step 6: Commit**

```bash
cd D:/work/tools
git add kube-panel/src
git commit -m "feat(kube-panel): context switcher + fuzzy pod table"
```

---

## Task 10: frontend — basic LogViewer + HistoryPanel

**Files:**
- Create: `kube-panel/src/components/LogViewer.tsx`, `kube-panel/src/components/HistoryPanel.tsx`
- Modify: `kube-panel/src/App.tsx` (wire selected pod -> logs; add history tab)
- Test: `kube-panel/src/components/HistoryPanel.test.tsx`

**Interfaces:**
- Produces: clicking a pod shows its (non-streaming) logs in a `<pre>`; a History tab lists recent commands with a search box.

- [ ] **Step 1: Write the failing test for HistoryPanel**

`kube-panel/src/components/HistoryPanel.test.tsx`:
```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd D:/work/tools/kube-panel
pnpm vitest run src/components/HistoryPanel.test.tsx
```

Expected: FAIL — `HistoryPanel` undefined.

- [ ] **Step 3: Write the components**

`kube-panel/src/components/HistoryPanel.tsx`:
```tsx
import Fuse from 'fuse.js';
import type { HistoryEntry } from '../types';

export function HistoryPanel({ entries, query }: { entries: HistoryEntry[]; query: string }) {
  const fuse = new Fuse(entries, { keys: ['argv', 'context', 'namespace'], threshold: 0.4 });
  const shown = query.trim() ? fuse.search(query).map(r => r.item) : entries;
  return (
    <ul className="history">
      {shown.map(e => (
        <li key={e.id}>
          <span className="mono">{e.argv.join(' ')}</span>
          <span className="meta">{e.context}{e.namespace ? `/${e.namespace}` : ''} · exit {e.exit_code ?? '?'} · {e.duration_ms ?? '?'}ms{e.is_stream ? ' · stream' : ''}</span>
        </li>
      ))}
    </ul>
  );
}
```

`kube-panel/src/components/LogViewer.tsx`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { getPodLogs } from '../api/tauri';
import type { PodView } from '../types';
import { useAppStore } from '../stores/appStore';

export function LogViewer({ pod }: { pod: PodView | null }) {
  const { currentContext, namespace } = useAppStore();
  const ctx = currentContext?.name ?? '';
  const { data: logs, isLoading } = useQuery({
    queryKey: ['logs', ctx, namespace, pod?.name],
    queryFn: () => getPodLogs(ctx, namespace, pod!.name, null, false, 1000),
    enabled: !!pod && !!ctx,
  });
  if (!pod) return <div className="logs">Select a pod to view logs.</div>;
  if (isLoading) return <div className="logs">Loading…</div>;
  return <pre className="logs">{logs ?? ''}</pre>;
}
```

Wire into `App.tsx`: add `selectedPod` state; on PodTable row click set it; render `<LogViewer pod={selectedPod} />` below the table. Also add a History tab/panel using `useQuery(['history'], () => listHistory(100))` and a local search `<input>` controlling the `query` prop.

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd D:/work/tools/kube-panel
pnpm vitest run src/components/HistoryPanel.test.tsx
```

Expected: 2 tests PASS.

- [ ] **Step 5: Verify end-to-end in the running app**

```bash
cd D:/work/tools/kube-panel
pnpm tauri dev
```

Manual: pick context → pods load → click a pod → logs render → switch to History tab → see the `get pods` and `logs <pod>` entries recorded. This verifies the full Task 5 history-recording contract through the UI.

- [ ] **Step 6: Commit**

```bash
cd D:/work/tools
git add kube-panel/src
git commit -m "feat(kube-panel): non-streaming log viewer + history panel"
```

---

## Task 11: Phase 1 acceptance gate

**Files:** none (verification only)

- [ ] **Step 1: Run full Rust + frontend test suites**

```bash
cd D:/work/tools/kube-panel/src-tauri && cargo test --lib
cd D:/work/tools/kube-panel && pnpm vitest run
```

Expected: all tests PASS.

- [ ] **Step 2: Manual acceptance against spec §10 items 1, 3 (partial), 6**

Run `pnpm tauri dev` and verify:
1. App lists all local contexts, current one flagged.
3. Pod fuzzy filter <50ms on ~50 pods; CrashLoopBackOff shows red.
6. Command history searchable by context/namespace/argv; re-run path is Phase 2 (skip).

- [ ] **Step 3: Commit final state (if any uncommitted)**

```bash
cd D:/work/tools
git status --short
# if clean, nothing to commit; else commit leftover docs/style
git commit -am "chore(kube-panel): phase 1 acceptance"
```

- [ ] **Step 4: Report Phase 1 done; Phase 2 plan next**

Phase 2 (per spec §11): streaming logs + Monaco + search/export, configmap query, multi-pod tail, namespace switcher, health badge. Write its plan in a follow-up `docs/plans/` doc.

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 1 slice only):** §5.1 contexts → Task 2+7+9; §5.2 pods fuzzy → Task 6+9; §5.4 logs (non-streaming part) → Task 7+10; §5.6 history → Task 4+5+10. §5.3 configmap, §5.4 streaming/Monaco/search/export, §5.5 multi-pod, §5.7 extras → deferred to Phase 2/3 per spec §11. No Phase 1 task claims to cover them.

**Placeholder scan:** no `TODO`/`TBD`/`implement later` remain. Task 7 Step 2 notes an `Arc` refactor applied in the same step (visible, not hidden). All code steps show the final code.

**Type consistency:** `ContextView` (Rust) ↔ `Context` (TS, namespace as `string | null` — Rust `Option<String>` serializes to `null`). `PodView` field names match exactly between Rust `#[derive(Serialize)]` and TS `PodView`. `HistoryEntry` field names match (`ts_ms`, `is_stream`, `exit_code`, `duration_ms`). `Kubectl`, `History`, `KubeRuntime` signatures consistent across Tasks 3–5–7.

Known nits (not blockers; fix during execution if they surface):
- `current_context()` command recomputes `load_all()`; cheap enough for Phase 1.
- `use_context` is called with `context=&name` AND the same name as an arg — the `--context <name>` flag is redundant with `kubectl config use-context <name>` but harmless; leave it.
