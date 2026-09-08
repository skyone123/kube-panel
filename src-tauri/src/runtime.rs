use std::time::Instant;
use crate::history::{History, HistoryEntry};
use crate::kubectl::{Kubectl, RunResult};

pub struct KubeRuntime {
    kubectl: Kubectl,
    history: History,
}

impl KubeRuntime {
    pub fn new(kubectl: Kubectl, history: History) -> Self {
        KubeRuntime { kubectl, history }
    }

    /// Test-only accessor: read back recorded history rows so tests can assert
    /// what `run()` actually persisted, without re-opening the DB file.
    #[cfg(test)]
    pub fn history_list(&self) -> Vec<HistoryEntry> {
        self.history.list(100)
            .expect("history_list: list() failed")
    }

    /// Build a streaming `tokio::process::Command` without running it. Additive
    /// passthrough so command handlers can spawn long-lived children (`kubectl
    /// logs -f`) without going through one-shot `run()`.
    pub fn build_cmd(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> tokio::process::Command {
        self.kubectl.build(context, namespace, args)
    }

    pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult> {
        self.run_inner(context, namespace, args, true).await
    }

    /// Like `run` but does NOT record a history row. Used by high-frequency,
    /// read-only list/poll queries (5s auto-refresh) where every call would
    /// otherwise flood `history.db` — and the history panel — with `get pods`-
    /// style noise that nobody re-runs.
    pub async fn run_no_history(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult> {
        self.run_inner(context, namespace, args, false).await
    }

    async fn run_inner(&self, context: &str, namespace: Option<&str>, args: &[&str], record_history: bool) -> std::io::Result<RunResult> {
        let start = Instant::now();
        let res = self.kubectl.run(context, namespace, args).await;
        if record_history {
            let duration_ms = start.elapsed().as_millis() as i64;
            let exit_code = match &res {
                Ok(r) => Some(r.exit_code),
                Err(_) => None,
            };
            let entry = build_history_entry(context, namespace, args, exit_code, duration_ms, false);
            // history write must not mask the original result
            if let Err(e) = self.history.insert(&entry) {
                eprintln!("[kube-panel] history insert failed: {e}");
            }
        }
        res
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
        argv: sanitize_argv(args),
        exit_code,
        duration_ms: Some(duration_ms),
        is_stream,
        favorite: false,
    }
}

/// Redact secrets that would otherwise be persisted verbatim into history.db.
/// Values following a known credential flag (as the next arg like `--token x`,
/// as `--flag=value`, or a kubeconfig-snippet) are replaced with `***`.
/// Conservative: only well-known secret-ish flags are matched so we don't
/// accidentally mangle ordinary args (pod names, ports, numbers…).
const SECRET_FLAGS: &[&str] = &["--password", "--token", "--client-secret", "--from-literal", "--secret"];

fn sanitize_argv(args: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(args.len());
    let mut i = 0;
    while i < args.len() {
        let a = args[i];
        // "inject" the value into the current output position
        let mut emit = |value: &str| out.push(value.to_string());
        if a == "--from-literal" {
            // kubectl create secret generic --from-literal=KEY=value : redact whole literal
            if args.len() > i + 1 {
                emit("--from-literal=***");
                i += 2;
            } else {
                emit(a);
                i += 1;
            }
            continue;
        }
        if SECRET_FLAGS.contains(&a) {
            out.push(a.to_string());
            if args.len() > i + 1 {
                out.push("***".into());
                i += 2;
            } else {
                i += 1;
            }
            continue;
        }
        // --token=abc / --password=xyz (inline form)
        if let Some((k, _)) = a.split_once('=') {
            if SECRET_FLAGS.contains(&k) {
                emit(&format!("{k}=***"));
                i += 1;
                continue;
            }
        }
        emit(a);
        i += 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kubectl::Kubectl;
    use std::io::Write;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Write a fake `.cmd` kubectl shim to the temp dir and return its full path.
    /// Each call gets a unique filename (atomic counter) so parallel tests don't collide.
    fn write_fake_kubectl(name_part: &str, lines: &[&str]) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        let mut path = std::env::temp_dir();
        path.push(format!("kp-fake-kubectl-{}-{}.cmd", n, name_part));
        let mut f = std::fs::File::create(&path).unwrap();
        writeln!(f, "@echo off").unwrap();
        for line in lines {
            writeln!(f, "{}", line).unwrap();
        }
        path
    }

    fn tmp_db(name_part: &str) -> PathBuf {
        static N: AtomicUsize = AtomicUsize::new(0);
        let n = N.fetch_add(1, Ordering::SeqCst);
        std::env::temp_dir().join(format!(
            "kp-rt-{}-{}-{}.db",
            std::process::id(),
            n,
            name_part
        ))
    }

    /// (a) Successful kubectl call: history row recorded with exit_code = Some(0),
    /// argv / context / namespace verbatim.
    #[tokio::test]
    async fn run_inserts_history_on_success() {
        let script = write_fake_kubectl("ok", &["echo hello"]);
        let hist_path = tmp_db("ok");
        let history = History::open(Some(&hist_path)).unwrap();
        let rt = KubeRuntime::new(
            Kubectl::with_binary(script.to_string_lossy().into_owned()),
            history,
        );

        let res = rt.run("dev", Some("default"), &["logs", "nginx"]).await.unwrap();
        assert_eq!(res.exit_code, 0);
        assert!(res.stdout.contains("hello"), "stdout should contain hello, got: {}", res.stdout);

        let rows = rt.history_list();
        assert_eq!(rows.len(), 1, "exactly one history row");
        assert_eq!(rows[0].context, "dev");
        assert_eq!(rows[0].namespace.as_deref(), Some("default"));
        assert_eq!(rows[0].argv, vec!["logs", "nginx"]);
        assert_eq!(rows[0].exit_code, Some(0));
        assert_eq!(rows[0].is_stream, false);

        std::fs::remove_file(&script).ok();
        std::fs::remove_file(&hist_path).ok();
    }

    /// (b) Failing kubectl call (non-zero exit): history row STILL recorded with
    /// exit_code = Some(<code>), argv intact, and run() returns Ok(RunResult).
    #[tokio::test]
    async fn run_inserts_history_on_nonzero_exit() {
        let script = write_fake_kubectl("fail", &["echo boom", "exit /b 7"]);
        let hist_path = tmp_db("fail");
        let history = History::open(Some(&hist_path)).unwrap();
        let rt = KubeRuntime::new(
            Kubectl::with_binary(script.to_string_lossy().into_owned()),
            history,
        );

        // kubectl ran and exited 7 — run() returns Ok, not Err
        let res = rt.run("prod", None, &["get", "pods"]).await.unwrap();
        assert_eq!(res.exit_code, 7);
        assert!(res.stdout.contains("boom"), "stdout should contain boom, got: {}", res.stdout);

        let rows = rt.history_list();
        assert_eq!(rows.len(), 1, "exactly one history row even on failure");
        assert_eq!(rows[0].context, "prod");
        assert_eq!(rows[0].namespace, None);
        assert_eq!(rows[0].argv, vec!["get", "pods"]);
        assert_eq!(rows[0].exit_code, Some(7));
        assert_eq!(rows[0].is_stream, false);

        std::fs::remove_file(&script).ok();
        std::fs::remove_file(&hist_path).ok();
    }

    /// (c) Spawn-error path: binary doesn't exist, run() returns Err, but a history
    /// row is STILL inserted with exit_code = None.
    #[tokio::test]
    async fn run_inserts_history_on_spawn_error() {
        let bogus = PathBuf::from("C:/nonexistent/kp-no-such-binary-xyz.exe");
        let hist_path = tmp_db("spawn");
        let history = History::open(Some(&hist_path)).unwrap();
        let rt = KubeRuntime::new(
            Kubectl::with_binary(bogus.to_string_lossy().into_owned()),
            history,
        );

        let res = rt.run("ctx", Some("ns"), &["version"]).await;
        assert!(res.is_err(), "spawn should fail for nonexistent binary");

        let rows = rt.history_list();
        assert_eq!(rows.len(), 1, "history row recorded even on spawn error");
        assert_eq!(rows[0].context, "ctx");
        assert_eq!(rows[0].namespace.as_deref(), Some("ns"));
        assert_eq!(rows[0].argv, vec!["version"]);
        assert_eq!(rows[0].exit_code, None, "exit_code should be None on spawn error");
        assert_eq!(rows[0].is_stream, false);

        std::fs::remove_file(&hist_path).ok();
    }

    /// (d) run_no_history must NOT write a history row — used by 5s auto-refresh
    /// list queries so `history.db` and the panel aren't flooded with `get pods`.
    #[tokio::test]
    async fn run_no_history_skips_history() {
        let script = write_fake_kubectl("nohist", &["echo hi"]);
        let hist_path = tmp_db("nohist");
        let history = History::open(Some(&hist_path)).unwrap();
        let rt = KubeRuntime::new(
            Kubectl::with_binary(script.to_string_lossy().into_owned()),
            history,
        );

        let res = rt.run_no_history("dev", Some("default"), &["get", "pods"]).await.unwrap();
        assert_eq!(res.exit_code, 0);
        assert!(res.stdout.contains("hi"), "stdout should contain hi, got: {}", res.stdout);

        let rows = rt.history_list();
        assert_eq!(rows.len(), 0, "run_no_history must not write a history row");

        std::fs::remove_file(&script).ok();
        std::fs::remove_file(&hist_path).ok();
    }

    /// (e) verifies creds in recorded argv never land in history verbatim.
    #[test]
    fn sanitize_argv_redacts_credentials() {
        // Inline --flag=value forms
        assert_eq!(
            sanitize_argv(&["get", "pods", "--token=abc", "-o", "json"]),
            vec!["get", "pods", "--token=***", "-o", "json"]
        );
        assert_eq!(
            sanitize_argv(&["auth", "login", "--password=supersecret"]),
            vec!["auth", "login", "--password=***"]
        );
        // Standalone --flag with separate value arg
        assert_eq!(
            sanitize_argv(&["auth", "login", "--token", "abc123"]),
            vec!["auth", "login", "--token", "***"]
        );
        // --from-literal=KEY=value collapses the whole literal
        assert_eq!(
            sanitize_argv(&["create", "secret", "generic", "--from-literal=a=b"]),
            vec!["create", "secret", "generic", "--from-literal=***"]
        );
        // Ordinary args (pod names, ports, numbers) stay intact
        assert_eq!(
            sanitize_argv(&["logs", "-f", "nginx", "-c", "main", "--tail=100"]),
            vec!["logs", "-f", "nginx", "-c", "main", "--tail=100"]
        );
    }
}
