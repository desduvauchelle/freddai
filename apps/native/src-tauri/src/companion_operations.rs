/// Mobile composer commands exposed through the paired Mac transport.
pub(crate) fn validate(operation: &str) -> Result<(), String> {
    if !["browse_folders", "create_folder", "add_project", "update_project_organization", "resume_thread", "move_project", "save_workspaces", "generated_file", "models", "queue", "upload", "voice", "transcribe", "day_summary", "summarize_day", "save_schedule", "schedule_action", "google_capability", "google_accounts", "google_disconnect", "google_triggers", "google_trigger_save", "google_trigger_delete", "commander_state", "commander_proposals", "commander_proposal_respond", "commander_todos", "commander_todo_save", "commander_notes", "commander_note_read", "commander_note_write", "commander_profile", "commander_profile_save", "commander_revision_restore", "preview_open"].contains(&operation) {
        return Err("Unknown composer operation".into());
    }
    Ok(())
}

/// Whether the running background host answers the google_* operations. Older hosts omit the flag.
pub(crate) fn google_capability(hello: &serde_json::Value) -> serde_json::Value {
    serde_json::json!({"supported": hello["google_accounts"].as_u64().is_some_and(|v| v >= 1)})
}

#[cfg(test)]
mod tests {
    #[test]
    fn google_capability_needs_the_host_flag() {
        use serde_json::json;
        assert_eq!(super::google_capability(&json!({"version":"2","schedule_delivery":true})), json!({"supported":false}));
        assert_eq!(super::google_capability(&json!({"google_accounts":0})), json!({"supported":false}));
        assert_eq!(super::google_capability(&json!({"google_accounts":true})), json!({"supported":false}));
        assert_eq!(super::google_capability(&json!({"google_accounts":1})), json!({"supported":true}));
    }
    #[test]
    fn summary_reads_and_explicit_generation_reach_the_mac() {
        assert_eq!(super::validate("day_summary"), Ok(()));
        assert_eq!(super::validate("summarize_day"), Ok(()));
    }
    #[test]
    fn commander_operations_reach_the_mac() {
        for op in ["commander_state", "commander_proposals", "commander_proposal_respond", "commander_todos", "commander_todo_save", "commander_notes", "commander_note_read", "commander_note_write", "commander_profile", "commander_profile_save", "commander_revision_restore"] {
            assert_eq!(super::validate(op), Ok(()));
        }
        // Memory and settings stay desktop-only.
        assert!(super::validate("commander_memory_save").is_err());
        assert!(super::validate("commander_settings_set").is_err());
    }
    #[test]
    fn google_accounts_and_triggers_reach_the_mac_but_credentials_do_not() {
        for op in ["google_capability", "google_accounts", "google_disconnect", "google_triggers", "google_trigger_save", "google_trigger_delete"] {
            assert_eq!(super::validate(op), Ok(()));
        }
        // The OAuth redirect lands on the Mac, and the client secret never leaves it.
        for op in ["google_config_get", "google_config_set", "google_connect_start", "google_connect_status"] {
            assert!(super::validate(op).is_err(), "{op} must stay Mac-only");
        }
    }
    #[test]
    fn preview_open_reaches_the_mac() {
        assert_eq!(super::validate("preview_open"), Ok(()));
    }
    #[test]
    fn rejects_unrelated_host_commands() {
        assert!(super::validate("snapshot").is_err());
        assert!(super::validate("shell").is_err());
    }
}
