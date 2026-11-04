//! iOS-only native shell (UINavigationController + native composer) around the Tauri WKWebView.
use serde::{Deserialize, Serialize};
use tauri::{
    ipc::Channel,
    plugin::{Builder, PluginHandle, TauriPlugin},
    AppHandle, Manager, Runtime,
};

#[cfg(target_os = "ios")]
tauri::ios_plugin_binding!(init_plugin_native_shell);

pub struct NativeShell<R: Runtime>(PluginHandle<R>);

#[derive(Serialize)]
struct RegisterListener {
    event: String,
    handler: Channel<serde_json::Value>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RemoveListener {
    event: String,
    channel_id: u32,
}
#[derive(Serialize, Deserialize)]
struct Empty {}

#[tauri::command]
async fn ping<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    app.state::<NativeShell<R>>().0.run_mobile_plugin("ping", Empty {}).map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_mode<R: Runtime>(app: AppHandle<R>, mode: String, title: Option<String>, placeholder: Option<String>, open_drawer: Option<bool>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setMode", serde_json::json!({"mode": mode, "title": title, "placeholder": placeholder, "openDrawer": open_drawer}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_connection<R: Runtime>(app: AppHandle<R>, state: String, message: Option<String>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setConnection", serde_json::json!({"state": state, "message": message}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_threads<R: Runtime>(app: AppHandle<R>, model: serde_json::Value) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setThreads", serde_json::json!({"model": model}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_thread_meta<R: Runtime>(app: AppHandle<R>, meta: serde_json::Value) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setThreadMeta", serde_json::json!({"meta": meta}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_composer_text<R: Runtime>(app: AppHandle<R>, text: String) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setComposerText", serde_json::json!({"text": text}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn register_listener<R: Runtime>(app: AppHandle<R>, event: String, handler: Channel<serde_json::Value>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("registerListener", RegisterListener { event, handler })
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn remove_listener<R: Runtime>(app: AppHandle<R>, event: String, channel_id: u32) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("removeListener", RemoveListener { event, channel_id })
        .map_err(|e| e.to_string())
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("native-shell")
        .invoke_handler(tauri::generate_handler![ping, set_mode, set_connection, set_composer_text, set_threads, set_thread_meta, register_listener, remove_listener])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                let handle = api.register_ios_plugin(init_plugin_native_shell)?;
                app.manage(NativeShell(handle));
            }
            #[cfg(not(target_os = "ios"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}
