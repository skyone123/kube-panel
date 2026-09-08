use std::path::PathBuf;
use std::time::Duration;
use tokio::io::AsyncReadExt;
use tokio::process::Command;

pub struct RunResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Hard cap on every one-shot kubectl call. kubectl normally touches the API
/// server; if it hangs (wrong kubeconfig, unreachable apiserver, stuck cert
/// prompt) `.output().await` would hang forever and, with the 5s auto-refresh
/// polling everything, orphan kubectl processes would pile up. A timeout kills
/// the child and surfaces a clear error instead.
const RUN_TIMEOUT: Duration = Duration::from_secs(60);

pub struct Kubectl {
    binary: String,
    kubeconfig_override: Option<PathBuf>,
}

impl Kubectl {
    pub fn from_env() -> Self {
        let override_path = if std::env::var("KUBECONFIG").map(|v| !v.trim().is_empty()).unwrap_or(false) {
            None // kubectl reads KUBECONFIG itself; do not pass --kubeconfig
        } else if let Some(home) = dirs::home_dir() {
            Some(home.join(".kube").join("config"))
        } else {
            None
        };
        Kubectl { binary: "kubectl".into(), kubeconfig_override: override_path }
    }

    /// Test-only constructor that points at an arbitrary binary path so unit
    /// tests can drive `run()` through a fake kubectl script without mutating
    /// the process PATH (which would race with parallel tests).
    #[cfg(test)]
    pub fn with_binary(name: String) -> Self {
        Kubectl { binary: name, kubeconfig_override: None }
    }

    pub fn build(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> Command {
        let mut cmd = Command::new(&self.binary);
        if let Some(p) = &self.kubeconfig_override {
            cmd.arg("--kubeconfig").arg(p);
        }
        cmd.arg("--context").arg(context);
        if let Some(ns) = namespace {
            cmd.arg("-n").arg(ns);
        }
        cmd.args(args);
        #[cfg(windows)]
        {
            // Spawn console children (kubectl.exe) without creating a new
            // console window. The packaged app is a GUI exe with no console,
            // so without CREATE_NO_WINDOW every kubectl call flashes a black
            // terminal box (auto-refresh every 5s makes it a constant rain).
            cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        cmd
    }

    pub async fn run(&self, context: &str, namespace: Option<&str>, args: &[&str]) -> std::io::Result<RunResult> {
        let mut cmd = self.build(context, namespace, args);
        // kill on drop so children don't leak if the caller future is cancelled
        cmd.kill_on_drop(true);
        run_cmd_with_timeout(cmd, RUN_TIMEOUT).await
    }
}

/// One-shot execution: spawn, read stdout/stderr in bounded buffers, wait with
/// a timeout, and KILL the child on timeout so a hung kubectl can't pile up.
/// Returns a parsed RunResult.
pub async fn run_cmd_with_timeout(mut cmd: Command, timeout: Duration) -> std::io::Result<RunResult> {
    // Cap captured output: a pathological `-o json` or unfollowed `logs` on a
    // chatty pod can return far more than we ever render, and buffering it all
    // would balloon memory. We keep only the first 8 MiB of each stream.
    const MAX_CAPTURE: usize = 8 * 1024 * 1024;

    // Pipe stdout/stderr explicitly (like Command::output does) so the reader
    // tasks own the handles and nothing leaks to the parent's console.
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn()?;

    // Take the pipes BEFORE spawning the readers so the reader tasks own them;
    // `wait_with_output()` can't be used here because it consumes `child` and
    // would make the timeout branch unable to `kill()`.
    let stdout_pipe = child.stdout.take();
    let stderr_pipe = child.stderr.take();

    async fn drain(pipe: Option<tokio::process::ChildStdout>) -> Vec<u8> {
        let Some(mut r) = pipe else { return Vec::new(); };
        let mut buf = Vec::new();
        let mut tmp = vec![0u8; 32 * 1024];
        loop {
            let n = r.read(&mut tmp).await.unwrap_or(0);
            if n == 0 { break; }
            if buf.len() >= MAX_CAPTURE { continue; }
            let room = MAX_CAPTURE - buf.len();
            buf.extend_from_slice(&tmp[..n.min(room)]);
        }
        buf
    }
    async fn drain_err(pipe: Option<tokio::process::ChildStderr>) -> Vec<u8> {
        let Some(mut r) = pipe else { return Vec::new(); };
        let mut buf = Vec::new();
        let mut tmp = vec![0u8; 32 * 1024];
        loop {
            let n = r.read(&mut tmp).await.unwrap_or(0);
            if n == 0 { break; }
            if buf.len() >= MAX_CAPTURE { continue; }
            let room = MAX_CAPTURE - buf.len();
            buf.extend_from_slice(&tmp[..n.min(room)]);
        }
        buf
    }

    let pending = {
        let stdout_pipe = stdout_pipe;
        let stderr_pipe = stderr_pipe;
        async move { (drain(stdout_pipe).await, drain_err(stderr_pipe).await) }
    };

    match tokio::time::timeout(timeout, async {
        let status = child.wait().await?;
        let (stdout_bytes, stderr_bytes) = pending.await;
        Ok::<_, std::io::Error>((status, stdout_bytes, stderr_bytes))
    })
    .await
    {
        Ok(Ok((status, stdout_bytes, stderr_bytes))) => Ok(RunResult {
            exit_code: status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&stdout_bytes).into_owned(),
            stderr: String::from_utf8_lossy(&stderr_bytes).into_owned(),
        }),
        Ok(Err(e)) => Err(e),
        Err(_) => {
            let _ = child.kill().await;
            let _ = child.wait().await; // reap so we don't leave a zombie
            Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                format!("kubectl timed out after {timeout:?}"),
            ))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // These tests assert that `build()` assembles argv correctly by inspecting
    // `cmd.as_std().get_args()` — no kubectl execution, no PATH mutation.

    fn kubectl_with_override(p: Option<PathBuf>) -> Kubectl {
        Kubectl { binary: "kubectl".into(), kubeconfig_override: p }
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
