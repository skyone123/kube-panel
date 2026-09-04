// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod exec;
mod history;
mod kubeconfig;
mod kubectl;
mod models;
mod portforward;
mod runtime;
mod stream;

use tauri::Manager;
use exec::ExecRegistry;
use history::History;
use kubectl::Kubectl;
use portforward::PfRegistry;
use runtime::KubeRuntime;
use stream::StreamRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kubectl = Kubectl::from_env();
    let history = History::open(&History::default_path())
        .expect("failed to open history db");
    let runtime = KubeRuntime::new(kubectl, history.clone());

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(runtime)
        .manage(history)
        .manage(StreamRegistry::new())
        .manage(PfRegistry::new())
        .manage(ExecRegistry::new())
        .invoke_handler(tauri::generate_handler![
            commands::list_contexts,
            commands::current_context,
            commands::use_context,
            commands::get_pods,
            commands::list_namespaces,
            commands::get_pod_logs,
            commands::list_history,
            commands::search_history,
            commands::stream_pod_logs,
            commands::stream_multi_pod_logs,
            commands::stream_events,
            commands::stop_log_stream,
            commands::describe_pod,
            commands::get_pod_yaml,
            commands::get_events,
            commands::get_configmaps,
            commands::get_pod_configmaps,
            commands::get_configmap,
            commands::get_deployments,
            commands::rollout_restart,
            commands::rollout_scale,
            commands::rollout_undo,
            commands::get_rollout_revisions,
            commands::start_port_forward,
            commands::stop_port_forward,
            commands::list_port_forwards,
            commands::clear_port_forward,
            commands::get_nodes,
            commands::describe_node,
            commands::get_resources,
            commands::describe_resource,
            commands::start_exec,
            commands::send_pty_input,
            commands::resize_pty,
            commands::stop_exec,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            if let Some(execs) = app_handle.try_state::<ExecRegistry>() {
                execs.stop_all();
            }
        }
    });
}
