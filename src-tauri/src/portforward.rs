use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::process::Child;
use tokio::io::{AsyncReadExt};
use tokio::sync::oneshot;

/// A serializable snapshot of a port-forward session's state. Emitted to the
/// frontend via the `pf_status` event whenever the session's status changes.
#[derive(Clone, serde::Serialize)]
pub struct PfSessionView {
    pub id: String,
    pub context: String,
    pub namespace: String,
    pub target: String,        // "pod/foo" or "svc/bar"
    pub local_port: u16,
    pub remote_port: u16,
    pub started_at: i64,       // unix epoch ms
    pub status: String,        // "running" | "stopped" | "failed"
    pub message: String,      // exit detail (e.g. stderr tail) when failed/stopped
}

struct PfEntry {
    view: PfSessionView,
    /// Signaled by `stop()` to tell the monitor task to kill + reap the child.
    /// `None` once the monitor has taken ownership and the sender is consumed.
    stop_tx: Option<oneshot::Sender<bool>>,
    /// Set by `stop()` before signaling so the monitor knows this was a
    /// user-initiated stop (status = "stopped") vs a natural exit.
    user_stopping: bool,
}

#[derive(Clone)]
pub struct PfRegistry {
    sessions: Arc<Mutex<HashMap<String, PfEntry>>>,
}

impl PfRegistry {
    pub fn new() -> Self {
        PfRegistry { sessions: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Start monitoring a port-forward child process. The `id` is caller-
    /// supplied (so the emit closure can know it before `start` returns).
    /// The monitor task owns the `Child`: it waits for exit (or a stop
    /// signal), drains stderr into a bounded buffer for the failure message,
    /// then updates the entry's view + emits the updated `PfSessionView`.
    /// Dead entries are NOT removed — they stay in the map so `list()` shows
    /// them until the user explicitly clears them via `remove()`.
    pub fn start<F>(&self, id: String, mut child: Child, view: PfSessionView, emit: F) -> String
    where F: Fn(PfSessionView) + Send + Sync + 'static {
        let emit: Arc<F> = Arc::new(emit);

        // Take stderr pipe — the monitor drains it to capture failure messages.
        let stderr = child.stderr.take();

        // Create the stop channel. The sender goes into the entry; the receiver
        // goes into the monitor task.
        let (stop_tx, stop_rx) = oneshot::channel::<bool>();

        self.sessions.lock().unwrap().insert(id.clone(), PfEntry {
            view: view.clone(),
            stop_tx: Some(stop_tx),
            user_stopping: false,
        });

        let sessions = self.sessions.clone();
        let emit = emit.clone();
        let id_for_monitor = id.clone();
        tokio::spawn(async move {
            // Drain stderr into a bounded buffer (last ~500 bytes) so on
            // failure we have a message to show the user.
            let stderr_buf = if let Some(mut stderr) = stderr {
                let mut buf = Vec::with_capacity(512);
                let mut chunk = [0u8; 256];
                loop {
                    match stderr.read(&mut chunk).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => {
                            buf.extend_from_slice(&chunk[..n]);
                            // Keep only the last 500 bytes
                            if buf.len() > 500 {
                                let start = buf.len() - 500;
                                buf = buf[start..].to_vec();
                            }
                        }
                    }
                }
                Some(buf)
            } else {
                None
            };

            // Wait for the child to exit, or for a stop signal.
            let exit_code;
            let user_stopped;
            tokio::select! {
                r = child.wait() => {
                    exit_code = r.ok().and_then(|s| s.code()).unwrap_or(-1);
                    user_stopped = false;
                }
                _ = stop_rx => {
                    // User-initiated stop: kill + reap the child.
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    exit_code = 0;
                    user_stopped = true;
                }
            }

            // Build the updated view.
            let mut message = String::new();
            let status = if user_stopped {
                "stopped".to_string()
            } else if exit_code == 0 {
                "stopped".to_string()
            } else {
                "failed".to_string()
            };
            if exit_code != 0 {
                if let Some(buf) = &stderr_buf {
                    message = String::from_utf8_lossy(buf).into_owned();
                    // Truncate to 500 chars
                    if message.len() > 500 {
                        message.truncate(500);
                    }
                    message = message.trim().to_string();
                }
                if message.is_empty() {
                    message = format!("exited with code {}", exit_code);
                }
            }

            // Update the entry in the map. If the entry was already removed
            // (shouldn't happen — remove() only works on dead sessions), do nothing.
            let updated_view = {
                let mut map = sessions.lock().unwrap();
                if let Some(entry) = map.get_mut(&id_for_monitor) {
                    entry.view.status = status;
                    entry.view.message = message.clone();
                    entry.stop_tx = None; // consumed
                    entry.view.clone()
                } else {
                    return;
                }
            };

            // Emit the updated view to the frontend.
            emit(updated_view);
        });

        id
    }

    /// Stop a running port-forward session by id. Signals the monitor task to
    /// kill + reap the child. No-op if the session is already dead or not found.
    pub fn stop(&self, id: &str) {
        let mut map = self.sessions.lock().unwrap();
        if let Some(entry) = map.get_mut(id) {
            entry.user_stopping = true;
            if let Some(tx) = entry.stop_tx.take() {
                let _ = tx.send(true);
            }
        }
    }

