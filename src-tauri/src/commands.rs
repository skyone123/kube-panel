use tauri::{AppHandle, Emitter, State};
use crate::kubeconfig::{self, ContextView};
use crate::history::{History, HistoryEntry};
use crate::runtime::{build_history_entry, KubeRuntime};
use crate::models::{self, PodView, DeploymentView};
use crate::stream::StreamRegistry;
use crate::portforward::PfRegistry;
use crate::exec::ExecRegistry;

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

/// A live event pushed to the frontend via the `event_chunk` event.
#[derive(serde::Serialize, Clone)]
pub struct EventChunk {
    pub id: String,
    pub event: crate::models::EventView,
}

/// Start a live watch of cluster events. Returns the stream id; the frontend
/// subscribes to `event_chunk` events filtered by id. Stops via stop_log_stream.
/// Uses `kubectl get --raw /api/v1/[namespaces/<ns>/]events?watch=true&resourceVersion=0`
/// which streams compact NDJSON (one WatchEvent per line) — parsed per line into
/// EventView. resourceVersion=0 replays current events as ADDED then live updates.
#[tauri::command]
pub async fn stream_events(
    context: String,
    namespace: String,           // "" = all-namespaces (cluster-wide)
    rt: State<'_, KubeRuntime>,
    registry: State<'_, StreamRegistry>,
    history: State<'_, History>,
    app: AppHandle,
) -> Result<String, String> {
    // Build the raw watch path. Namespace "" → cluster-wide; else namespaced.
    let path = if namespace.is_empty() {
        "/api/v1/events?watch=true&resourceVersion=0".to_string()
    } else {
        format!("/api/v1/namespaces/{}/events?watch=true&resourceVersion=0", namespace)
    };
    let args: Vec<String> = vec!["get".into(), "--raw".into(), path.clone()];
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    // --raw ignores -n; the path encodes the namespace. ns_opt=None.
    let mut cmd = rt.build_cmd(&context, None, &arg_refs);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| e.to_string())?;

    // Record ONE history row (metadata-only, is_stream=true).
    let hist_argv: Vec<&str> = vec!["get", "--raw", "<events-watch>"];
    let entry = build_history_entry(&context, None, &hist_argv, None, 0, true);
    if let Err(e) = history.insert(&entry) { eprintln!("[kube-panel] history insert failed for events stream: {e}"); }

    let id = crate::stream::new_id();
    let id_for_emit = id.clone();
    let id_ret = registry.start(id, child, move |text| {
        // Each `text` is one NDJSON line (StreamRegistry reads line-by-line).
        // Skip partial/empty lines silently.
        if let Ok(event) = crate::models::parse_watch_event_line(text.as_bytes()) {
            let _ = app.emit("event_chunk", EventChunk { id: id_for_emit.clone(), event });
        }
    });
    Ok(id_ret)
}

/// Stop a running log stream by id. Kills the child process synchronously.
#[tauri::command]
pub fn stop_log_stream(id: String, registry: State<'_, StreamRegistry>) -> Result<(), String> {
    registry.stop(&id);
    Ok(())
}

/// A single target in a multi-pod merged log tail.
#[derive(serde::Deserialize)]
pub struct MultiPodTarget {
    pub namespace: String,
    pub pod: String,
    pub container: Option<String>,
}

/// Start a merged `kubectl logs -f` stream across multiple pods. Returns the
/// merge stream id. Each pod's lines are prefixed with `[<podname>] ` before
/// being emitted as `log_chunk` events `{ id, text }`. The stream stays alive
/// until all children exit OR `stop_log_stream(id)` is called.
///
/// History: ONE row is recorded with `is_stream=true`, `exit_code=None`, and a
/// representative argv summarizing the merged pods. Log CHUNK text is NEVER
/// written to history.
#[tauri::command]
pub async fn stream_multi_pod_logs(
    context: String,
    targets: Vec<MultiPodTarget>,
    previous: bool,
    tail: Option<i64>,
    since: Option<String>,
    rt: State<'_, KubeRuntime>,
    registry: State<'_, StreamRegistry>,
    history: State<'_, History>,
    app: AppHandle,
) -> Result<String, String> {
    if targets.len() < 2 {
        return Err("select at least 2 pods to merge".into());
    }
    let mut children: Vec<(String, tokio::process::Child)> = Vec::with_capacity(targets.len());
    for t in &targets {
        let mut args: Vec<String> = vec!["logs".into(), "-f".into(), t.pod.clone()];
        if let Some(c) = &t.container {
            args.push("-c".into());
            args.push(c.clone());
        }
        if previous {
            args.push("--previous".into());
        }
        if let Some(n) = tail {
            args.push(format!("--tail={}", n));
        }
        if let Some(s) = &since {
            args.push(format!("--since={}", s));
        }
        let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let ns_opt = if t.namespace.is_empty() { None } else { Some(t.namespace.as_str()) };
        let mut cmd = rt.build_cmd(&context, ns_opt, &arg_refs);
        cmd.stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        let child = cmd.spawn().map_err(|e| e.to_string())?;
        children.push((format!("[{}] ", t.pod), child));
    }

    // Record ONE history row (metadata-only, is_stream=true, exit_code=None).
    let pods_summary = targets.iter().map(|t| t.pod.as_str()).collect::<Vec<_>>().join(",");
    let hist_argv: Vec<&str> = vec!["logs", "-f", "--multi", &pods_summary];
    let entry = build_history_entry(&context, None, &hist_argv, None, 0, true);
    if let Err(e) = history.insert(&entry) {
        eprintln!("[kube-panel] history insert failed for multi stream: {e}");
    }

    let merge_id = crate::stream::new_id();
    let mid = merge_id.clone();
    let id_ret = registry.start_multi(merge_id, children, move |text| {
        let _ = app.emit("log_chunk", LogChunk { id: mid.clone(), text });
    });
    Ok(id_ret)
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
pub async fn get_pod_yaml(
    context: String, namespace: String, pod: String,
    rt: State<'_, KubeRuntime>,
) -> Result<String, String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, &["get", "pod", &pod, "-o", "yaml"]).await
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

