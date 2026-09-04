use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{AppHandle, Emitter};

/// A chunk of PTY output pushed to the frontend via the `pty_data` event.
#[derive(serde::Serialize, Clone)]
pub struct PtyData {
    pub id: String,
    pub data: String,
}

/// Emitted once when the PTY child exits, via the `pty_exit` event.
/// `code` is `None` if the exit code could not be determined (e.g. killed).
#[derive(serde::Serialize, Clone)]
pub struct PtyExit {
    pub id: String,
    pub code: Option<i32>,
}

struct ExecSession {
    master: Box<dyn portable_pty::MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Clone)]
pub struct ExecRegistry {
    sessions: Arc<Mutex<HashMap<String, ExecSession>>>,
}

impl ExecRegistry {
    pub fn new() -> Self {
        ExecRegistry { sessions: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Validate inputs before any PTY is opened. Returns `Ok(())` on success.
    /// Extracted so unit tests can exercise the guard without spawning a real PTY.
    fn validate(pod: &str, container: &str, command: &[String]) -> Result<(), String> {
        if pod.is_empty() {
            return Err("pod name is required".into());
        }
        if container.is_empty() {
            return Err("container name is required".into());
        }
        if command.is_empty() {
            return Err("command must not be empty".into());
        }
        Ok(())
    }

    /// Start a `kubectl exec -it` session. Spawns the child in a PTY, then a
    /// reader thread that emits `pty_data` events. When the PTY EOFs (child
    /// exits or is killed), the reader emits `pty_exit` and removes the session.
    ///
    /// The kubectl argv is built from discrete elements — NO shell string.
    /// `--context` / `-n` / `--kubeconfig` follow the same rules as `Kubectl::build`.
    pub fn start(
        &self,
        app: AppHandle,
        context: &str,
        namespace: &str,
        pod: &str,
        container: &str,
        command: Vec<String>,
    ) -> Result<String, String> {
        Self::validate(pod, container, &command)?;

        let id = new_exec_id();

        // Build the kubectl argv. Each element is a discrete argv — no shell.
        let mut argv: Vec<String> = vec![
            "exec".into(), "-it".into(), pod.into(), "-c".into(), container.into(), "--".into(),
        ];
        argv.extend(command);
        let arg_refs: Vec<&str> = argv.iter().map(|s| s.as_str()).collect();

        // Build the CommandBuilder with the same context/namespace/kubeconfig
        // rules as Kubectl::build (reuse the KUBECONFIG env agreement).
        let mut cmd = portable_pty::CommandBuilder::new("kubectl");
        let kubeconfig_override = if std::env::var("KUBECONFIG")
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false)
        {
            None // kubectl reads KUBECONFIG itself; do not pass --kubeconfig
        } else if let Some(home) = dirs::home_dir() {
            Some(home.join(".kube").join("config"))
        } else {
            None
        };
        if let Some(p) = &kubeconfig_override {
            cmd.arg("--kubeconfig");
            cmd.arg(p);
        }
        cmd.arg("--context");
        cmd.arg(context);
        if !namespace.is_empty() {
            cmd.arg("-n");
            cmd.arg(namespace);
        }
        cmd.args(&arg_refs);

        // Open a PTY pair.
        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system
            .openpty(portable_pty::PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("openpty failed: {e}"))?;

        // Spawn the child in the slave PTY.
        let child = pair.slave
            .spawn_command(cmd)
            .map_err(|e| format!("spawn_command failed: {e}"))?;

        // Drop the slave handle — the master holds the reference per portable-pty docs.
        drop(pair.slave);

        // try_clone_reader can be called multiple times; take_writer only once.
        let mut reader = pair.master
            .try_clone_reader()
            .map_err(|e| format!("try_clone_reader failed: {e}"))?;
        let writer = pair.master
            .take_writer()
            .map_err(|e| format!("take_writer failed: {e}"))?;

        let session = ExecSession {
            master: pair.master,
            writer,
            child,
        };

        // Store the session BEFORE spawning the reader so stop() can find it.
        self.sessions.lock().unwrap().insert(id.clone(), session);

        // Spawn a reader thread (std::thread, NOT tokio — the PTY reader blocks).
        let sessions = self.sessions.clone();
        let id_for_reader = id.clone();
        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF — child closed the PTY
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app.emit(
                            "pty_data",
                            PtyData { id: id_for_reader.clone(), data },
                        );
                    }
                    Err(_) => break,
                }
            }

            // PTY reader EOFed → the child has exited (or been killed).
            // Wait on the child to get exit status, then emit pty_exit + remove.
            let exit_code = {
                let mut map = sessions.lock().unwrap();
                match map.remove(&id_for_reader) {
                    Some(mut session) => {
                        // child.wait() is blocking but the child has already
                        // exited (PTY closed) so it returns immediately.
                        match session.child.wait() {
                            Ok(status) => Some(status.exit_code() as i32),
                            Err(_) => None,
                        }
                    }
                    None => return, // already removed by stop()
                }
            };

            let _ = app.emit(
                "pty_exit",
                PtyExit { id: id_for_reader, code: exit_code },
            );
        });

        Ok(id)
    }

    /// Send user keystrokes to the PTY writer.
    pub fn send_input(&self, id: &str, data: &str) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        match map.get_mut(id) {
            Some(session) => {
                session.writer
                    .write_all(data.as_bytes())
                    .map_err(|e| format!("write failed: {e}"))?;
                session.writer
                    .flush()
                    .map_err(|e| format!("flush failed: {e}"))?;
                Ok(())
            }
            None => Err(format!("exec session not found: {id}")),
        }
    }

    /// Resize the PTY to the given cols/rows.
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let mut map = self.sessions.lock().unwrap();
        match map.get_mut(id) {
            Some(session) => {
                session
                    .master
                    .resize(portable_pty::PtySize {
                        rows,
                        cols,
                        pixel_width: 0,
                        pixel_height: 0,
                    })
                    .map_err(|e| format!("resize failed: {e}"))
            }
            None => Err(format!("exec session not found: {id}")),
        }
    }

    /// Stop a session by id: kill the child + drop the master. This closes the
    /// PTY reader → the reader thread EOFs and exits cleanly. No-op if the
    /// session is already gone (e.g. child exited naturally and reader removed it).
    pub fn stop(&self, id: &str) -> Result<(), String> {
        if let Some(mut session) = self.sessions.lock().unwrap().remove(id) {
            let _ = session.child.kill();
            drop(session.master); // drop master → reader EOFs
        }
        Ok(())
    }

    /// Kill all sessions. Called on app exit.
    pub fn stop_all(&self) {
        let mut map = self.sessions.lock().unwrap();
        let ids: Vec<String> = map.keys().cloned().collect();
        for id in ids {
            if let Some(mut session) = map.remove(&id) {
                let _ = session.child.kill();
                drop(session.master);
            }
        }
    }

    pub fn len(&self) -> usize { self.sessions.lock().unwrap().len() }
}

