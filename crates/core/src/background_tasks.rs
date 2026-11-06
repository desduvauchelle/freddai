//! Background sub-agents and background shell commands (Bash `run_in_background`, Monitor) started by a Claude Code turn.
//!
//! Claude Code answers `result` for the main agent while `Agent` calls made with `run_in_background`
//! keep running, then wakes the main agent with a `<task-notification>` when they finish. The thread is
//! only finished after every such task has reported back and the main agent has answered again.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::time::{Duration, Instant};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BackgroundTask {
    pub id: String,
    #[serde(default)]
    pub tool_use_id: Option<String>,
    pub description: String,
    /// Sub-agent type, e.g. `general-purpose`.
    #[serde(default)]
    pub kind: Option<String>,
    /// `running`, `completed`, `failed` or `stopped`.
    pub status: String,
    #[serde(default)]
    pub summary: Option<String>,
    /// Stopped because Freddai/the agent process went away mid-run (not finished, not failed by itself):
    /// the next resume asks the main agent to restart it.
    #[serde(default)]
    pub interrupted: bool,
}

/// Summaries older versions wrote for interruption-stopped rows (they had no `interrupted` flag).
const LEGACY_INTERRUPTED: [&str; 3] = [
    "Freddai closed while this sub-agent was running.",
    "Interrupted by a Freddai update.",
    "Stopped with the thread.",
];

impl BackgroundTask {
    pub fn stopped_by_interruption(&self) -> bool {
        self.status == "stopped"
            && (self.interrupted
                || self
                    .summary
                    .as_deref()
                    .is_some_and(|s| LEGACY_INTERRUPTED.contains(&s)))
    }
}

/// Marks running tasks as stopped by an interruption (host restart, upgrade, thread stop).
pub fn mark_interrupted(tasks: &mut [BackgroundTask], summary: &str) {
    for t in tasks.iter_mut().filter(|t| t.status == "running") {
        t.status = "stopped".into();
        t.interrupted = true;
        t.summary = Some(summary.into());
    }
}

/// Claude Code does not restart sub-agents when a session is resumed, so tell the main agent which ones died.
/// Returns the text to prepend to the prompt and clears the interruption marker so it is only sent once.
pub fn take_resume_preface(tasks: &mut [BackgroundTask]) -> Option<String> {
    let lost: Vec<&mut BackgroundTask> = tasks
        .iter_mut()
        .filter(|t| t.stopped_by_interruption())
        .collect();
    if lost.is_empty() {
        return None;
    }
    let mut text = String::from("Freddai restarted while these background sub-agents were running; they were stopped before finishing:\n");
    for t in lost {
        text.push_str(&format!(
            "- {} ({}, agentId {})\n",
            t.description,
            t.kind.as_deref().unwrap_or("sub-agent"),
            t.id
        ));
        t.interrupted = false;
        t.summary = Some("Interrupted earlier; the main agent was asked to resume it.".into());
    }
    text.push_str("Resume each one now in the background (SendMessage to its agentId resumes it from its transcript; if that isn't possible, relaunch it with the same task), then continue with the request below.");
    Some(text)
}

#[derive(Debug, PartialEq)]
pub(crate) enum Settle {
    Finish,
    /// Background tasks are still running: keep the process, the stream and the thread status alive.
    Hold,
}

#[derive(Default)]
pub(crate) struct Tracker {
    tasks: Vec<BackgroundTask>,
    /// tool_use id -> (description, sub-agent type) for every `Agent`/`Task` call seen this turn.
    launches: HashMap<String, (String, Option<String>)>,
    /// tool_use id -> (description, kind) for every Bash `run_in_background`/auto-backgrounded call and `Monitor` call seen this turn.
    shell_launches: HashMap<String, (String, &'static str)>,
    /// Bash tool_use ids launched without `run_in_background` (tracked only if the CLI backgrounds them anyway).
    foreground: std::collections::HashSet<String>,
    /// tool_use id of a `SendMessage` -> the background agent it addresses.
    resumes: HashMap<String, String>,
    result_seen: bool,
    /// Set once the last task reported back after a `result`; the main agent should now be woken.
    wake_since: Option<Instant>,
}

fn terminal(status: &str) -> Option<&'static str> {
    match status {
        "completed" | "complete" | "done" | "success" => Some("completed"),
        "failed" | "error" | "errored" => Some("failed"),
        "stopped" | "killed" | "cancelled" | "canceled" | "interrupted" => Some("stopped"),
        _ => None,
    }
}

