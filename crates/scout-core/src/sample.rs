//! Sample board from the Figma home (docs/scout.md, `scout_sample_data`).
use crate::model::*;
use crate::store::{place, repack_all};
use chrono::{DateTime, Utc};

pub const SAMPLE_ACCOUNT: &str = "sample-account";

const WORKSPACES: &[(&str, &str, &str)] = &[
    ("sample-livecase", "LiveCase", "#3b82f6"),
    ("sample-recursive", "Recursive Solutions", "#7c5cff"),
    ("sample-freddai", "Freddai", "#f0582c"),
    ("sample-school-pa", "School PA", "#f5a524"),
    ("sample-home", "Home", "#2fb344"),
];

// (id, workspace, name, pinned)
const PROJECTS: &[(&str, &str, &str, bool)] = &[
    ("sample-sales", "sample-livecase", "Sales", true),
    ("sample-support", "sample-livecase", "Support", false),
    ("sample-code", "sample-livecase", "Code", false),
    ("sample-clients", "sample-recursive", "Clients", true),
    ("sample-delivery", "sample-recursive", "Delivery", false),
    ("sample-build", "sample-freddai", "Build", true),
    ("sample-community", "sample-freddai", "Community", false),
    ("sample-board", "sample-school-pa", "Board", false),
    ("sample-family", "sample-home", "Family", true),
];

use ItemKind::*;
use ItemStatus::*;
use Lane::*;

