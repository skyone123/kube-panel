use std::path::PathBuf;
use tokio::process::Command;

pub struct RunResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

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