#[tauri::command]
pub async fn get_configmap(
    context: String, namespace: String, name: String,
    rt: State<'_, KubeRuntime>,
) -> Result<crate::models::ConfigMapDataView, String> {
    let ns_arg = if namespace.is_empty() { None } else { Some(&namespace[..]) };
    let res = rt.run(&context, ns_arg, &["get", "cm", &name, "-o", "json"]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_configmap_data(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_deployments(
    context: String, namespace: String,
    rt: State<'_, KubeRuntime>,
) -> Result<Vec<DeploymentView>, String> {
    let args: &[&str] = if namespace.is_empty() {
        &["get", "deploy", "--all-namespaces", "-o", "json"]
    } else {
        &["get", "deploy", "-o", "json"]
    };
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, args).await.map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_deployment_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn rollout_restart(
    context: String, namespace: String, name: String,
    rt: State<'_, KubeRuntime>,
) -> Result<(), String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, &["rollout", "restart", "deployment", &name]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    Ok(())
}

#[tauri::command]
pub async fn rollout_scale(
    context: String, namespace: String, name: String, replicas: i64,
    rt: State<'_, KubeRuntime>,
) -> Result<(), String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let scale = format!("--replicas={}", replicas);
    let res = rt.run(&context, ns_opt, &["scale", "deployment", &name, &scale]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    Ok(())
}

#[tauri::command]
pub async fn rollout_undo(
    context: String, namespace: String, name: String, to_revision: Option<i64>,
    rt: State<'_, KubeRuntime>,
) -> Result<(), String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let mut args: Vec<String> = vec!["rollout".into(), "undo".into(), format!("deployment/{}", name)];
    if let Some(r) = to_revision { args.push(format!("--to-revision={}", r)); }
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let res = rt.run(&context, ns_opt, &arg_refs).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    Ok(())
}

#[tauri::command]
pub async fn get_rollout_revisions(
    context: String, namespace: String, name: String,
    rt: State<'_, KubeRuntime>,
) -> Result<Vec<crate::models::RolloutRevisionView>, String> {
    let args: &[&str] = if namespace.is_empty() {
        &["get", "rs", "--all-namespaces", "-o", "json"]
    } else {
        &["get", "rs", "-o", "json"]
    };
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, args).await.map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_rollout_revisions(res.stdout.as_bytes(), &name).map_err(|e| e.to_string())
}

/// Start a `kubectl port-forward` child process. Returns the session id.
/// The child's stderr is drained by the PfRegistry monitor; status updates
/// are emitted to the frontend as `pf_status` events `{ PfSessionView }`.
///
/// History: ONE row recorded with `is_stream=true`, `exit_code=None` (final
/// exit code not known at start). No chunk text is written to history.
#[tauri::command]
pub async fn start_port_forward(
    context: String,
    namespace: String,
    target: String,
    local_port: u16,
    remote_port: u16,
    rt: State<'_, KubeRuntime>,
    registry: State<'_, PfRegistry>,
    history: State<'_, History>,
    app: AppHandle,
) -> Result<String, String> {
    let port_arg = format!("{}:{}", local_port, remote_port);
    let args: Vec<String> = vec!["port-forward".into(), target.clone(), port_arg.clone()];
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let mut cmd = rt.build_cmd(&context, ns_opt, &arg_refs);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| e.to_string())?;

    // Record ONE history row (is_stream=true, exit_code=None).
    let hist_argv: Vec<&str> = vec!["port-forward", &target, &port_arg];
    let entry = build_history_entry(&context, ns_opt, &hist_argv, None, 0, true);
    if let Err(e) = history.insert(&entry) {
        eprintln!("[kube-panel] history insert failed for pf: {e}");
    }

    let id = crate::portforward::new_pf_id();
    let view = crate::portforward::PfSessionView {
        id: id.clone(),
        context: context.clone(),
        namespace: namespace.clone(),
        target: target.clone(),
        local_port,
        remote_port,
        started_at: chrono::Utc::now().timestamp_millis(),
        status: "running".into(),
        message: String::new(),
    };
    let id_ret = registry.start(id, child, view, move |v| {
        let _ = app.emit("pf_status", v);
    });
    Ok(id_ret)
}

