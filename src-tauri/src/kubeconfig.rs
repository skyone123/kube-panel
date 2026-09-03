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

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
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
            return v.split(SEP).filter(|s| !s.is_empty()).map(PathBuf::from).collect();
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

/// Internal: parse one file into raw KubeConfig.
fn parse_raw(path: &Path) -> std::io::Result<KubeConfig> {
    let bytes = std::fs::read(path)?;
    let cfg: KubeConfig = serde_yaml::from_slice(&bytes)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    Ok(cfg)
}

/// Load one file into ContextViews, flagging `current` per that file's own `current-context`.
pub fn load_from_path(path: &Path) -> std::io::Result<Vec<ContextView>> {
    let cfg = parse_raw(path)?;
    let mut views: Vec<ContextView> = cfg
        .contexts
        .iter()
        .map(|nc| ContextView {
            name: nc.name.clone(),
            cluster: nc.context.cluster.clone(),
            user: nc.context.user.clone(),
            namespace: nc.context.namespace.clone(),
            current: false,
        })
        .collect();
    if let Some(cur) = cfg.current_context.as_deref() {
        for v in views.iter_mut() {
            if v.name == cur {
                v.current = true;
            }
        }
    }
    Ok(views)
}

/// Merge multiple kubeconfig sources: first definition of a context name wins,
/// and `current-context` is taken from the first source that defines it.
pub fn merge_sources(paths: &[PathBuf]) -> std::io::Result<Vec<ContextView>> {
    let mut views: Vec<ContextView> = Vec::new();
    let mut current: Option<String> = None;
    for p in paths {
        if !p.exists() {
            continue;
        }
        let cfg = parse_raw(p)?;
        if current.is_none() {
            current = cfg.current_context.clone();
        }
        for nc in &cfg.contexts {
            if views.iter().any(|v: &ContextView| v.name == nc.name) {
                continue; // first wins
            }
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
            if v.name == cur {
                v.current = true;
            }
        }
    }
    Ok(views)
}

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
