use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tokio::process::Child;
use tokio::io::{AsyncBufReadExt, BufReader};

#[derive(Clone)]
pub struct StreamRegistry {
    streams: Arc<Mutex<HashMap<String, Child>>>,
}

impl StreamRegistry {
    pub fn new() -> Self {
        StreamRegistry { streams: Arc::new(Mutex::new(HashMap::new())) }
    }

    /// Spawn reader tasks for `child`'s piped stdout AND stderr. Each stdout line is
    /// passed to `emit(text)`; each stderr line is passed to `emit("[stderr] " + text)`
    /// so the frontend can distinguish them. Draining stderr prevents the OS pipe
    /// buffer from filling (e.g. kubectl reconnect/timeout warnings on `logs -f`) and
    /// deadlocking the child's stdout.
    /// The `id` is caller-supplied (so the emit closure can know it before `start` returns).
    /// The child is held in the registry; `stop(id)` kills it. When the child's stdout
    /// EOFs, the stdout reader removes the entry from the registry (stderr reader only
    /// drains — it never removes, so ownership of removal stays with stdout).
    pub fn start<F>(&self, id: String, mut child: Child, emit: F) -> String
    where F: Fn(String) + Send + Sync + 'static {
        let emit: Arc<F> = Arc::new(emit);
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.streams.lock().unwrap().insert(id.clone(), child);

        // stdout reader: primary — removes the entry from the registry on EOF
        if let Some(stdout) = stdout {
            let emit = emit.clone();
            let id2 = id.clone();
            let streams = self.streams.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stdout);
                loop {
                    let mut buf = String::new();
                    match reader.read_line(&mut buf).await {
                        Ok(0) => break,          // EOF — child closed stdout
                        Ok(_) => emit(buf),
                        Err(_) => break,
                    }
                }
                streams.lock().unwrap().remove(&id2);
            });
        }

        // stderr reader: drain only (don't remove on EOF — stdout owns removal)
        if let Some(stderr) = stderr {
            let emit = emit.clone();
            tokio::spawn(async move {
                let mut reader = BufReader::new(stderr);
                loop {
                    let mut buf = String::new();
                    match reader.read_line(&mut buf).await {
                        Ok(0) => break,
                        Ok(_) => emit(format!("[stderr] {}", buf)),
                        Err(_) => break,
                    }
                }
            });
        }

        id
    }

    pub fn stop(&self, id: &str) {
        if let Some(mut child) = self.streams.lock().unwrap().remove(id) {
            let _ = child.start_kill(); // signal kill; reaping happens via the reader task EOF
        }
    }

    pub fn len(&self) -> usize { self.streams.lock().unwrap().len() }
}

/// Generate the next stream id. Public so command handlers can pre-allocate an id
/// before calling `StreamRegistry::start`, letting the emit closure capture it.
pub fn new_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static C: AtomicU64 = AtomicU64::new(0);
    format!("s-{}", C.fetch_add(1, Ordering::SeqCst))
}

impl Default for StreamRegistry {
    fn default() -> Self { Self::new() }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::kubectl::Kubectl;
    use std::io::Write;
    use std::process::Stdio;
    use std::sync::{Arc, Mutex};
    use tokio::time::{sleep, Duration};

    fn write_fake(name_part: &str, body: &str) -> std::path::PathBuf {
        static N: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        let mut p = std::env::temp_dir();
        p.push(format!("kp-stream-fake-{}-{}.cmd", n, name_part));
        let mut f = std::fs::File::create(&p).unwrap();
        writeln!(f, "@echo off").unwrap();
        writeln!(f, "{}", body).unwrap();
        p
    }

    #[tokio::test]
    async fn start_emits_lines_and_stop_removes_entry() {
        // fake kubectl echoes two lines then exits 0
        let script = write_fake("two", "echo line1\necho line2");
        let k = Kubectl::with_binary(script.to_string_lossy().into_owned());
        let mut cmd = k.build("dev", None, &[]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child = cmd.spawn().unwrap();
        let registry = StreamRegistry::new();
        let captured: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let cap2 = captured.clone();
        let id = registry.start("s-test".into(), child, move |text| { cap2.lock().unwrap().push(text); });
        assert_eq!(id, "s-test");
        // wait for the 2 lines to flush (child exits 0 quickly)
        for _ in 0..40 {
            if captured.lock().unwrap().len() >= 2 { break; }
            sleep(Duration::from_millis(50)).await;
        }
        let lines = captured.lock().unwrap().clone();
        assert!(lines.iter().any(|l| l.contains("line1")), "got {:?}", lines);
        assert!(lines.iter().any(|l| l.contains("line2")), "got {:?}", lines);
        // after EOF, the reader removes the entry
        for _ in 0..40 {
            if registry.len() == 0 { break; }
            sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(registry.len(), 0, "stream not removed after EOF");
        std::fs::remove_file(script).ok();
    }

    #[tokio::test]
    async fn stop_kills_a_long_running_stream() {
        // fake kubectl that sleeps a long time (won't EOF on its own)
        let script = write_fake("long", "timeout /t 60 /nobreak > nul");
        let k = Kubectl::with_binary(script.to_string_lossy().into_owned());
        let mut cmd = k.build("dev", None, &[]);
        cmd.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child = cmd.spawn().unwrap();
        let registry = StreamRegistry::new();
        let id = registry.start("s-long".into(), child, |_text| {});
        assert_eq!(registry.len(), 1);
        registry.stop(&id);
        // stop() removes synchronously
        assert_eq!(registry.len(), 0);
        std::fs::remove_file(script).ok();
    }
}
