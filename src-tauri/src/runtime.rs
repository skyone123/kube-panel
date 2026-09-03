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

    pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult> {
        let start = Instant::now();
        let res = self.kubectl.run(context, namespace, args).await;
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
        argv: args.iter().map(|s| s.to_string()).collect(),
        exit_code,
        duration_ms: Some(duration_ms),
        is_stream,
        favorite: false,
    }
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
        let history = History::open(&hist_path).unwrap();
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
        let history = History::open(&hist_path).unwrap();
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
        let history = History::open(&hist_path).unwrap();
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
}
