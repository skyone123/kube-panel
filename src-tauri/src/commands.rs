use tauri::State;
use crate::kubeconfig::{self, ContextView};
use crate::history::{History, HistoryEntry};
use crate::runtime::KubeRuntime;
use crate::models::{self, PodView};

#[tauri::command]
pub fn list_contexts() -> Result<Vec<ContextView>, String> {
    kubeconfig::load_all().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn current_context() -> Result<Option<ContextView>, String> {
    let all = kubeconfig::load_all().map_err(|e| e.to_string())?;
    Ok(all.into_iter().find(|c| c.current))
}

#[tauri::command]
pub async fn use_context(name: String, rt: State<'_, KubeRuntime>) -> Result<(), String> {
    // kubectl config use-context does not take -n; pass namespace=None and args=["config","use-context",name]
    let res = rt.run(&name, None, &["config", "use-context", &name]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 {
        return Err(res.stderr);
    }
    Ok(())
}

#[tauri::command]
pub async fn get_pods(context: String, namespace: String, rt: State<'_, KubeRuntime>) -> Result<Vec<PodView>, String> {
    let args: &[&str] = if namespace.is_empty() {
        &["get", "pods", "--all-namespaces", "-o", "json"]
    } else {
        &["get", "pods", "-o", "json"]
    };
    let res = rt.run(&context, if namespace.is_empty() { None } else { Some(&namespace) }, args).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 {
        return Err(res.stderr);
    }
    models::parse_pod_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_namespaces(context: String, rt: State<'_, KubeRuntime>) -> Result<Vec<String>, String> {
    let res = rt.run(&context, None, &["get", "ns", "-o", "json"]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_namespace_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pod_logs(
    context: String, namespace: String, pod: String,
    container: Option<String>, previous: bool, tail: Option<i64>,
    rt: State<'_, KubeRuntime>,
) -> Result<String, String> {
    let mut args: Vec<String> = vec!["logs".into(), pod];
    if let Some(c) = &container { args.push("-c".into()); args.push(c.clone()); }
    if previous { args.push("--previous".into()); }
    if let Some(n) = tail { args.push(format!("--tail={}", n)); }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let res = rt.run(&context, Some(&namespace), &arg_refs).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 {
        return Err(res.stderr);
    }
    Ok(res.stdout)
}

#[tauri::command]
pub fn list_history(limit: i64, history: State<'_, History>) -> Result<Vec<HistoryEntry>, String> {
    history.list(limit).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn search_history(query: String, limit: i64, history: State<'_, History>) -> Result<Vec<HistoryEntry>, String> {
    history.search(&query, limit).map_err(|e| e.to_string())
}
