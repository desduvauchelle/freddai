#![cfg(any(target_os = "ios", target_os = "android"))]
//! Native mobile navigation and composer around the shared Tauri WebView.
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
async fn set_dashboard<R: Runtime>(app: AppHandle<R>, model: serde_json::Value) -> Result<(), String> {
    app.state::<NativeShell<R>>().0.run_mobile_plugin("setDashboard", serde_json::json!({"model": model})).map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_thread_meta<R: Runtime>(app: AppHandle<R>, meta: serde_json::Value) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setThreadMeta", serde_json::json!({"meta": meta}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn set_composer_text<R: Runtime>(app: AppHandle<R>, text: String, files: Option<serde_json::Value>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setComposerText", serde_json::json!({"text": text, "files": files}))
        .map_err(|e| e.to_string())
}
/// Voice dictation UI: `enabled` shows the mic button, `state` is "idle" or "transcribing".
#[tauri::command]
async fn set_voice<R: Runtime>(app: AppHandle<R>, enabled: bool, state: Option<String>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("setVoice", serde_json::json!({"enabled": enabled, "state": state}))
        .map_err(|e| e.to_string())
}
/// Appends dictated text to whatever is currently in the native composer; `submit` then sends it exactly like tapping Send.
#[tauri::command]
async fn append_composer_text<R: Runtime>(app: AppHandle<R>, text: String, submit: Option<bool>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("appendComposerText", serde_json::json!({"text": text, "submit": submit.unwrap_or(false)}))
        .map_err(|e| e.to_string())
}
#[tauri::command]
async fn discard_files<R: Runtime>(app: AppHandle<R>, paths: Vec<String>) -> Result<(), String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("discardFiles", serde_json::json!({"paths": paths}))
        .map_err(|e| e.to_string())
}
/// Native action sheet; resolves `{picked, id}` once the user chooses or dismisses it.
#[tauri::command]
async fn pick_option<R: Runtime>(app: AppHandle<R>, title: String, options: serde_json::Value, selected: Option<String>) -> Result<serde_json::Value, String> {
    app.state::<NativeShell<R>>().0
        .run_mobile_plugin("pickOption", serde_json::json!({"title": title, "options": options, "selected": selected}))
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
        .invoke_handler(tauri::generate_handler![ping, set_mode, set_connection, set_composer_text, discard_files, pick_option, set_threads, set_dashboard, set_thread_meta, set_voice, append_composer_text, register_listener, remove_listener])
        .setup(|app, api| {
            #[cfg(target_os = "ios")]
            {
                let handle = api.register_ios_plugin(init_plugin_native_shell)?;
                app.manage(NativeShell(handle));
            }
            #[cfg(target_os = "android")]
            {
                let handle = api.register_android_plugin("com.freddai.shell", "NativeShellPlugin")?;
                app.manage(NativeShell(handle));
            }
            Ok(())
        })
        .build()
}

/// Rust-only credential storage bridge. Never exposed in the WebView invoke handler.
#[cfg(target_os = "android")]
pub fn read_credential<R: Runtime>(app: &AppHandle<R>) -> Result<Option<String>, String> {
    #[derive(Deserialize)] struct Stored { value: Option<String> }
    app.state::<NativeShell<R>>().0.run_mobile_plugin::<Stored>("readCredential", Empty {})
        .map(|stored| stored.value).map_err(|_| "Cannot read Android pairing credentials".into())
}
#[cfg(target_os = "android")]
pub fn write_credential<R: Runtime>(app: &AppHandle<R>, value: &str) -> Result<(), String> {
    app.state::<NativeShell<R>>().0.run_mobile_plugin("writeCredential", serde_json::json!({"value": value}))
        .map_err(|_| "Cannot save Android pairing credentials".into())
}
