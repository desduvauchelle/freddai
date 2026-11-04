const COMMANDS: &[&str] = &["ping", "set_mode", "set_connection", "set_composer_text", "discard_files", "pick_option", "set_threads", "set_thread_meta", "set_voice", "append_composer_text", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").android_path("android").build();
}
