// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod history;
mod kubeconfig;
mod kubectl;
mod models;
mod runtime;
mod stream;

use history::History;
use kubectl::Kubectl;
use runtime::KubeRuntime;
use stream::StreamRegistry;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let kubectl = Kubectl::from_env();
    let history = History::open(&History::default_path())
        .expect("failed to open history db");
    let runtime = KubeRuntime::new(kubectl, history.clone());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(runtime)
        .manage(history)
        .manage(StreamRegistry::new())
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
            commands::stop_log_stream,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