fn tag<'a>(text: &'a str, name: &str) -> Option<&'a str> {
    let open = format!("<{name}>");
    let start = text.find(&open)? + open.len();
    let end = text[start..].find(&format!("</{name}>"))? + start;
    Some(text[start..end].trim())
}

fn texts(content: &Value) -> Vec<String> {
    match content {
        Value::String(s) => vec![s.clone()],
        Value::Array(blocks) => blocks
            .iter()
            .flat_map(|b| {
                if b["type"] == "tool_result" {
                    texts(&b["content"])
                } else {
                    b["text"]
                        .as_str()
                        .map(|s| vec![s.to_owned()])
                        .unwrap_or_default()
                }
            })
            .collect(),
        _ => vec![],
    }
}

impl Tracker {
    /// A tracker that already knows the thread's earlier sub-agents, so a resumed turn can flip them back to running.
    pub(crate) fn seeded(tasks: Vec<BackgroundTask>) -> Self {
        Self {
            tasks,
            ..Self::default()
        }
    }
    pub(crate) fn tasks(&self) -> &[BackgroundTask] {
        &self.tasks
    }
    pub(crate) fn pending(&self) -> usize {
        self.tasks.iter().filter(|t| t.status == "running").count()
    }
    pub(crate) fn pending_names(&self) -> Vec<String> {
        self.tasks
            .iter()
            .filter(|t| t.status == "running")
            .map(|t| t.description.clone())
            .collect()
    }

    /// A stopped/failed/completed sub-agent is running again (SendMessage resume or relaunch).
    fn revive(&mut self, id: &str) -> bool {
        let Some(task) = self
            .tasks
            .iter_mut()
            .find(|t| t.id == id && t.status != "running")
        else {
            return false;
        };
        task.status = "running".into();
        task.interrupted = false;
        task.summary = None;
        true
    }

    fn start(
        &mut self,
        id: &str,
        tool_use_id: Option<&str>,
        description: Option<&str>,
        kind: Option<&str>,
    ) -> bool {
        // Same agent id launched/announced by a different tool call than the one that created the row: a resume.
        if self.tasks.iter().any(|t| {
            t.id == id
                && t.status != "running"
                && (tool_use_id.is_none() || t.tool_use_id.as_deref() != tool_use_id)
        }) {
            return self.revive(id);
        }
        if self.tasks.iter().any(|t| {
            t.id == id || (tool_use_id.is_some() && t.tool_use_id.as_deref() == tool_use_id)
        }) {
            return false;
        }
        let launch = tool_use_id.and_then(|t| self.launches.get(t)).cloned();
        let description = description
            .filter(|d| !d.is_empty())
            .map(str::to_owned)
            .or_else(|| launch.as_ref().map(|l| l.0.clone()))
            .or_else(|| {
                tool_use_id
                    .and_then(|t| self.shell_launches.get(t))
                    .map(|l| l.0.clone())
            })
            .unwrap_or_else(|| {
                if kind.is_some_and(|k| k == "bash" || k == "monitor") {
                    "Background command".into()
                } else {
                    "Sub-agent".into()
                }
            });
        let kind = kind.map(str::to_owned).or_else(|| launch.and_then(|l| l.1));
        self.tasks.push(BackgroundTask {
            id: id.into(),
            tool_use_id: tool_use_id.map(str::to_owned),
            description,
            kind,
            status: "running".into(),
            summary: None,
            interrupted: false,
        });
        true
    }

    fn finish(&mut self, id: &str, status: &str, summary: Option<&str>) -> bool {
        let Some(status) = terminal(status) else {
            return false;
        };
        let Some(task) = self.tasks.iter_mut().find(|t| t.id == id) else {
            return false;
        };
        if task.status == status && summary.is_none() {
            return false;
        }
        task.status = status.into();
        if let Some(s) = summary.filter(|s| !s.is_empty()) {
            task.summary = Some(s.chars().take(300).collect());
        }
        true
    }

    /// Feed one stream-json frame. Returns true when the task list changed.
    pub(crate) fn observe(&mut self, frame: &Value, now: Instant) -> bool {
        let before = self.pending();
        let changed = self.apply(frame);
        if self.result_seen && before > 0 && self.pending() == 0 {
            self.wake_since = Some(now);
        }
        // A new model turn after the wake-up means the main agent is answering.
        if self.result_seen
            && matches!(frame["type"].as_str(), Some("assistant" | "stream_event"))
            && frame["parent_tool_use_id"].is_null()
        {
            self.wake_since = None;
        }
        changed
    }