    /// List all sessions (running + dead), sorted by `started_at` ascending.
    pub fn list(&self) -> Vec<PfSessionView> {
        let map = self.sessions.lock().unwrap();
        let mut views: Vec<PfSessionView> = map.values().map(|e| e.view.clone()).collect();
        views.sort_by_key(|v| v.started_at);
        views
    }

    /// Remove a DEAD session from the list (only valid if status != "running").
    /// The frontend guards this — only calls remove() for non-running sessions.
    pub fn remove(&self, id: &str) {
        let mut map = self.sessions.lock().unwrap();
        if let Some(entry) = map.get(id) {
            if entry.view.status != "running" {
                map.remove(id);
            }
        }
    }

    pub fn len(&self) -> usize { self.sessions.lock().unwrap().len() }
}

impl Default for PfRegistry {
    fn default() -> Self { Self::new() }
}

/// Generate the next port-forward session id. Public so command handlers can
/// pre-allocate an id before calling `PfRegistry::start`.
pub fn new_pf_id() -> String {
    static C: AtomicU64 = AtomicU64::new(0);
    format!("pf-{}", C.fetch_add(1, Ordering::SeqCst))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kubectl::Kubectl;
    use std::io::Write;
    use std::process::Stdio;
    use std::sync::{Arc, Mutex};
    use tokio::time::{sleep, Duration};

    /// Write a fake `.cmd` kubectl shim to the temp dir (mirrors stream.rs tests).
    fn write_fake(name_part: &str, body: &str) -> std::path::PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut p = std::env::temp_dir();
        p.push(format!("kp-pf-fake-{}-{}.cmd", n, name_part));
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(f, "@echo off").unwrap();
        writeln!(f, "{}", body).unwrap();
        p
    }

    fn make_view(id: &str) -> PfSessionView {
        PfSessionView {
            id: id.to_string(),
            context: "dev".into(),
            namespace: "default".into(),
            target: "pod/nginx".into(),
            local_port: 8080,
            remote_port: 80,
            started_at: 0,
            status: "running".into(),
            message: String::new(),
        }
    }

    #[tokio::test]
    async fn start_emits_failed_status_on_nonzero_exit() {
        // Fake kubectl that writes to stderr then exits non-zero.
        let script = write_fake("fail", "echo error: cannot bind 8080 1>&2 & exit /b 3");
        let k = Kubectl::with_binary(script.to_string_lossy().into_owned());
        let mut cmd = k.build("dev", Some("default"), &[]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child = cmd.spawn().unwrap();

        let registry = PfRegistry::new();
        let captured: Arc<Mutex<Vec<PfSessionView>>> = Arc::new(Mutex::new(vec![]));
        let cap2 = captured.clone();
        let id = registry.start("pf-test-fail".into(), child, make_view("pf-test-fail"), move |v| {
            cap2.lock().unwrap().push(v);
        });
        assert_eq!(id, "pf-test-fail");

        // Wait up to 2s for the monitor to emit a "failed" view.
        for _ in 0..40 {
            let caps = captured.lock().unwrap();
            if caps.iter().any(|v| v.status == "failed") {
                drop(caps);
                break;
            }
            drop(caps);
            sleep(Duration::from_millis(50)).await;
        }

        let caps = captured.lock().unwrap().clone();
        assert!(
            caps.iter().any(|v| v.status == "failed"),
            "expected a 'failed' view, got: {:?}", caps.iter().map(|v| &v.status).collect::<Vec<_>>()
        );

        // The entry should still be in the map (dead sessions persist until cleared).
        assert_eq!(registry.len(), 1, "dead session should persist in the map");

        std::fs::remove_file(script).ok();
    }

    #[tokio::test]
    async fn stop_emits_stopped_status() {
        // Fake kubectl that sleeps a long time (won't exit on its own).
        let script = write_fake("long", "timeout /t 60 /nobreak > nul");
        let k = Kubectl::with_binary(script.to_string_lossy().into_owned());
        let mut cmd = k.build("dev", Some("default"), &[]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child = cmd.spawn().unwrap();

        let registry = PfRegistry::new();
        let captured: Arc<Mutex<Vec<PfSessionView>>> = Arc::new(Mutex::new(vec![]));
        let cap2 = captured.clone();
        let id = registry.start("pf-test-stop".into(), child, make_view("pf-test-stop"), move |v| {
            cap2.lock().unwrap().push(v);
        });

        // The session should be running.
        assert_eq!(registry.len(), 1);
        assert_eq!(registry.list()[0].status, "running");

        // Stop it.
        registry.stop(&id);

        // Wait up to 2s for the monitor to emit a "stopped" view.
        for _ in 0..40 {
            let caps = captured.lock().unwrap();
            if caps.iter().any(|v| v.status == "stopped") {
                drop(caps);
                break;
            }
            drop(caps);
            sleep(Duration::from_millis(50)).await;
        }

        let caps = captured.lock().unwrap().clone();
        assert!(
            caps.iter().any(|v| v.status == "stopped"),
            "expected a 'stopped' view, got: {:?}", caps.iter().map(|v| &v.status).collect::<Vec<_>>()
        );

        // List should show the stopped session.
        let views = registry.list();
        assert_eq!(views.len(), 1);
        assert_eq!(views[0].status, "stopped");

        std::fs::remove_file(script).ok();
    }
}
