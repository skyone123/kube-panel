use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicUsize, Ordering};
use tokio::process::Child;
use tokio::io::{AsyncBufReadExt, BufReader};

/// A stream entry holds either a single child process or multiple children
/// (multi-pod merged tail). Both variants are killed on `stop`.
pub enum StreamHandle {
    Single(Child),
    Multi(Vec<Child>),
}

#[derive(Clone)]
pub struct StreamRegistry {
    streams: Arc<Mutex<HashMap<String, StreamHandle>>>,
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
    /// drains — it never removes, so ownership of removal stays with stdout) and calls
    /// `on_end(id)` exactly once so the frontend learns the stream really died.
    pub fn start<F, E>(&self, id: String, mut child: Child, emit: F, on_end: E) -> String
    where F: Fn(String) + Send + Sync + 'static,
          E: FnOnce(String) + Send + 'static {
        let emit: Arc<F> = Arc::new(emit);
        let on_end: Arc<Mutex<Option<E>>> = Arc::new(Mutex::new(Some(on_end)));
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        self.streams.lock().unwrap().insert(id.clone(), StreamHandle::Single(child));

        // stdout reader: primary — removes the entry from the registry on EOF
        if let Some(stdout) = stdout {
            let emit = emit.clone();
            let id2 = id.clone();
            let streams = self.streams.clone();
            let on_end = on_end.clone();
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
                if let Some(cb) = on_end.lock().unwrap().take() {
                    cb(id2);
                }
            });
        } else {
            // No stdout pipe was set up — nothing will ever EOF the reader, so
            // treat the stream as already dead and fire on_end immediately.
            self.streams.lock().unwrap().remove(&id);
            if let Some(cb) = on_end.lock().unwrap().take() {
                cb(id.clone());
            }
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

    /// Spawn reader tasks for multiple child processes (multi-pod merged tail).
    /// Each child's stdout lines are prefixed with `prefix` before being emitted;
    /// stderr lines get `[stderr] ` inserted after the prefix. Multi-stream readers
    /// do NOT remove the entry on EOF (other children may still stream) — the
    /// entry is removed only by `stop()`. When ALL readers (stdout + stderr of
    /// every child) have EOFed, `on_end(id)` is fired exactly once.
    pub fn start_multi<F, E>(&self, id: String, children: Vec<(String, Child)>, emit: F, on_end: E) -> String
    where F: Fn(String) + Send + Sync + 'static,
          E: FnOnce(String) + Send + 'static {
        let emit: Arc<F> = Arc::new(emit);
        let on_end: Arc<Mutex<Option<E>>> = Arc::new(Mutex::new(Some(on_end)));
        let done = Arc::new(AtomicUsize::new(0));

        let mut drained: Vec<Child> = Vec::with_capacity(children.len());
        let mut readers: Vec<(Arc<str>, Option<tokio::process::ChildStdout>, Option<tokio::process::ChildStderr>)> =
            Vec::with_capacity(children.len());
        for (prefix, mut child) in children {
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            drained.push(child);
            readers.push((Arc::from(prefix.as_str()), stdout, stderr));
        }
        let total_readers: usize = readers
            .iter()
            .map(|(_, o, e)| usize::from(o.is_some()) + usize::from(e.is_some()))
            .sum();

        let fire_end_on_end = on_end.clone();
        let fire_end = move |sid: String| {
            if let Some(cb) = fire_end_on_end.lock().unwrap().take() {
                cb(sid);
            }
        };

        for (prefix, stdout, stderr) in readers {
            if let Some(stdout) = stdout {
                let emit = emit.clone();
                let prefix = prefix.clone();
                let done = done.clone();
                let id2 = id.clone();
                let on_end = on_end.clone();
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stdout);
                    loop {
                        let mut buf = String::new();
                        match reader.read_line(&mut buf).await {
                            Ok(0) => break,
                            Ok(_) => emit(format!("{}{}", prefix, buf)),
                            Err(_) => break,
                        }
                    }
                    if done.fetch_add(1, Ordering::SeqCst) + 1 >= total_readers {
                        if let Some(cb) = on_end.lock().unwrap().take() {
                            cb(id2);
                        }
                    }
                });
            }
            if let Some(stderr) = stderr {
                let emit = emit.clone();
                let prefix = prefix.clone();
                let done = done.clone();
                let id2 = id.clone();
                let on_end = on_end.clone();
                tokio::spawn(async move {
                    let mut reader = BufReader::new(stderr);
                    loop {
                        let mut buf = String::new();
                        match reader.read_line(&mut buf).await {
                            Ok(0) => break,
                            Ok(_) => emit(format!("{}[stderr] {}", prefix, buf)),
                            Err(_) => break,
                        }
                    }
                    if done.fetch_add(1, Ordering::SeqCst) + 1 >= total_readers {
                        if let Some(cb) = on_end.lock().unwrap().take() {
                            cb(id2);
                        }
                    }
                });
            }
        }

        self.streams.lock().unwrap().insert(id.clone(), StreamHandle::Multi(drained));

        // Defensive: no readers at all ⇒ no child will ever signal the end.
        if total_readers == 0 {
            fire_end(id.clone());
        }

        id
    }

    pub fn stop(&self, id: &str) {
        if let Some(handle) = self.streams.lock().unwrap().remove(id) {
            match handle {
                StreamHandle::Single(mut child) => {
                    let _ = child.start_kill();
                }
                StreamHandle::Multi(children) => {
                    for mut child in children {
                        let _ = child.start_kill();
                    }
                }
            }
        }
    }

    /// Kill every running child stream. Called on app exit so `kubectl
    /// logs -f` processes can't linger after the window closes.
    pub fn stop_all(&self) {
        let mut map = self.streams.lock().unwrap();
        let ids: Vec<String> = map.keys().cloned().collect();
        for id in ids {
            if let Some(handle) = map.remove(&id) {
                match handle {
                    StreamHandle::Single(mut child) => {
                        let _ = child.start_kill();
                    }
                    StreamHandle::Multi(children) => {
                        for mut child in children {
                            let _ = child.start_kill();
                        }
                    }
                }
            }
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
        let ended: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let end2 = ended.clone();
        let id = registry.start("s-test".into(), child, move |text| { cap2.lock().unwrap().push(text); }, move |sid| { end2.lock().unwrap().push(sid); });
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
        // on_end fires exactly once with the stream id
        for _ in 0..40 {
            if !ended.lock().unwrap().is_empty() { break; }
            sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(ended.lock().unwrap().clone(), vec!["s-test".to_string()], "on_end should fire once with the id");
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
        let id = registry.start("s-long".into(), child, |_text| {}, |_sid| {});
        assert_eq!(registry.len(), 1);
        registry.stop(&id);
        // stop() removes synchronously
        assert_eq!(registry.len(), 0);
        std::fs::remove_file(script).ok();
    }

    #[tokio::test]
    async fn start_multi_emits_prefixed_lines_and_stop_kills_all() {
        // Two fake kubectl scripts: each echoes a distinct line then exits.
        let script1 = write_fake("multi1", "echo pod1-line");
        let script2 = write_fake("multi2", "echo pod2-line");
        let k1 = Kubectl::with_binary(script1.to_string_lossy().into_owned());
        let k2 = Kubectl::with_binary(script2.to_string_lossy().into_owned());
        let mut cmd1 = k1.build("dev", None, &[]);
        cmd1.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child1 = cmd1.spawn().unwrap();
        let mut cmd2 = k2.build("dev", None, &[]);
        cmd2.stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let child2 = cmd2.spawn().unwrap();

        let registry = StreamRegistry::new();
        let captured: Arc<Mutex<Vec<String>>> = Arc::new(Mutex::new(vec![]));
        let cap2 = captured.clone();
        let ended: Arc<Mutex<Option<String>>> = Arc::new(Mutex::new(None));
        let end2 = ended.clone();
        registry.start_multi(
            "m-test".into(),
            vec![
                ("[pod1] ".into(), child1),
                ("[pod2] ".into(), child2),
            ],
            move |text| { cap2.lock().unwrap().push(text); },
            move |sid| { *end2.lock().unwrap() = Some(sid); },
        );

        // Wait up to 2s for both prefixed lines to arrive.
        for _ in 0..40 {
            let caps = captured.lock().unwrap();
            let has1 = caps.iter().any(|l| l.contains("[pod1] pod1-line"));
            let has2 = caps.iter().any(|l| l.contains("[pod2] pod2-line"));
            drop(caps);
            if has1 && has2 { break; }
            sleep(Duration::from_millis(50)).await;
        }
        let lines = captured.lock().unwrap().clone();
        assert!(lines.iter().any(|l| l.contains("[pod1] pod1-line")), "missing pod1 line, got {:?}", lines);
        assert!(lines.iter().any(|l| l.contains("[pod2] pod2-line")), "missing pod2 line, got {:?}", lines);

        // One Multi entry registered (not removed by EOF — only stop removes it).
        assert_eq!(registry.len(), 1, "multi entry should still be registered after both children EOF");
        // on_end should still fire once all readers EOF.
        for _ in 0..40 {
            if ended.lock().unwrap().is_some() { break; }
            sleep(Duration::from_millis(50)).await;
        }
        assert_eq!(ended.lock().unwrap().as_deref(), Some("m-test"), "on_end should fire with the merge id");
        registry.stop("m-test");
        assert_eq!(registry.len(), 0, "stop should remove the multi entry");

        std::fs::remove_file(script1).ok();
        std::fs::remove_file(script2).ok();
    }
}