/// Stop a running port-forward session by id. Signals the monitor to kill +
/// reap the child. No-op if the session is already dead or not found.
#[tauri::command]
pub fn stop_port_forward(id: String, registry: State<'_, PfRegistry>) -> Result<(), String> {
    registry.stop(&id);
    Ok(())
}

/// List all port-forward sessions (running + dead).
#[tauri::command]
pub fn list_port_forwards(registry: State<'_, PfRegistry>) -> Result<Vec<crate::portforward::PfSessionView>, String> {
    Ok(registry.list())
}

/// Remove a DEAD port-forward session from the list (only valid if not running).
#[tauri::command]
pub fn clear_port_forward(id: String, registry: State<'_, PfRegistry>) -> Result<(), String> {
    registry.remove(&id);
    Ok(())
}

#[tauri::command]
pub async fn get_nodes(context: String, rt: State<'_, KubeRuntime>) -> Result<Vec<crate::models::NodeView>, String> {
    // Nodes are cluster-scoped: ns_opt=None, NO --all-namespaces
    let res = rt.run(&context, None, &["get", "nodes", "-o", "json"]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_node_list(res.stdout.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn describe_node(context: String, name: String, rt: State<'_, KubeRuntime>) -> Result<String, String> {
    // Nodes are cluster-scoped: ns_opt=None
    let res = rt.run(&context, None, &["describe", "node", &name]).await
        .map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    Ok(res.stdout)
}

/// Start a `kubectl exec -it` session in a PTY. Returns the session id.
/// PTY output is emitted to the frontend as `pty_data` events `{ id, data }`.
/// When the child exits, a `pty_exit` event `{ id, code }` is emitted.
///
/// History: ONE row recorded with `is_stream=true`, `exit_code=None` (final
/// exit code not known at start). PTY output is NEVER written to history.
#[tauri::command]
pub async fn start_exec(
    context: String,
    namespace: String,
    pod: String,
    container: String,
    command: Vec<String>,
    _rt: State<'_, KubeRuntime>,
    execs: State<'_, ExecRegistry>,
    history: State<'_, History>,
    app: AppHandle,
) -> Result<String, String> {
    // Build a representative argv for history (metadata-only, is_stream=true).
    let mut hist_argv: Vec<String> = vec![
        "exec".into(), "-it".into(), pod.clone(), "-c".into(), container.clone(), "--".into(),
    ];
    hist_argv.extend(command.iter().cloned());
    let hist_refs: Vec<&str> = hist_argv.iter().map(|s| s.as_str()).collect();
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let entry = build_history_entry(&context, ns_opt, &hist_refs, None, 0, true);
    if let Err(e) = history.insert(&entry) {
        eprintln!("[kube-panel] history insert failed for exec: {e}");
    }

    // Start the PTY session (uses build_cmd semantics — discrete argv, no shell).
    execs.start(app, &context, &namespace, &pod, &container, command)
}

/// Send user keystrokes to a PTY session by id.
#[tauri::command]
pub fn send_pty_input(id: String, data: String, execs: State<'_, ExecRegistry>) -> Result<(), String> {
    execs.send_input(&id, &data)
}

/// Resize a PTY session to the given cols/rows.
#[tauri::command]
pub fn resize_pty(id: String, cols: u16, rows: u16, execs: State<'_, ExecRegistry>) -> Result<(), String> {
    execs.resize(&id, cols, rows)
}

/// Stop a PTY session by id. Kills the child + drops the master → reader EOFs.
#[tauri::command]
pub fn stop_exec(id: String, execs: State<'_, ExecRegistry>) -> Result<(), String> {
    execs.stop(&id)
}

#[tauri::command]
pub async fn get_resources(
    context: String, namespace: String, kind: String,
    rt: State<'_, KubeRuntime>,
) -> Result<crate::models::ResourceListView, String> {
    let mut args: Vec<String> = vec!["get".into(), kind.clone()];
    if namespace.is_empty() { args.push("--all-namespaces".into()); }
    args.push("-o".into()); args.push("json".into());
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let res = rt.run(&context, ns_opt, &arg_refs).await.map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    crate::models::parse_resources(res.stdout.as_bytes(), &kind).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn describe_resource(
    context: String, namespace: String, kind: String, name: String,
    rt: State<'_, KubeRuntime>,
) -> Result<String, String> {
    let ns_opt = if namespace.is_empty() { None } else { Some(namespace.as_str()) };
    let args: Vec<String> = vec!["describe".into(), kind, name];
    let arg_refs: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let res = rt.run(&context, ns_opt, &arg_refs).await.map_err(|e| e.to_string())?;
    if res.exit_code != 0 { return Err(res.stderr); }
    Ok(res.stdout)
}
