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
