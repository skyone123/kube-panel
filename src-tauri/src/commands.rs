use tauri::{AppHandle, Emitter, State};
use crate::kubeconfig::{self, ContextView};
use crate::history::{History, HistoryEntry};
use crate::runtime::{build_history_entry, KubeRuntime};
use crate::models::{self, PodView};
use crate::stream::StreamRegistry;

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

/// A chunk of streaming log output pushed to the frontend via the `log_chunk` event.
#[derive(serde::Serialize, Clone)]
pub struct LogChunk {
    pub id: String,
    pub text: String,
}

/// Start a `kubectl logs -f` stream. Returns the stream id. Log chunks are emitted
/// to the frontend as `log_chunk` events `{ id, text }`. The stream stays alive
/// until the child exits (EOF) or `stop_log_stream` is called.
///
/// History metadata: the invocation is recorded once with `is_stream=true` and
/// `exit_code=None` (the final exit code isn't known at start). Log CHUNK text is
/// NEVER written to history — it only goes to the frontend via events.
#[tauri::command]
pub async fn stream_pod_logs(
    context: String,
    namespace: String,           // "" = all-namespaces (mirror get_pods)
    pod: String,
    container: Option<String>,
    previous: bool,
    tail: Option<i64>,
    since: Option<String>,       // e.g. "5m", "1h"
    rt: State<'_, KubeRuntime>,
    registry: State<'_, StreamRegistry>,
    history: State<'_, History>,
    app: AppHandle,
) -> Result<String, String> {
    let mut args: Vec<String> = vec!["logs".into(), "-f".into(), pod];
    if let Some(c) = &container {
        args.push("-c".into());
        args.push(c.clone());
    }
    if previous {
        args.push("--previous".into());
    }
    if let Some(n) = tail {
        args.push(format!("--tail={}", n));
    }
    if let Some(s) = since {
        args.push(format!("--since={}", s));
    }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let mut cmd = rt.build_cmd(&context, ns_opt, &arg_refs);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| e.to_string())?;

    // record a history row (is_stream=true, exit_code=None — final exit code not known at start)
    let entry = build_history_entry(&context, ns_opt, &arg_refs, None, 0, true);
    // best-effort: don't fail the stream on a history write error
    if let Err(e) = history.insert(&entry) {
        eprintln!("[kube-panel] history insert failed for stream start: {e}");
    }

    // pre-allocate the id so the emit closure can capture it before `start` returns
    let id = crate::stream::new_id();
    let id_for_emit = id.clone();
    let id_ret = registry.start(id.clone(), child, move |text| {
        let _ = app.emit("log_chunk", LogChunk { id: id_for_emit.clone(), text });
    });
    debug_assert_eq!(id_ret, id, "StreamRegistry::start must echo the caller-supplied id");
    Ok(id)
}

/// Stop a running log stream by id. Kills the child process synchronously.
#[tauri::command]
pub fn stop_log_stream(id: String, registry: State<'_, StreamRegistry>) -> Result<(), String> {
    registry.stop(&id);
    Ok(())
}

#[tauri::command]
pub async fn describe_pod(
    context: String, namespace: String, pod: String,
    rt: State<'_, KubeRuntime>,
) -> Result<String, String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, &["describe", "pod", &pod]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    Ok(res.stdout)
}

#[tauri::command]
pub async fn get_events(
    context: String, namespace: String,
    rt: State<'_, KubeRuntime>,
) -> Result<Vec<crate::models::EventView>, String> {
    let args: &[&str] = if namespace.is_empty() {
        &["get", "events", "--all-namespaces", "-o", "json"]
    } else {
        &["get", "events", "-o", "json"]
    };
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, args).await.map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_event_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_configmaps(
    context: String, namespace: String,
    rt: State<'_, KubeRuntime>,
) -> Result<Vec<crate::models::ConfigMapView>, String> {
    let args: &[&str] = if namespace.is_empty() {
        &["get", "cm", "--all-namespaces", "-o", "json"]
    } else {
        &["get", "cm", "-o", "json"]
    };
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, args).await.map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_configmap_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_pod_configmaps(
    context: String, namespace: String, pod: String,
    rt: State<'_, KubeRuntime>,
) -> Result<Vec<String>, String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, &["get", "pod", &pod, "-o", "json"]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_pod_configmap_refs(res.stdout.as_bytes()).map_err(|e| e.to_string())
}
