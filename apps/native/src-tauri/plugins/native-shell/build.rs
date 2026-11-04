const COMMANDS: &[&str] = &["ping", "set_mode", "set_connection", "set_composer_text", "set_threads", "set_thread_meta", "register_listener", "remove_listener"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").build();
}
