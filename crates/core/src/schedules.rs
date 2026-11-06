use crate::runtime::{LaunchOptions, Session};
use chrono::{TimeZone, Utc};
use serde::{Deserialize, Serialize};
use std::str::FromStr;
#[derive(Clone, Serialize, Deserialize)]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub project: String,
    pub account: String,
    pub routing: String,
    pub cron: String,
    pub timezone: String,
    #[serde(default)]
    pub end_date: Option<String>,
    #[serde(default)]
    pub max_runs: Option<u32>,
    #[serde(default = "default_new_chat")]
    pub new_chat: bool,
    #[serde(default)]
    pub thread: Option<String>,
    #[serde(default)]
    pub notifications: Option<String>,
    pub prompt: String,
    pub enabled: bool,
    #[serde(default)]
    pub options: LaunchOptions,
    #[serde(default)]
    pub next_due: u64,
    #[serde(default)]
    pub run_now: Option<u64>,
    #[serde(default)]
    pub runs: Vec<Run>,
}
fn default_new_chat() -> bool { true }
fn terminal(state: &str) -> bool { ["done", "failed", "interrupted", "stopped", "blocked", "skipped", "missed", "archived"].contains(&state) }

impl Schedule {
    pub fn validate_delivery(&self, sessions: &[Session]) -> Result<(), String> {
        if ![None, Some("off"), Some("important"), Some("all")].contains(&self.notifications.as_deref()) {
            return Err("Choose a valid notification setting".into());
        }
        if !self.new_chat { self.target_thread(sessions)?; }
        Ok(())
    }
    pub fn target_thread<'a>(&self, sessions: &'a [Session]) -> Result<Option<&'a Session>, String> {
        if self.new_chat { return Ok(None) }
        let thread = self.thread.as_ref().and_then(|id| sessions.iter().find(|s| &s.id == id))
            .ok_or("Choose an existing thread for this routine")?;
        if thread.project != self.project || thread.account != self.account || self.routing != "fixed" {
            return Err("The selected thread must use this project and agent".into());
        }
        if thread.archived || thread.deleted_at.is_some() || thread.status == "archived" || thread.provider_id.is_none() {
            return Err("Choose an available thread with an established agent conversation".into());
        }
        Ok(Some(thread))
    }
    pub fn observe_session(&mut self, session: &Session) {
        let mode=self.notifications.as_deref();
        for run in &mut self.runs {
            if run.finished || !session.requests.contains(&run.id) { continue; }
            run.session=Some(session.id.clone());
            // An old run must never inherit a later turn's status or output.
            if session.requests.last() != Some(&run.id) {
                if !terminal(&run.state) { run.state="interrupted".into(); run.reason=Some("The thread advanced before this run's outcome could be recovered.".into()); }
                run.queue_notice(&self.name, mode, "");
                run.finished=true;
                continue;
            }
            run.state=session.status.clone();
            run.reason=session.error.clone();
            let start=session.messages.iter().rposition(|m|m.role=="user").map_or(0,|i|i+1);
            let reply=session.messages[start..].iter().rev().find(|m|m.role=="assistant").map(|m|m.text.as_str()).unwrap_or("");
            run.queue_notice(&self.name, mode, reply);
            run.finished=terminal(&run.state);
        }
    }

    /// Keep uncertain post-crash dispatches reserved rather than risk exceeding the cap.
    pub fn run_limit_reached(&self) -> bool {
        self.max_runs.is_some_and(|limit| self.runs.iter().filter(|r| r.session.is_some() || r.state == "uncertain").count() >= limit as usize)
    }
    pub fn validate_stop(&self) -> Result<(), String> {
        if self.max_runs == Some(0) { return Err("Number of runs must be at least 1".into()) }
        if self.max_runs.is_some() && self.end_date.is_some() { return Err("Choose an end date or a run limit, not both".into()) }
        Ok(())
    }
    /// Inclusive calendar date in the routine's timezone; no UTC-midnight assumption.
    pub fn allows_automatic_at(&self, at: u64) -> Result<bool, String> {
        let Some(end) = self.end_date.as_deref() else { return Ok(true) };
        let date = chrono::NaiveDate::parse_from_str(end, "%Y-%m-%d")
            .map_err(|_| "Choose a valid end date (YYYY-MM-DD)")?;
        if date.format("%Y-%m-%d").to_string() != end {
            return Err("Choose a valid end date (YYYY-MM-DD)".into());
        }
        let tz = chrono_tz::Tz::from_str(&self.timezone).map_err(|_| "Use a valid IANA timezone")?;
        let instant = Utc.timestamp_millis_opt(at as i64).single().ok_or("Invalid date")?;
        Ok(instant.with_timezone(&tz).date_naive() <= date)
    }
    pub fn next_automatic(&self, after: u64) -> Result<Option<u64>, String> {
        // Validate the end date even when it has already passed.
        self.validate_stop()?;
        self.allows_automatic_at(after)?;
        let due = next(&self.cron, &self.timezone, after)?;
        Ok((!self.run_limit_reached() && self.allows_automatic_at(due)?).then_some(due))
    }
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct Run {
    pub id: String,
    pub due: u64,
    pub state: String,
    pub session: Option<String>,
    pub reason: Option<String>,
    #[serde(default)]
    pub finished: bool,
    #[serde(default)]
    pub notices: Vec<Notice>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct Notice {
    pub id: String,
    pub title: String,
    pub body: String,
    pub session: Option<String>,
    #[serde(default)]
    pub delivered: bool,
}
impl Run {
    pub fn queue_notice(&mut self, name: &str, mode: Option<&str>, reply: &str) {
        if !matches!(mode, Some("all" | "important")) { return; }
        let attention=["waiting","failed","blocked","interrupted","uncertain"].contains(&self.state.as_str());
        let completed=self.state=="done";
        let quiet=reply.trim().trim_end_matches('.').eq_ignore_ascii_case("No important updates");
        if !attention && !(completed && (mode==Some("all") || (!reply.trim().is_empty() && !quiet))) { return; }
        let id=format!("{}:{}",self.id,self.state);
        if self.notices.iter().any(|n|n.id==id) { return; }
        let body=if self.state=="waiting" { "Approval or an answer is needed." }
            else if attention { self.reason.as_deref().unwrap_or("This routine needs your attention.") }
            else if reply.trim().is_empty() { "Routine completed." } else { reply.trim() };
        self.notices.push(Notice {id,title:format!("{} · {}",name,if attention {"Needs attention"} else {"Update"}),body:body.chars().take(240).collect(),session:self.session.clone(),delivered:false});
    }
}
/// A routine is the union of up to 32 newline-separated cron entries.
/// Taking the earliest timestamp coalesces entries that coincide into one run.
/// Single-entry records need no migration; older hosts reject multi-entry input.
pub fn next(expression: &str, timezone: &str, after: u64) -> Result<u64, String> {
    let entries = expression.split('\n').collect::<Vec<_>>();
    if entries.len() > 32 {
        return Err("Use at most 32 schedule entries".into());
    }
    let mut earliest = u64::MAX;
    for (index, entry) in entries.iter().enumerate() {
        let due = next_entry(entry.trim(), timezone, after)
            .map_err(|error| if entries.len() == 1 { error } else { format!("Schedule {}: {error}", index + 1) })?;
        earliest = earliest.min(due);
    }
    Ok(earliest)
}
fn next_entry(expression: &str, timezone: &str, after: u64) -> Result<u64, String> {
    let tz = chrono_tz::Tz::from_str(timezone)
        .map_err(|_| "Use a valid IANA timezone, e.g. America/Los_Angeles")?;
    if expression.split_whitespace().count() != 5 {
        return Err("Use five cron fields: minute hour day month weekday".into());
    }
    let fields = expression.split_whitespace().collect::<Vec<_>>();
    // cron crate numbers Sunday as 1; UI accepts standard five-field cron (Sunday 0/7).
    let day = fields[4];
    let mut weekdays = std::collections::BTreeSet::new();
    for part in day.split(',') {
        let (range, step) = part
            .split_once('/')
            .map(|(r, n)| n.parse::<u32>().map(|n| (r, n)))
            .transpose()
            .map_err(|_| "Invalid weekday step")?
            .unwrap_or((part, 1));
        if step == 0 {
            return Err("Invalid weekday step".into());
        }
        let number = |v: &str| -> Result<u32, String> {
            match v.to_ascii_uppercase().as_str() {
                "SUN" => Ok(0),
                "MON" => Ok(1),
                "TUE" => Ok(2),
                "WED" => Ok(3),
                "THU" => Ok(4),
                "FRI" => Ok(5),
                "SAT" => Ok(6),
                _ => v.parse().map_err(|_| "Invalid weekday".into()),
            }
        };
        let (first, last) = if range == "*" {
            (0, 6)
        } else if let Some((a, b)) = range.split_once('-') {
            (number(a)?, number(b)?)
        } else {
            let n = number(range)?;
            (n, if part.contains('/') { 7 } else { n })
        };
        if first > 7 || last > 7 || first > last {
            return Err("Weekdays must be 0-7 (Sunday is 0 or 7)".into());
        }
        for n in (first..=last).step_by(step as usize) {
            weekdays.insert(n % 7 + 1);
        }
    }
    if fields[2] != "*" && fields[4] != "*" {
        return Err("Choose either day of month or weekday, leaving the other as *".into());
    }
    let days = weekdays
        .into_iter()
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let expr = format!(
        "0 {} {} {} {} {}",
        fields[0], fields[1], fields[2], fields[3], days
    );
    let schedule = cron::Schedule::from_str(&expr).map_err(|e| e.to_string())?;
    let start = Utc
        .timestamp_millis_opt(after as i64)
        .single()
        .ok_or("Invalid date")?
        .with_timezone(&tz);
    let mut upcoming = schedule.after(&start);
    let date = upcoming.next().ok_or("Schedule has no future occurrence")?;
    if upcoming
        .next()
        .is_some_and(|next| next.timestamp_millis() - date.timestamp_millis() < 60_000)
    {
        return Err("Schedules must be at least one minute apart".into());
    }
    Ok(date.timestamp_millis() as u64)
}
pub fn wall_slot(time: u64, timezone: &str) -> Option<String> {
    let tz = chrono_tz::Tz::from_str(timezone).ok()?;
    Some(
        Utc.timestamp_millis_opt(time as i64)
            .single()?
            .with_timezone(&tz)
            .format("%Y-%m-%d %H:%M")
            .to_string(),
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weekdays_follow_standard_cron() {
        let friday = chrono::DateTime::parse_from_rfc3339("2026-11-06T18:00:00Z")
            .unwrap()
            .timestamp_millis() as u64;
        let monday = chrono::DateTime::parse_from_rfc3339("2026-11-09T17:00:00Z")
            .unwrap()
            .timestamp_millis() as u64;
        assert_eq!(
            next("0 9 * * 1-5", "America/Los_Angeles", friday).unwrap(),
            monday
        );
        assert_eq!(
            next("0 9 * * MON-FRI", "America/Los_Angeles", friday).unwrap(),
            monday
        );
    }
    #[test]
    fn timezone_and_invalid_rules() {
        let t = 1700000000000;
        assert!(next("0 9 * * *", "America/Los_Angeles", t).unwrap() > t);
        assert!(next("invalid", "UTC", t).is_err());
        assert!(next("* * * * * *", "UTC", t).is_err());
        assert!(next("0 9 * * *", "bad-zone", t).is_err());
    }
    fn stamp(date: &str) -> u64 {
        chrono::DateTime::parse_from_rfc3339(date).unwrap().timestamp_millis() as u64
    }
    #[test]
    fn schedule_entries_form_a_union_of_days_and_times() {
        let rules = "0 9 * * 1,3,5\n30 15 * * 1,2,4";
        let mut cursor = stamp("2026-11-09T00:00:00Z");
        for expected in ["2026-11-09T09:00:00Z", "2026-11-09T15:30:00Z", "2026-11-10T15:30:00Z", "2026-11-11T09:00:00Z", "2026-11-12T15:30:00Z", "2026-11-13T09:00:00Z", "2026-11-16T09:00:00Z"] {
            cursor = next(rules, "UTC", cursor).unwrap();
            assert_eq!(cursor, stamp(expected));
        }
        assert_eq!(next(rules, "America/Los_Angeles", stamp("2026-11-09T00:00:00Z")).unwrap(), stamp("2026-11-09T17:00:00Z"));
    }
    #[test]
    fn coincident_entries_produce_one_timestamp_and_validate_all_rows() {
        let rules = "0 9 * * 1,3,5\n0 9 * * 1,2,4";
        let monday = next(rules, "UTC", stamp("2026-11-09T00:00:00Z")).unwrap();
        assert_eq!(monday, stamp("2026-11-09T09:00:00Z"));
        assert_eq!(next(rules, "UTC", monday).unwrap(), stamp("2026-11-10T09:00:00Z"));
        assert!(next("0 9 * * *\nbad", "UTC", monday).unwrap_err().starts_with("Schedule 2:"));
        assert!(next("0 9 * * *\n", "UTC", monday).is_err());
        assert!(next(&vec!["0 9 * * *"; 33].join("\n"), "UTC", monday).is_err());
    }
    #[test]
    fn multiple_entries_survive_record_roundtrip_without_migrating_legacy_data() {
        let mut record: Schedule = serde_json::from_value(serde_json::json!({
            "id":"routine", "name":"Review", "project":"removed-project", "account":"removed-account",
            "routing":"fixed", "cron":"0 9 * * 1-5", "timezone":"UTC", "prompt":"Review", "enabled":false
        })).unwrap();
        let after=stamp("2026-11-09T00:00:00Z");
        assert_eq!(next(&record.cron, &record.timezone, after).unwrap(),stamp("2026-11-09T09:00:00Z"));
        record.cron="0 9 * * 1,3,5\n30 15 * * 1,2,4".into();
        let restored: Schedule=serde_json::from_str(&serde_json::to_string(&record).unwrap()).unwrap();
        assert_eq!(restored.cron,record.cron);
        assert!(!restored.enabled);
        assert_eq!(next(&restored.cron, &restored.timezone, after).unwrap(),stamp("2026-11-09T09:00:00Z"));
    }

    fn ending(date: Option<&str>, timezone: &str) -> Schedule {
        serde_json::from_value(serde_json::json!({"id":"routine","name":"Review","project":"removed-project","account":"removed-account","routing":"fixed","cron":"0 9 * * *\n30 23 * * *","timezone":timezone,"prompt":"Review","enabled":true,"end_date":date})).unwrap()
    }
    #[test]
    fn schedule_end_date_is_inclusive_in_its_timezone_and_handles_dst() {
        let routine=ending(Some("2026-11-01"),"America/Los_Angeles");
        assert!(routine.allows_automatic_at(stamp("2026-11-02T07:59:59Z")).unwrap());
        assert!(!routine.allows_automatic_at(stamp("2026-11-02T08:00:00Z")).unwrap());
        assert_eq!(routine.next_automatic(stamp("2026-11-02T06:00:00Z")).unwrap(),Some(stamp("2026-11-02T07:30:00Z")));
        assert_eq!(routine.next_automatic(stamp("2026-11-02T07:30:00Z")).unwrap(),None);
        let spring=ending(Some("2026-03-08"),"America/Los_Angeles");
        assert!(spring.allows_automatic_at(stamp("2026-03-09T06:59:59Z")).unwrap());
        assert!(!spring.allows_automatic_at(stamp("2026-03-09T07:00:00Z")).unwrap());
    }
    #[test]
    fn schedule_end_date_validation_clear_extension_and_persistence() {
        let now=stamp("2026-11-09T00:00:00Z");
        let mut routine=ending(Some("2026-11-08"),"UTC");
        assert_eq!(routine.next_automatic(now).unwrap(),None);
        routine.end_date=Some("2026-11-10".into());
        assert!(routine.next_automatic(now).unwrap().is_some());
        let restored:Schedule=serde_json::from_str(&serde_json::to_string(&routine).unwrap()).unwrap();
        assert_eq!(restored.end_date,routine.end_date);
        routine.end_date=None;
        assert!(routine.next_automatic(now).unwrap().is_some());
        for invalid in ["2026-02-30","2026-1-1",""] {
            routine.end_date=Some(invalid.into());
            assert!(routine.next_automatic(now).is_err());
        }
    }

    #[test]
    fn schedule_run_limit_counts_started_runs_and_reserves_uncertain_dispatch() {
        let mut routine=ending(None,"UTC");
        routine.max_runs=Some(2);
        for (index,state) in ["skipped","missed","blocked"].iter().enumerate() {
            routine.runs.push(Run{id:index.to_string(),due:0,state:state.to_string(),session:None,reason:None,..Default::default()});
        }
        assert!(!routine.run_limit_reached());
        routine.runs.push(Run{id:"started".into(),due:1,state:"failed".into(),session:Some("deleted-session".into()),reason:None,..Default::default()});
        assert!(!routine.run_limit_reached());
        routine.runs.push(Run{id:"unknown".into(),due:2,state:"uncertain".into(),session:None,reason:None,..Default::default()});
        assert!(routine.run_limit_reached());
        assert_eq!(routine.next_automatic(stamp("2026-11-09T00:00:00Z")).unwrap(),None);
        let restored:Schedule=serde_json::from_str(&serde_json::to_string(&routine).unwrap()).unwrap();
        assert!(restored.run_limit_reached());
        routine.max_runs=Some(3);
        assert!(routine.next_automatic(stamp("2026-11-09T00:00:00Z")).unwrap().is_some());
        routine.max_runs=Some(0);
        assert!(routine.validate_stop().is_err());
        routine.max_runs=Some(1);
        routine.end_date=Some("2027-01-01".into());
        assert!(routine.validate_stop().is_err());
    }

    fn routine_thread() -> Session {
        serde_json::from_value(serde_json::json!({"id":"thread","project":"removed-project","account":"removed-account","title":"Existing thread","status":"done","updated":1,"provider_id":"existing-provider-session","messages":[],"pending":null,"error":null,"requests":["first"]})).unwrap()
    }
    #[test]
    fn schedule_thread_target_preserves_binding_and_rejects_unavailable_threads() {
        let mut routine=ending(None,"UTC");
        let mut thread=routine_thread();
        assert!(routine.target_thread(&[thread.clone()]).unwrap().is_none());
        routine.new_chat=false;
        assert!(routine.target_thread(&[thread.clone()]).is_err());
        routine.thread=Some(thread.id.clone());
        assert_eq!(routine.target_thread(&[thread.clone()]).unwrap().unwrap().account,"removed-account");
        thread.project="another-project".into();
        assert!(routine.target_thread(&[thread.clone()]).is_err());
        thread.project=routine.project.clone();
        thread.archived=true;
        assert!(routine.target_thread(&[thread.clone()]).is_err());
        thread.archived=false; thread.provider_id=None;
        assert!(routine.target_thread(&[thread]).is_err());
    }
    #[test]
    fn schedule_important_notifications_quiet_success_attention_and_dedup() {
        let mut quiet=Run {id:"quiet".into(),state:"done".into(),..Default::default()};
        quiet.queue_notice("Review",Some("important"),"No important updates.");
        assert!(quiet.notices.is_empty());
        quiet.queue_notice("Review",Some("all"),"No important updates.");
        assert_eq!(quiet.notices.len(),1);
        quiet.queue_notice("Review",Some("all"),"No important updates.");
        assert_eq!(quiet.notices.len(),1);
        for state in ["waiting","failed","blocked","interrupted","uncertain"] {
            let mut run=Run{id:state.into(),state:state.into(),..Default::default()};
            run.queue_notice("Review",Some("important"),"");
            assert_eq!(run.notices.len(),1);
        }
        let mut finding=Run {id:"finding".into(),state:"done".into(),..Default::default()};
        finding.queue_notice("Review",None,"Action required");
        assert!(finding.notices.is_empty());
        finding.queue_notice("Review",Some("important"),"Action required");
        assert_eq!(finding.notices[0].body,"Action required");
    }
    #[test]
    fn schedule_reused_thread_freezes_history_and_reads_only_current_turn() {
        let mut routine=ending(None,"UTC");
        routine.notifications=Some("important".into());
        routine.runs.push(Run{id:"first".into(),state:"starting".into(),..Default::default()});
        let mut thread=routine_thread();
        thread.messages=vec![
            crate::runtime::Message{id:"u1".into(),role:"user".into(),text:"Check".into(),attachments:vec![]},
            crate::runtime::Message{id:"a1".into(),role:"assistant".into(),text:"Action required".into(),attachments:vec![]}
        ];
        routine.observe_session(&thread);
        assert!(routine.runs[0].finished);
        assert_eq!(routine.runs[0].notices.len(),1);
        routine.runs.push(Run{id:"second".into(),state:"starting".into(),..Default::default()});
        thread.requests.push("second".into());
        thread.status="running".into();
        routine.observe_session(&thread);
        assert_eq!(routine.runs[0].state,"done");
        thread.messages.push(crate::runtime::Message{id:"u2".into(),role:"user".into(),text:"Check again".into(),attachments:vec![]});
        thread.messages.push(crate::runtime::Message{id:"a2".into(),role:"assistant".into(),text:"No important updates.".into(),attachments:vec![]});
        thread.status="done".into();
        routine.observe_session(&thread);
        assert!(routine.runs[1].notices.is_empty());
        assert!(routine.runs[1].finished);
        routine.max_runs=Some(2);
        assert!(routine.run_limit_reached());
    }

}