    fn apply(&mut self, frame: &Value) -> bool {
        match frame["type"].as_str() {
            Some("assistant") => {
                for b in frame["message"]["content"].as_array().into_iter().flatten() {
                    if b["type"] == "tool_use" && b["name"] == "SendMessage" {
                        if let (Some(id), Some(to)) = (b["id"].as_str(), b["input"]["to"].as_str())
                        {
                            if self.tasks.iter().any(|t| t.id == to) {
                                self.resumes.insert(id.into(), to.into());
                            }
                        }
                    }
                    if b["type"] == "tool_use" && matches!(b["name"].as_str(), Some("Bash" | "Monitor"))
                    {
                        let monitor = b["name"] == "Monitor";
                        // A plain foreground Bash call is only recorded so an auto-backgrounded one can be recognised from its result.
                        if let Some(id) = b["id"].as_str() {
                            let description = b["input"]["description"]
                                .as_str()
                                .filter(|d| !d.trim().is_empty())
                                .or_else(|| b["input"]["command"].as_str())
                                .unwrap_or("Background command");
                            self.shell_launches.insert(
                                id.into(),
                                (
                                    description.chars().take(120).collect(),
                                    if monitor { "monitor" } else { "bash" },
                                ),
                            );
                            if !monitor && b["input"]["run_in_background"] != true {
                                self.foreground.insert(id.into());
                            }
                        }
                    }
                    if b["type"] == "tool_use"
                        && matches!(b["name"].as_str(), Some("Agent" | "Task"))
                    {
                        if let Some(id) = b["id"].as_str() {
                            self.launches.insert(
                                id.into(),
                                (
                                    b["input"]["description"]
                                        .as_str()
                                        .unwrap_or("Sub-agent")
                                        .into(),
                                    b["input"]["subagent_type"].as_str().map(str::to_owned),
                                ),
                            );
                        }
                    }
                }
                false
            }
            Some("system") => match frame["subtype"].as_str() {
                Some("task_started") => {
                    let tool = frame["tool_use_id"].as_str();
                    let kind = frame["task_type"].as_str();
                    let agent_like = tool.is_some_and(|t| self.launches.contains_key(t))
                        || kind.is_some_and(|k| k.contains("agent"));
                    // Background Bash / Monitor: nothing else wakes the agent when they end, so the turn must wait for them.
                    let shell = tool
                        .and_then(|t| self.shell_launches.get(t))
                        .filter(|_| tool.is_some_and(|t| !self.foreground.contains(t)))
                        .map(|l| l.1)
                        .or_else(|| {
                            kind.filter(|k| k.contains("monitor")).map(|_| "monitor")
                        });
                    match frame["task_id"].as_str() {
                        Some(id) if agent_like => {
                            self.start(id, tool, frame["description"].as_str(), None)
                        }
                        Some(id) if shell.is_some() => {
                            self.start(id, tool, frame["description"].as_str(), shell)
                        }
                        _ => false,
                    }
                }
                Some("task_notification") => frame["task_id"].as_str().is_some_and(|id| {
                    self.finish(
                        id,
                        frame["status"].as_str().unwrap_or(""),
                        frame["summary"].as_str(),
                    )
                }),
                Some("task_updated") => frame["task_id"].as_str().is_some_and(|id| {
                    self.finish(id, frame["patch"]["status"].as_str().unwrap_or(""), None)
                }),
                _ => false,
            },
            Some("user") => {
                let mut changed = false;
                for b in frame["message"]["content"].as_array().into_iter().flatten() {
                    let Some(tool) = b["tool_use_id"]
                        .as_str()
                        .filter(|_| b["type"] == "tool_result")
                    else {
                        continue;
                    };
                    if let Some(agent) = self.resumes.get(tool).cloned() {
                        // SendMessage to a finished agent answers `{"success":true,"message":"Resuming agent …","resumedAgentId":"<id>"}`.
                        if texts(&b["content"])
                            .iter()
                            .any(|t| t.contains("Resuming agent") || t.contains("resumedAgentId"))
                        {
                            changed |= self.revive(&agent);
                        }
                        continue;
                    }
                    if let Some((description, kind)) = self.shell_launches.get(tool).cloned() {
                        // "Command running in background with ID: <id>. Output is being written to: …" (explicit or auto-backgrounded).
                        for text in texts(&b["content"]) {
                            if let Some(rest) = text.split("running in background with ID:").nth(1) {
                                if let Some(id) = rest
                                    .split_whitespace()
                                    .next()
                                    .map(|i| i.trim_end_matches(['.', ',']))
                                    .filter(|i| !i.is_empty())
                                {
                                    changed |= self.start(id, Some(tool), Some(&description), Some(kind));
                                }
                            }
                        }
                        continue;
                    }
                    if !self.launches.contains_key(tool) {
                        continue;
                    }
                    for text in texts(&b["content"]) {
                        // "Async agent launched successfully. … agentId: <id> …"
                        if text.contains("Async agent launched") {
                            if let Some(rest) = text.split("agentId:").nth(1) {
                                if let Some(id) = rest.split_whitespace().next() {
                                    changed |= self.start(id, Some(tool), None, None);
                                }
                            }
                        }
                    }
                }
                for text in texts(&frame["message"]["content"]) {
                    if let (Some(id), Some(status)) = (tag(&text, "task-id"), tag(&text, "status"))
                    {
                        changed |= self.finish(id, status, tag(&text, "summary"));
                    }
                }
                changed
            }
            _ => false,
        }
    }