// (project, kind, title, lane, status, subtitle)
type Row = (&'static str, ItemKind, &'static str, Lane, ItemStatus, Option<&'static str>);
const ITEMS: &[Row] = &[
    ("sample-sales", Email, "Reply to Acme about pricing", Focus, NeedsYou, Some("Gmail · you@livecase.example · draft ready")),
    ("sample-sales", Meeting, "Demo with Northwind", Focus, AgentWorking, Some("Thu 2:00 PM · Google Meet")),
    ("sample-sales", Task, "Trial follow-up sequence", Backlog, Ready, Option::None),
    ("sample-sales", Task, "Update the pipeline sheet", Backlog, None, Option::None),
    ("sample-sales", Email, "Send the Q3 recap to Globex", Done, None, Option::None),
    ("sample-support", Code, "Fix login redirect loop", Focus, Ready, Option::None),
    ("sample-support", Email, "School asks about SSO", Focus, NeedsYou, Option::None),
    ("sample-support", Task, "Refund request", Backlog, None, Option::None),
    ("sample-support", Task, "Answer 4 tickets", Backlog, None, Option::None),
    ("sample-code", Code, "Add Stripe webhook retries", Focus, AgentWorking, Option::None),
    ("sample-code", Code, "Bump Next.js to 15", Backlog, None, Option::None),
    ("sample-code", Code, "Clean up feature flags", Backlog, None, Option::None),
    ("sample-clients", Email, "Proposal for a new client", Focus, AgentWorking, Option::None),
    ("sample-clients", Contact, "Sam, design studio founder", Focus, Ready, Option::None),
    ("sample-clients", Task, "Send September invoice", Backlog, None, Option::None),
    ("sample-clients", Note, "Kickoff notes", Backlog, None, Option::None),
    ("sample-delivery", Code, "Migrate auth to Clerk", Backlog, None, Option::None),
    ("sample-delivery", Task, "QA checklist", Backlog, None, Option::None),
    ("sample-delivery", Note, "Launch notes", Backlog, None, Option::None),
    ("sample-delivery", Task, "Hand over staging access", Done, None, Option::None),
    ("sample-build", Code, "Review PR #42 · sync engine", Focus, NeedsYou, Option::None),
    ("sample-build", Code, "Ship onboarding step 3 UI", Focus, Ready, Option::None),
    ("sample-build", Task, "Wire the chat toggle", Backlog, None, Option::None),
    ("sample-build", Code, "Write tests for rules engine", Backlog, None, Option::None),
    ("sample-build", Code, "Fix voice note upload", Done, None, Option::None),
    ("sample-community", Note, "3 feature requests from Discord", Focus, NeedsYou, Option::None),
    ("sample-community", Task, "Welcome new members", Backlog, None, Option::None),
    ("sample-board", Meeting, "Board meeting Tuesday", Focus, NeedsYou, Some("Tue 7:00 PM · school library")),
    ("sample-board", Note, "Budget draft", Backlog, None, Option::None),
    ("sample-board", Note, "Minutes from October", Backlog, None, Option::None),
    ("sample-family", Task, "Book the dentist for the kids", Focus, NeedsYou, Option::None),
    ("sample-family", Email, "School photo order form", Focus, Ready, Option::None),
    ("sample-family", Task, "Renew car insurance", Backlog, None, Option::None),
    ("sample-family", Task, "Plan the weekend", Backlog, None, Option::None),
    ("sample-family", Task, "Pay the swim club fee", Done, None, Option::None),
];

/// Replace any previous sample data with a fresh sample board. `account` is the Freddai
/// account the sample sources point at (callers pass the first account, else
/// [`SAMPLE_ACCOUNT`]).
pub fn load_sample(state: &mut ScoutState, now: DateTime<Utc>, account: &str) {
    clear_sample(state);
    let ts = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    for (id, name, color) in WORKSPACES {
        let w = Workspace { id: id.to_string(), name: name.to_string(), color: color.to_string(), order: UNSET_ORDER, collapsed: false };
        place(&mut state.workspaces, w, |_| String::new());
    }
    for (id, ws, name, pinned) in PROJECTS {
        let color = WORKSPACES.iter().find(|w| w.0 == *ws).map(|w| w.2).unwrap_or_default();
        let p = Project {
            id: id.to_string(),
            workspace: ws.to_string(),
            name: name.to_string(),
            color: color.to_string(),
            order: UNSET_ORDER,
            pinned: *pinned,
            hidden: false,
            freddai_project: Option::None,
        };
        place(&mut state.projects, p, |p| p.workspace.clone());
    }
    for (n, (project, kind, title, lane, status, subtitle)) in ITEMS.iter().enumerate() {
        let it = Item {
            id: format!("sample-item-{}", n + 1),
            project: project.to_string(),
            kind: *kind,
            title: title.to_string(),
            subtitle: subtitle.map(str::to_string),
            lane: *lane,
            status: *status,
            source: Option::None,
            origin: Origin::Sample,
            thread: Option::None,
            order: UNSET_ORDER,
            created: ts.clone(),
            updated: ts.clone(),
            done_at: (*lane == Done).then(|| ts.clone()),
        };
        place(&mut state.items, it, |i| format!("{}\u{0}{:?}", i.project, i.lane));
    }
    let rules = [
        ("sample-rule-cold-outreach", "Cold outreach replies", "an email replies to a cold outreach", "draft a follow-up and put it in Focus"),
        ("sample-rule-meeting-notes", "Meeting notes", "a Google Meet ends", "summarise and add action items to Backlog"),
    ];
    for (id, name, when, then) in rules {
        let r = Rule { id: id.into(), name: name.into(), when_text: when.into(), then_text: then.into(), enabled: true, project: Option::None, order: UNSET_ORDER };
        place(&mut state.rules, r, |_| String::new());
    }
    let sources = [
        ("sample-source-gmail", SourceKind::Gmail, "Gmail", "you@livecase.example", SourceAccess::Direct, SourceStatus::Connected),
        ("sample-source-slack", SourceKind::Slack, "Slack", "LiveCase workspace", SourceAccess::Direct, SourceStatus::Connected),
        ("sample-source-meet", SourceKind::Meet, "Google Meet", "you@livecase.example", SourceAccess::ComputerUse, SourceStatus::NeedsSignIn),
    ];
    for (id, kind, label, detail, access, status) in sources {
        state.sources.push(Source { id: id.into(), account: account.into(), kind, label: label.into(), detail: detail.into(), access, enabled: true, status });
    }
    state.settings.sample_data = true;
    repack_all(state);
}

/// Remove sample items, rules and sources, then sample projects and workspaces that end
/// up empty (anything the user added inside them is kept). Clears the flag.
pub fn clear_sample(state: &mut ScoutState) {
    let sample = |id: &str| id.starts_with("sample-");
    state.items.retain(|i| i.origin != Origin::Sample);
    state.rules.retain(|r| !sample(&r.id));
    state.sources.retain(|s| !sample(&s.id));
    let used: Vec<String> = state.items.iter().map(|i| i.project.clone()).collect();
    state.projects.retain(|p| !sample(&p.id) || used.contains(&p.id));
    let used: Vec<String> = state.projects.iter().map(|p| p.workspace.clone()).collect();
    state.workspaces.retain(|w| !sample(&w.id) || used.contains(&w.id));
    let live: Vec<String> = state.projects.iter().map(|p| p.id.clone()).collect();
    state.rules.iter_mut().for_each(|r| {
        if r.project.as_ref().is_some_and(|p| !live.contains(p)) {
            r.project = Option::None
        }
    });
    state.settings.sample_data = false;
    repack_all(state);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_then_clear() {
        let mut st = ScoutState::default();
        st.workspaces.push(Workspace { id: "mine".into(), name: "Mine".into(), ..Default::default() });
        load_sample(&mut st, Utc::now(), "acct");
        assert!(st.settings.sample_data);
        assert_eq!(st.workspaces.len(), 6);
        assert_eq!(st.projects.len(), 9);
        assert_eq!(st.projects.iter().filter(|p| p.pinned).count(), 4);
        assert_eq!(st.items.len(), 35);
        assert_eq!(st.items.iter().filter(|i| i.lane == Done && i.done_at.is_some()).count(), 4);
        assert_eq!(st.rules.len(), 2);
        assert_eq!(st.sources.len(), 3);
        assert!(st.sources.iter().all(|s| s.account == "acct"));
        // Loading twice does not duplicate.
        load_sample(&mut st, Utc::now(), "acct");
        assert_eq!(st.items.len(), 35);
        // A user item in a sample project keeps that project alive.
        st.items.push(Item { id: "u".into(), project: "sample-sales".into(), title: "Mine".into(), ..Default::default() });
        clear_sample(&mut st);
        assert!(!st.settings.sample_data);
        assert_eq!(st.items.len(), 1);
        assert_eq!(st.projects.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), vec!["sample-sales"]);
        assert_eq!(st.workspaces.len(), 2);
        assert!(st.rules.is_empty() && st.sources.is_empty());
    }
}
