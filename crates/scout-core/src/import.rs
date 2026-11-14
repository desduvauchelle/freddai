//! Import Freddai workspaces, projects and recent threads into Scout (docs/scout.md,
//! `scout_import_freddai`). Idempotent: projects match by `freddai_project`, items by
//! `thread`, workspaces by the derived id `freddai-<workspace id>`.
use crate::model::*;
use crate::store::{place, repack_all};
use chrono::{DateTime, Utc};
use serde_json::Value;
use std::collections::HashMap;

const MAX_PER_PROJECT: usize = 8;
const RECENT_DAYS: i64 = 30;

fn s<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}

/// Freddai stores `updated` as epoch milliseconds (u64, see crates/core runtime `now()`).
/// Seconds and RFC 3339 strings are accepted too.
pub fn parse_updated(v: &Value) -> Option<DateTime<Utc>> {
    match v {
        Value::Number(n) => {
            let n = n.as_i64().or_else(|| n.as_f64().map(|f| f as i64))?;
            if n.abs() < 100_000_000_000 {
                DateTime::from_timestamp(n, 0)
            } else {
                DateTime::from_timestamp_millis(n)
            }
        }
        Value::String(t) => DateTime::parse_from_rfc3339(t).ok().map(|d| d.with_timezone(&Utc)),
        _ => None,
    }
}

pub fn import_freddai(state: &mut ScoutState, snapshot: &Value, now: DateTime<Utc>) -> Result<(), String> {
    let empty = Vec::new();
    let arr = |k: &str| snapshot.get(k).and_then(Value::as_array).unwrap_or(&empty);
    if !snapshot.is_object() {
        return Err("Freddai snapshot is not an object".into());
    }
    // An import that changes nothing must say so, not look like a dead button.
    if arr("projects").is_empty() {
        return Err("Freddai has no projects to import yet. Add a project in Freddai, then import again.".into());
    }
    let now_s = now.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let fws = snapshot
        .pointer("/preferences/workspaces")
        .and_then(Value::as_array)
        .unwrap_or(&empty);

    // Freddai project id -> Scout workspace id.
    let mut ws_of: HashMap<String, String> = HashMap::new();
    for fw in fws {
        let fid = s(fw, "id");
        if fid.is_empty() {
            continue;
        }
        let id = format!("freddai-{fid}");
        if !state.workspaces.iter().any(|w| w.id == id) {
            let w = Workspace {
                id: id.clone(),
                name: s(fw, "name").to_string(),
                color: s(fw, "color").to_string(),
                order: UNSET_ORDER,
                collapsed: false,
            };
            place(&mut state.workspaces, w, |_| String::new());
        }
        for p in fw.get("projects").and_then(Value::as_array).unwrap_or(&empty) {
            if let Some(p) = p.as_str() {
                ws_of.entry(p.to_string()).or_insert_with(|| id.clone());
            }
        }
    }

    // Freddai project id -> Scout project id.
    let mut proj_of: HashMap<String, String> = HashMap::new();
    let mut fallback: Option<String> = None;
    for fp in arr("projects") {
        let fid = s(fp, "id");
        if fid.is_empty() {
            continue;
        }
        if let Some(p) = state.projects.iter().find(|p| p.freddai_project.as_deref() == Some(fid)) {
            proj_of.insert(fid.to_string(), p.id.clone());
            continue;
        }
        let workspace = match ws_of.get(fid) {
            Some(w) => w.clone(),
            None => fallback.get_or_insert_with(|| freddai_workspace(state)).clone(),
        };
        let p = Project {
            id: uuid::Uuid::new_v4().to_string(),
            workspace,
            name: s(fp, "name").to_string(),
            color: s(fp, "color").to_string(),
            order: UNSET_ORDER,
            pinned: false,
            hidden: false,
            freddai_project: Some(fid.to_string()),
        };
        proj_of.insert(fid.to_string(), p.id.clone());
        place(&mut state.projects, p, |p| p.workspace.clone());
    }

    // Recent live sessions, newest first, max 8 per project.
    let cutoff = now - chrono::Duration::days(RECENT_DAYS);
    let mut sessions: Vec<(&Value, DateTime<Utc>)> = arr("sessions")
        .iter()
        .filter(|x| !x.get("archived").and_then(Value::as_bool).unwrap_or(false))
        .filter(|x| x.get("deleted_at").is_none_or(Value::is_null))
        .filter(|x| s(x, "status") != "archived")
        .filter_map(|x| Some((x, x.get("updated").and_then(parse_updated)?)))
        .filter(|(_, t)| *t >= cutoff)
        .collect();
    sessions.sort_by(|a, b| b.1.cmp(&a.1));
    let mut taken: HashMap<String, usize> = HashMap::new();
    for (x, t) in sessions {
        let Some(project) = proj_of.get(s(x, "project")) else { continue };
        let thread = s(x, "id").to_string();
        if thread.is_empty() {
            continue;
        }
        let n = taken.entry(project.clone()).or_default();
        if *n >= MAX_PER_PROJECT {
            continue;
        }
        *n += 1;
        let pending = x.get("pending").is_some_and(|p| !p.is_null());
        let busy = matches!(s(x, "status"), "starting" | "running" | "waiting");
        let (lane, status) = if pending {
            (Lane::Focus, ItemStatus::NeedsYou)
        } else if busy {
            (Lane::Focus, ItemStatus::AgentWorking)
        } else {
            (Lane::Backlog, ItemStatus::None)
        };
        let updated = t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
        if let Some(it) = state.items.iter_mut().find(|i| i.thread.as_deref() == Some(thread.as_str())) {
            // Refresh status only; the user owns lane and placement.
            it.status = status;
            it.updated = updated;
            continue;
        }
        let title = match s(x, "title") {
            "" => "Untitled thread".to_string(),
            t => t.to_string(),
        };
        let it = Item {
            id: uuid::Uuid::new_v4().to_string(),
            project: project.clone(),
            kind: ItemKind::Code,
            title,
            subtitle: None,
            lane,
            status,
            source: None,
            origin: Origin::Import,
            thread: Some(thread),
            order: UNSET_ORDER,
            created: now_s.clone(),
            updated,
            done_at: None,
        };
        place(&mut state.items, it, |i| format!("{}\u{0}{:?}", i.project, i.lane));
    }
    repack_all(state);
    Ok(())
}