    /// The main agent produced a `result`. Hold while any background task is still running.
    pub(crate) fn on_result(&mut self) -> Settle {
        self.result_seen = true;
        if self.pending() > 0 {
            Settle::Hold
        } else {
            Settle::Finish
        }
    }

    /// All tasks reported back but the main agent never produced its follow-up `result`.
    pub(crate) fn wake_overdue(&self, grace: Duration, now: Instant) -> bool {
        self.wake_since
            .is_some_and(|t| now.duration_since(t) > grace)
    }

    /// The process ended while tasks were pending. Returns how many tasks were marked.
    pub(crate) fn fail_pending(&mut self, status: &str, summary: &str) -> usize {
        let mut n = 0;
        for t in self.tasks.iter_mut().filter(|t| t.status == "running") {
            t.status = status.into();
            t.interrupted = status == "stopped";
            t.summary = Some(summary.into());
            n += 1;
        }
        n
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn launch(t: &mut Tracker, tool: &str, agent: &str) {
        let now = Instant::now();
        t.observe(&json!({"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":tool,"name":"Agent","input":{"description":"Show subagents","subagent_type":"general-purpose","run_in_background":true}}]}}), now);
        t.observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":tool,"content":[{"type":"text","text":format!("Async agent launched successfully.\nagentId: {agent} (internal ID)")}]}]}}), now);
    }
    fn notify(t: &mut Tracker, agent: &str, status: &str) {
        t.observe(&json!({"type":"system","subtype":"task_notification","task_id":agent,"status":status,"summary":"done"}), Instant::now());
    }

    #[test]
    fn pending_background_agent_keeps_the_turn_open_until_it_reports_and_the_main_agent_answers() {
        let mut t = Tracker::default();
        launch(&mut t, "toolu_1", "a1");
        assert_eq!(t.tasks()[0].description, "Show subagents");
        assert_eq!(t.tasks()[0].kind.as_deref(), Some("general-purpose"));
        assert_eq!(t.on_result(), Settle::Hold); // first result with a running task is not terminal
        notify(&mut t, "a1", "completed");
        assert_eq!(t.pending(), 0);
        assert!(!t.wake_overdue(Duration::from_secs(60), Instant::now()));
        assert!(t.wake_overdue(
            Duration::from_secs(60),
            Instant::now() + Duration::from_secs(61)
        ));
        t.observe(
            &json!({"type":"assistant","message":{"id":"m2","content":[]}}),
            Instant::now(),
        );
        assert!(!t.wake_overdue(
            Duration::from_secs(60),
            Instant::now() + Duration::from_secs(600)
        ));
        assert_eq!(t.on_result(), Settle::Finish);
        assert_eq!(t.tasks()[0].status, "completed");
    }

    #[test]
    fn system_task_events_and_text_notifications_are_equivalent_and_idempotent() {
        let mut t = Tracker::default();
        let now = Instant::now();
        t.observe(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"tu","name":"Task","input":{"description":"Scan","subagent_type":"Explore"}}]}}), now);
        assert!(t.observe(&json!({"type":"system","subtype":"task_started","task_id":"x","tool_use_id":"tu","description":"Scan repo","task_type":"local_agent"}), now));
        assert!(!t.observe(
            &json!({"type":"system","subtype":"task_started","task_id":"x","tool_use_id":"tu"}),
            now
        ));
        // A task with no known background launch (e.g. a foreground command) is not tracked.
        assert!(!t.observe(&json!({"type":"system","subtype":"task_started","task_id":"sh","task_type":"local_bash"}), now));
        assert_eq!(t.tasks().len(), 1);
        assert_eq!(t.tasks()[0].description, "Scan repo");
        assert!(t.observe(&json!({"type":"user","message":{"role":"user","content":"<task-notification>\n<task-id>x</task-id>\n<status>failed</status>\n<summary>Boom</summary>\n</task-notification>"}}), now));
        assert_eq!(
            (
                t.tasks()[0].status.as_str(),
                t.tasks()[0].summary.as_deref()
            ),
            ("failed", Some("Boom"))
        );
        assert_eq!(t.on_result(), Settle::Finish);
        let mut u = Tracker::default();
        u.observe(&json!({"type":"system","subtype":"task_started","task_id":"y","task_type":"local_agent","description":"D"}), now);
        assert!(u.observe(&json!({"type":"system","subtype":"task_updated","task_id":"y","patch":{"status":"killed"}}), now));
        assert_eq!(u.tasks()[0].status, "stopped");
    }

    fn bash_launch(t: &mut Tracker, tool: &str, background: bool) {
        t.observe(&json!({"type":"assistant","message":{"id":"m","content":[{"type":"tool_use","id":tool,"name":"Bash","input":{"command":"until ! pgrep job; do sleep 5; done","description":"Wait for the audit run","run_in_background":background}}]}}), Instant::now());
    }

    #[test]
    fn background_bash_holds_the_turn_until_its_notification() {
        let now = Instant::now();
        let mut t = Tracker::default();
        bash_launch(&mut t, "tb", true);
        assert!(t.observe(&json!({"type":"system","subtype":"task_started","task_id":"ba3","tool_use_id":"tb","task_type":"local_bash","description":"Wait for the audit run"}), now));
        // The tool_result announcing the same id is idempotent.
        assert!(!t.observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tb","content":"Command running in background with ID: ba3. Output is being written to: /tmp/x.output."}]}}), now));
        assert_eq!(t.tasks().len(), 1);
        assert_eq!(t.tasks()[0].kind.as_deref(), Some("bash"));
        assert_eq!(t.pending_names(), vec!["Wait for the audit run"]);
        assert_eq!(t.on_result(), Settle::Hold);
        assert!(t.observe(&json!({"type":"system","subtype":"task_notification","task_id":"ba3","status":"completed","summary":"done"}), now));
        assert_eq!(t.pending(), 0);
        // The agent answers the wake-up, then the turn finishes normally.
        t.observe(&json!({"type":"assistant","message":{"id":"m2","content":[]}}), now);
        assert_eq!(t.on_result(), Settle::Finish);
    }

    #[test]
    fn background_bash_is_tracked_from_its_tool_result_alone_and_released_by_task_updated() {
        let now = Instant::now();
        let mut t = Tracker::default();
        // Auto-backgrounded: the call was not marked run_in_background, only the result says so.
        bash_launch(&mut t, "tb", false);
        assert!(!t.observe(&json!({"type":"system","subtype":"task_started","task_id":"b1","tool_use_id":"tb","task_type":"local_bash"}), now));
        assert!(t.observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tb","content":[{"type":"text","text":"Command running in background with ID: b1. Output is being written to: /tmp/b1.output."}]}]}}), now));
        assert_eq!(t.on_result(), Settle::Hold);
        assert!(t.observe(&json!({"type":"system","subtype":"task_updated","task_id":"b1","patch":{"status":"killed"}}), now));
        assert_eq!(t.tasks()[0].status, "stopped");
        assert_eq!(t.pending(), 0);
        // A foreground command that simply finished never holds the turn.
        let mut u = Tracker::default();
        bash_launch(&mut u, "tf", false);
        u.observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"tf","content":"ok"}]}}), now);
        assert_eq!(u.on_result(), Settle::Finish);
    }

    #[test]
    fn monitor_task_holds_the_turn_and_ignores_non_terminal_events() {
        let now = Instant::now();
        let mut t = Tracker::default();
        t.observe(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"tm","name":"Monitor","input":{"description":"Watch deploy","command":"tail -f log"}}]}}), now);
        assert!(t.observe(&json!({"type":"system","subtype":"task_started","task_id":"m1","tool_use_id":"tm","task_type":"monitor"}), now));
        assert_eq!(t.tasks()[0].description, "Watch deploy");
        assert!(!t.observe(&json!({"type":"user","message":{"role":"user","content":"<task-notification>\n<task-id>m1</task-id>\n<summary>line</summary>\n</task-notification>"}}), now));
        assert_eq!(t.on_result(), Settle::Hold);
    }

    #[test]
    fn process_exit_with_pending_tasks_marks_them_failed() {
        let mut t = Tracker::default();
        launch(&mut t, "toolu_1", "a1");
        launch(&mut t, "toolu_2", "a2");
        notify(&mut t, "a2", "completed");
        assert_eq!(t.pending_names(), vec!["Show subagents"]);
        assert_eq!(t.fail_pending("failed", "Agent process ended"), 1);
        assert_eq!(t.pending(), 0);
        assert_eq!(
            (t.tasks()[0].status.as_str(), t.tasks()[1].status.as_str()),
            ("failed", "completed")
        );
    }

    fn task(id: &str, status: &str, interrupted: bool) -> BackgroundTask {
        BackgroundTask {
            id: id.into(),
            tool_use_id: None,
            description: format!("Task {id}"),
            kind: Some("general-purpose".into()),
            status: status.into(),
            summary: None,
            interrupted,
        }
    }

    #[test]
    fn resume_preface_lists_only_interrupted_sub_agents_with_ids_and_is_sent_once() {
        let mut tasks = vec![
            task("a1", "stopped", true),
            task("a2", "completed", false),
            task("a3", "failed", false),
            task("a4", "stopped", false),
            task("a5", "running", false),
        ];
        let mut legacy = task("a6", "stopped", false);
        legacy.summary = Some("Freddai closed while this sub-agent was running.".into());
        tasks.push(legacy);
        let text = take_resume_preface(&mut tasks).unwrap();
        assert!(
            text.contains("Task a1 (general-purpose, agentId a1)")
                && text.contains("agentId a6")
                && text.contains("SendMessage")
        );
        for other in ["a2", "a3", "a4", "a5"] {
            assert!(
                !text.contains(&format!("agentId {other}")),
                "{other} leaked into {text}"
            );
        }
        assert!(take_resume_preface(&mut tasks).is_none());
        let mut done = vec![task("x", "completed", false)];
        assert!(take_resume_preface(&mut done).is_none());
    }

    #[test]
    fn send_message_resume_or_relaunch_turns_a_stopped_row_back_into_a_held_running_task() {
        let now = Instant::now();
        let mut t = Tracker::seeded(vec![
            task("a1", "stopped", true),
            task("a2", "stopped", true),
        ]);
        // The injected "stopped" notification for an already-stopped row changes nothing material.
        notify(&mut t, "a1", "stopped");
        assert_eq!(t.on_result(), Settle::Finish);
        let mut t = Tracker::seeded(vec![
            task("a1", "stopped", true),
            task("a2", "stopped", true),
        ]);
        t.observe(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"sm1","name":"SendMessage","input":{"to":"a1","message":"resume"}}]}}), now);
        assert!(t.observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"sm1","content":[{"type":"text","text":"{\"success\":true,\"message\":\"Resuming agent a1\",\"resumedAgentId\":\"a1\"}"}]}]}}), now));
        assert_eq!(t.pending_names(), vec!["Task a1"]);
        assert_eq!(t.on_result(), Settle::Hold);
        notify(&mut t, "a1", "completed");
        assert_eq!(t.pending(), 0);
        // A relaunch announced with the same agent id by a new Agent call revives the other row.
        launch(&mut t, "toolu_9", "a2");
        assert_eq!(
            t.tasks().iter().find(|x| x.id == "a2").unwrap().status,
            "running"
        );
        assert_eq!(t.tasks().len(), 2);
        // A failed SendMessage does not revive anything.
        let mut u = Tracker::seeded(vec![task("a1", "stopped", true)]);
        u.observe(&json!({"type":"assistant","message":{"content":[{"type":"tool_use","id":"sm","name":"SendMessage","input":{"to":"a1"}}]}}), now);
        assert!(!u.observe(&json!({"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"sm","content":"no such agent","is_error":true}]}}), now));
        assert_eq!(u.pending(), 0);
    }
}
