/// Mobile composer commands exposed through the paired Mac transport.
pub(crate) fn validate(operation: &str) -> Result<(), String> {
    if !["resume_thread", "move_project", "save_workspaces", "generated_file", "models", "queue", "upload", "voice", "transcribe", "day_summary", "summarize_day", "save_schedule", "schedule_action", "commander_state", "commander_proposals", "commander_proposal_respond", "commander_todos", "commander_todo_save", "commander_notes", "commander_note_read", "commander_note_write"].contains(&operation) {
        return Err("Unknown composer operation".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn summary_reads_and_explicit_generation_reach_the_mac() {
        assert_eq!(super::validate("day_summary"), Ok(()));
        assert_eq!(super::validate("summarize_day"), Ok(()));
    }
    #[test]
    fn commander_operations_reach_the_mac() {
        for op in ["commander_state", "commander_proposals", "commander_proposal_respond", "commander_todos", "commander_todo_save", "commander_notes", "commander_note_read", "commander_note_write"] {
            assert_eq!(super::validate(op), Ok(()));
        }
        // Memory and settings stay desktop-only.
        assert!(super::validate("commander_memory_save").is_err());
        assert!(super::validate("commander_settings_set").is_err());
    }
    #[test]
    fn rejects_unrelated_host_commands() {
        assert!(super::validate("snapshot").is_err());
        assert!(super::validate("shell").is_err());
    }
}