impl Default for ExecRegistry {
    fn default() -> Self { Self::new() }
}

/// Generate the next exec session id (no new dep — uses an AtomicU64 counter).
pub fn new_exec_id() -> String {
    static C: AtomicU64 = AtomicU64::new(0);
    format!("exec-{}", C.fetch_add(1, Ordering::SeqCst))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validate_rejects_empty_command() {
        let err = ExecRegistry::validate("mypod", "mycontainer", &[]).unwrap_err();
        assert!(err.contains("command"), "expected command error, got: {err}");
    }

    #[test]
    fn validate_rejects_empty_pod() {
        let err = ExecRegistry::validate("", "mycontainer", &["sh".into()]).unwrap_err();
        assert!(err.contains("pod"), "expected pod error, got: {err}");
    }

    #[test]
    fn validate_rejects_empty_container() {
        let err = ExecRegistry::validate("mypod", "", &["sh".into()]).unwrap_err();
        assert!(err.contains("container"), "expected container error, got: {err}");
    }

    #[test]
    fn validate_accepts_valid_inputs() {
        assert!(ExecRegistry::validate("pod", "c", &["sh".into()]).is_ok());
    }

    #[test]
    fn stop_unknown_id_is_ok() {
        let registry = ExecRegistry::new();
        // stop on a non-existent id should return Ok (no panic, no deadlock)
        let result = registry.stop("nope");
        assert!(result.is_ok(), "stop on unknown id should be Ok");
        assert_eq!(registry.len(), 0);
    }

    #[test]
    fn send_input_unknown_id_returns_error() {
        let registry = ExecRegistry::new();
        let result = registry.send_input("nope", "data");
        assert!(result.is_err(), "send_input on unknown id should error");
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn resize_unknown_id_returns_error() {
        let registry = ExecRegistry::new();
        let result = registry.resize("nope", 80, 24);
        assert!(result.is_err(), "resize on unknown id should error");
        assert!(result.unwrap_err().contains("not found"));
    }

    #[test]
    fn new_exec_id_increments() {
        let a = new_exec_id();
        let b = new_exec_id();
        assert_ne!(a, b, "consecutive ids should differ");
        assert!(a.starts_with("exec-"));
        assert!(b.starts_with("exec-"));
    }

    #[test]
    fn stop_all_on_empty_registry_is_ok() {
        let registry = ExecRegistry::new();
        registry.stop_all();
        assert_eq!(registry.len(), 0);
    }
}
