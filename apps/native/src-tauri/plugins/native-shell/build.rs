const COMMANDS: &[&str] = &["call_control", "ping", "set_mode", "set_connection", "set_composer_text", "discard_files", "pick_option", "set_threads", "set_dashboard", "set_thread_meta", "set_voice", "append_composer_text", "register_listener", "remove_listener", "bug_walk_recording_available", "start_bug_walk_recording", "stop_bug_walk_recording", "cancel_bug_walk_recording", "pick_bug_walk_video"];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).ios_path("ios").android_path("android").build();
}