/// The non-sample workspace named "Freddai", created when missing.
fn freddai_workspace(state: &mut ScoutState) -> String {
    if let Some(w) = state.workspaces.iter().find(|w| w.name == "Freddai" && !w.id.starts_with("sample-")) {
        return w.id.clone();
    }
    let id = "freddai-unassigned".to_string();
    let w = Workspace { id: id.clone(), name: "Freddai".into(), color: "#f0582c".into(), order: UNSET_ORDER, collapsed: false };
    place(&mut state.workspaces, w, |_| String::new());
    id
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn import_is_idempotent() {
        let now = Utc::now();
        let ms = now.timestamp_millis();
        let old = ms - 40 * 86_400_000;
        let mut sessions = vec![
            json!({"id":"s1","project":"fp1","title":"Pending","status":"waiting","updated":ms,"pending":{"id":1}}),
            json!({"id":"s2","project":"fp1","title":"Busy","status":"running","updated":ms - 1,"pending":null}),
            json!({"id":"s3","project":"fp2","title":"Idle","status":"done","updated":ms - 2,"pending":null}),
            json!({"id":"s4","project":"fp2","title":"Old","status":"done","updated":old,"pending":null}),
            json!({"id":"s5","project":"fp2","title":"Gone","status":"done","updated":ms,"pending":null,"archived":true}),
        ];
        for n in 0..10 {
            sessions.push(json!({"id":format!("many{n}"),"project":"fp3","title":"x","status":"done","updated":ms - 10 - n,"pending":null}));
        }
        let snap = json!({
            "accounts":[{"id":"a1","name":"Claude","provider":"claude","color":"#000"}],
            "projects":[{"id":"fp1","name":"One","path":"/1","color":"#111"},{"id":"fp2","name":"Two","path":"/2","color":"#222"},{"id":"fp3","name":"Three","path":"/3","color":"#333"}],
            "sessions": sessions,
            "preferences":{"workspaces":[{"id":"fw","name":"Work","color":"#abc","projects":["fp1"]}]}
        });
        let mut st = ScoutState::default();
        import_freddai(&mut st, &snap, now).unwrap();
        assert_eq!(st.workspaces.len(), 2);
        assert!(st.workspaces.iter().any(|w| w.name == "Freddai"));
        assert_eq!(st.projects.len(), 3);
        let p1 = st.projects.iter().find(|p| p.freddai_project.as_deref() == Some("fp1")).unwrap();
        assert_eq!(p1.workspace, "freddai-fw");
        let by = |t: &str| st.items.iter().find(|i| i.thread.as_deref() == Some(t)).cloned();
        assert_eq!(by("s1").unwrap().status, ItemStatus::NeedsYou);
        assert_eq!(by("s1").unwrap().lane, Lane::Focus);
        assert_eq!(by("s2").unwrap().status, ItemStatus::AgentWorking);
        assert_eq!(by("s3").unwrap().lane, Lane::Backlog);
        assert!(by("s4").is_none() && by("s5").is_none());
        assert_eq!(st.items.iter().filter(|i| i.thread.as_deref().unwrap().starts_with("many")).count(), 8);
        assert!(st.items.iter().all(|i| i.origin == Origin::Import && i.kind == ItemKind::Code));
        let before = st.clone();
        import_freddai(&mut st, &snap, now).unwrap();
        assert_eq!(st.workspaces, before.workspaces);
        assert_eq!(st.projects, before.projects);
        assert_eq!(st.items.len(), before.items.len());
    }

    #[test]
    fn import_with_no_freddai_projects_is_an_error() {
        let mut st = ScoutState::default();
        let snap = json!({"accounts":[],"projects":[],"sessions":[],"preferences":{}});
        let err = import_freddai(&mut st, &snap, Utc::now()).unwrap_err();
        assert!(err.contains("no projects"), "{err}");
        assert!(st.workspaces.is_empty() && st.projects.is_empty());
    }

    #[test]
    fn empty_id_sessions_do_not_consume_project_slots() {
        let now = Utc::now();
        let ms = now.timestamp_millis();
        let mut sessions = vec![];
        for n in 0..3 {
            sessions.push(json!({"id":"","project":"fp1","title":"x","status":"done","updated":ms - n,"pending":null}));
        }
        for n in 0..8 {
            sessions.push(json!({"id":format!("ok{n}"),"project":"fp1","title":"x","status":"done","updated":ms - 100 - n,"pending":null}));
        }
        let snap = json!({
            "accounts":[{"id":"a1","name":"Claude","provider":"claude","color":"#000"}],
            "projects":[{"id":"fp1","name":"One","path":"/1","color":"#111"}],
            "sessions": sessions,
            "preferences":{}
        });
        let mut st = ScoutState::default();
        import_freddai(&mut st, &snap, now).unwrap();
        assert_eq!(st.items.len(), 8);
    }

    #[test]
    fn parses_updated_formats() {
        let t = parse_updated(&json!(1_700_000_000_000u64)).unwrap();
        assert_eq!(t, parse_updated(&json!(1_700_000_000)).unwrap());
        assert_eq!(t, parse_updated(&json!("2023-11-14T22:13:20Z")).unwrap());
    }
}
