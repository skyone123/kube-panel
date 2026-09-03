// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod commands;
mod history;
mod kubeconfig;
mod kubectl;
mod models;
mod runtime;

use history::History;
use kubectl::Kubectl;
use runtime::KubeRuntime;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

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
        .invoke_handler(tauri::generate_handler![
            greet,
            commands::list_contexts,
            commands::current_context,
            commands::use_context,
            commands::get_pods,
            commands::get_pod_logs,
            commands::list_history,
            commands::search_history,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
