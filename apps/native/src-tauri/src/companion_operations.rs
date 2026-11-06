/// Mobile composer commands exposed through the paired Mac transport.
pub(crate) fn validate(operation: &str) -> Result<(), String> {
    if !["models", "queue", "upload", "voice", "transcribe", "day_summary", "summarize_day", "save_schedule", "schedule_action"].contains(&operation) {
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
    fn rejects_unrelated_host_commands() {
        assert!(super::validate("snapshot").is_err());
        assert!(super::validate("shell").is_err());
    }
}
