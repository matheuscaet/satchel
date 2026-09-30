use tauri::Manager;

mod git;
mod secrets;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            git::git_version,
            git::git_info,
            git::git_remotes,
            git::git_status,
            git::git_commit,
            git::git_commit_merge,
            git::git_fetch,
            git::git_pull,
            git::git_push,
            git::git_init,
            secrets::secrets_get,
            secrets::secrets_set,
            secrets::secrets_delete,
        ])
        // Response windows are satellites of the main window: closing it quits the app.
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let tauri::WindowEvent::Destroyed = event {
                    window.app_handle().exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
