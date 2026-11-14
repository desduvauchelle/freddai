//! Detects which communication connections (email, calendar, chat, meetings) exist on this
//! computer. Presence only: no message content and no secrets are read. Every signal that
//! cannot be checked produces a [`Warning`] instead of silently returning nothing.
use serde::Serialize;
use serde_json::Value;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind {
    Email,
    Calendar,
    Chat,
    Meetings,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Connection {
    /// Stable id: `provider|account`.
    pub id: String,
    pub kind: ConnectionKind,
    /// gmail, google_calendar, google_meet, outlook, slack, whatsapp, teams, zoom, telegram, discord,
    /// apple_mail, apple_calendar, imessage, signal.
    pub provider: String,
    pub label: String,
    /// Google account email when known, else empty.
    pub account: String,
    /// `freddai_google_account`, `installed_app`, `agent_mcp:<agent>`; several when found more than one way.
    pub found_via: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Warning {
    /// Which signal failed, e.g. `freddai_google_accounts`, `agent_mcp:claude`, `installed_apps`.
    pub signal: String,
    pub message: String,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Detection {
    pub connections: Vec<Connection>,
    pub warnings: Vec<Warning>,
}

struct Provider {
    id: &'static str,
    label: &'static str,
    kind: ConnectionKind,
    /// Exact `.app` bundle names (lowercase, without `.app`).
    apps: &'static [&'static str],
    /// Substrings (lowercase) of an MCP server name.
    mcp: &'static [&'static str],
}

use ConnectionKind::*;
const PROVIDERS: &[Provider] = &[
    Provider { id: "gmail", label: "Gmail", kind: Email, apps: &[], mcp: &["gmail"] },
    Provider { id: "google_calendar", label: "Google Calendar", kind: Calendar, apps: &[], mcp: &["google-calendar", "google_calendar", "googlecalendar", "gcal"] },
    Provider { id: "google_meet", label: "Google Meet", kind: Meetings, apps: &[], mcp: &["google-meet", "google_meet", "googlemeet"] },
    Provider { id: "outlook", label: "Outlook", kind: Email, apps: &["microsoft outlook"], mcp: &["outlook"] },
    Provider { id: "slack", label: "Slack", kind: Chat, apps: &["slack"], mcp: &["slack"] },
    Provider { id: "whatsapp", label: "WhatsApp", kind: Chat, apps: &["whatsapp"], mcp: &["whatsapp"] },
    Provider { id: "teams", label: "Microsoft Teams", kind: Chat, apps: &["microsoft teams", "microsoft teams (work or school)", "microsoft teams classic", "msteams"], mcp: &["teams"] },
    Provider { id: "zoom", label: "Zoom", kind: Meetings, apps: &["zoom.us", "zoom"], mcp: &["zoom"] },
    Provider { id: "telegram", label: "Telegram", kind: Chat, apps: &["telegram", "telegram desktop"], mcp: &["telegram"] },
    Provider { id: "discord", label: "Discord", kind: Chat, apps: &["discord"], mcp: &["discord"] },
    Provider { id: "signal", label: "Signal", kind: Chat, apps: &["signal"], mcp: &["signal"] },
    Provider { id: "imessage", label: "iMessage", kind: Chat, apps: &["messages"], mcp: &["imessage"] },
    Provider { id: "apple_mail", label: "Apple Mail", kind: Email, apps: &["mail"], mcp: &[] },
    Provider { id: "apple_calendar", label: "Apple Calendar", kind: Calendar, apps: &["calendar"], mcp: &[] },
];

fn provider(id: &str) -> &'static Provider {
    PROVIDERS.iter().find(|p| p.id == id).expect("known provider")
}

/// Where each signal looks. Overridable so tests can use temp dirs.
pub struct Locations {
    pub app_dirs: Vec<PathBuf>,
    /// `(agent, path)`; the file extension picks the parser (`.toml` or JSON).
    pub mcp_configs: Vec<(String, PathBuf)>,
}

impl Locations {
    pub fn system() -> Self {
        let home = std::env::var_os("HOME").map(PathBuf::from).unwrap_or_default();
        Self {
            app_dirs: vec![
                PathBuf::from("/Applications"),
                PathBuf::from("/System/Applications"),
                PathBuf::from("/System/Applications/Utilities"),
                home.join("Applications"),
            ],
            mcp_configs: vec![
                ("claude".into(), home.join(".claude.json")),
                ("codex".into(), home.join(".codex/config.toml")),
                ("gemini".into(), home.join(".gemini/settings.json")),
                ("cursor".into(), home.join(".cursor/mcp.json")),
            ],
        }
    }
}

#[derive(Default)]
struct Collector {
    out: Vec<Connection>,
}

impl Collector {
    fn add(&mut self, provider_id: &str, account: &str, via: &str) {
        let p = provider(provider_id);
        let push_via = |c: &mut Connection| {
            if !c.found_via.iter().any(|v| v == via) {
                c.found_via.push(via.to_owned());
            }
        };
        if let Some(existing) = self.out.iter_mut().find(|c| c.provider == provider_id && c.account == account) {
            push_via(existing);
            return;
        }
        // An account-less hit (app, MCP) joins an account-specific entry of the same provider.
        if account.is_empty() {
            if let Some(existing) = self.out.iter_mut().find(|c| c.provider == provider_id) {
                push_via(existing);
                return;
            }
        }
        // An account-specific hit absorbs an earlier account-less entry of the same provider.
        let mut found_via = vec![via.to_owned()];
        if !account.is_empty() {
            if let Some(i) = self.out.iter().position(|c| c.provider == provider_id && c.account.is_empty()) {
                let old = self.out.remove(i);
                for v in old.found_via.into_iter().rev() {
                    found_via.insert(0, v);
                }
            }
        }
        self.out.push(Connection {
            id: format!("{provider_id}|{account}"),
            kind: p.kind,
            provider: provider_id.to_owned(),
            label: p.label.to_owned(),
            account: account.to_owned(),
            found_via,
        });
    }
}

/// Google accounts connected in Freddai (`google_accounts` host reply), each expanded to
/// Gmail, Google Calendar and Google Meet for that address.
pub fn google_account_connections(reply: &Value) -> Result<Vec<(String, String)>, String> {
    let accounts = reply.get("accounts").and_then(Value::as_array).ok_or("unexpected google_accounts reply")?;
    let mut out = vec![];
    for a in accounts {
        let Some(email) = a.get("email").and_then(Value::as_str).filter(|e| !e.is_empty()) else { continue };
        for p in ["gmail", "google_calendar", "google_meet"] {
            out.push((p.to_owned(), email.to_owned()));
        }
    }
    Ok(out)
}

/// Provider ids whose app is installed in any of `dirs`. Missing dirs are skipped; unreadable ones warn.
pub fn installed_apps(dirs: &[PathBuf]) -> (Vec<&'static str>, Vec<Warning>) {
    let mut names = BTreeSet::new();
    let mut warnings = vec![];
    for dir in dirs {
        match std::fs::read_dir(dir) {
            Ok(entries) => {
                for e in entries.flatten() {
                    let n = e.file_name().to_string_lossy().to_lowercase();
                    if let Some(stem) = n.strip_suffix(".app") {
                        names.insert(stem.to_owned());
                    }
                }
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => warnings.push(Warning { signal: "installed_apps".into(), message: format!("Could not read {}: {e}", dir.display()) }),
        }
    }
    let found = PROVIDERS.iter().filter(|p| p.apps.iter().any(|a| names.contains(*a))).map(|p| p.id).collect();
    (found, warnings)
}

/// MCP server names declared in an agent config. `Ok(None)` when the file does not exist.
pub fn mcp_server_names(path: &Path) -> Result<Option<Vec<String>>, String> {
    let text = match std::fs::read_to_string(path) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(format!("Could not read {}: {e}", path.display())),
    };
    let mut names = BTreeSet::new();
    if path.extension().and_then(|e| e.to_str()) == Some("toml") {
        // Only table headers are read: `[mcp_servers.NAME]` / `[mcp_servers."NAME"]`.
        for line in text.lines() {
            let line = line.trim();
            if let Some(rest) = line.strip_prefix("[mcp_servers.").and_then(|r| r.strip_suffix(']')) {
                let name = rest.split('.').next().unwrap_or("").trim_matches('"');
                if !name.is_empty() {
                    names.insert(name.to_owned());
                }
            }
        }
    } else {
        let json: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {e}", path.display()))?;
        let mut take = |v: &Value| {
            if let Some(map) = v.get("mcpServers").and_then(Value::as_object) {
                names.extend(map.keys().cloned());
            }
        };
        take(&json);
        // ~/.claude.json also keeps per-project servers.
        if let Some(projects) = json.get("projects").and_then(Value::as_object) {
            for project in projects.values() {
                take(project);
            }
        }
    }
    Ok(Some(names.into_iter().collect()))
}

/// First known provider whose MCP keywords appear in a server name (spaces count as `-`).
/// Returns `(provider id, label, kind)`. Shared with the per-account connector detection.
pub fn classify_mcp_name(name: &str) -> Option<(&'static str, &'static str, ConnectionKind)> {
    let lower = name.to_lowercase().replace(' ', "-");
    PROVIDERS.iter().find(|p| p.mcp.iter().any(|k| lower.contains(k))).map(|p| (p.id, p.label, p.kind))
}

fn mcp_providers(name: &str) -> Vec<&'static str> {
    let lower = name.to_lowercase();
    PROVIDERS.iter().filter(|p| p.mcp.iter().any(|k| lower.contains(k))).map(|p| p.id).collect()
}

/// Runs every signal. `google` is the host `google_accounts` reply, or the reason it could not be read.
pub fn detect(locations: &Locations, google: Result<Value, String>) -> Detection {
    let mut c = Collector::default();
    let mut warnings = vec![];

    match google.and_then(|v| google_account_connections(&v)) {
        Ok(list) => list.iter().for_each(|(p, email)| c.add(p, email, "freddai_google_account")),
        Err(message) => warnings.push(Warning { signal: "freddai_google_accounts".into(), message }),
    }

    let (apps, app_warnings) = installed_apps(&locations.app_dirs);
    warnings.extend(app_warnings);
    apps.iter().for_each(|p| c.add(p, "", "installed_app"));

    for (agent, path) in &locations.mcp_configs {
        match mcp_server_names(path) {
            Ok(Some(names)) => {
                for name in names {
                    for p in mcp_providers(&name) {
                        c.add(p, "", &format!("agent_mcp:{agent}"));
                    }
                }
            }
            Ok(None) => {}
            Err(message) => warnings.push(Warning { signal: format!("agent_mcp:{agent}"), message }),
        }
    }

    for w in &warnings {
        eprintln!("{}", serde_json::json!({"event": "scout.detect_connections.warning", "signal": w.signal, "message": w.message}));
    }
    let mut connections = c.out;
    let order = |id: &str| PROVIDERS.iter().position(|p| p.id == id).unwrap_or(usize::MAX);
    connections.sort_by(|a, b| a.account.is_empty().cmp(&b.account.is_empty()).then(order(&a.provider).cmp(&order(&b.provider))).then(a.account.cmp(&b.account)));
    Detection { connections, warnings }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("scout-detect-{name}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn parses_claude_json_and_codex_toml_server_names() {
        let d = tmp("mcp");
        std::fs::write(d.join("claude.json"), r#"{"mcpServers":{"slack":{"command":"x","env":{"TOKEN":"secret"}}},"projects":{"/p":{"mcpServers":{"zoom-mcp":{}}}}}"#).unwrap();
        std::fs::write(d.join("config.toml"), "model=\"x\"\n[mcp_servers.\"gmail\"]\ncommand=\"y\"\n[mcp_servers.gmail.env]\nA=\"b\"\n[mcp_servers.tucky]\n").unwrap();
        assert_eq!(mcp_server_names(&d.join("claude.json")).unwrap().unwrap(), vec!["slack", "zoom-mcp"]);
        assert_eq!(mcp_server_names(&d.join("config.toml")).unwrap().unwrap(), vec!["gmail", "tucky"]);
        assert_eq!(mcp_server_names(&d.join("missing.json")).unwrap(), None);
    }

    #[test]
    fn matches_installed_apps_case_insensitively() {
        let d = tmp("apps");
        for a in ["Slack.app", "zoom.us.app", "Microsoft Teams.app", "Safari.app"] {
            std::fs::create_dir(d.join(a)).unwrap();
        }
        let (found, warnings) = installed_apps(&[d, PathBuf::from("/definitely/not/here")]);
        assert_eq!(found, vec!["slack", "teams", "zoom"]);
        assert!(warnings.is_empty());
    }

    #[test]
    fn detect_merges_signals_and_reports_failures() {
        let d = tmp("all");
        std::fs::create_dir(d.join("Slack.app")).unwrap();
        std::fs::write(d.join("claude.json"), r#"{"mcpServers":{"slack":{},"gmail":{}}}"#).unwrap();
        std::fs::write(d.join("broken.json"), "{nope").unwrap();
        let loc = Locations {
            app_dirs: vec![d.clone()],
            mcp_configs: vec![("claude".into(), d.join("claude.json")), ("gemini".into(), d.join("broken.json"))],
        };
        let reply = json!({"accounts":[{"email":"a@x.com","name":"A","services":["gmail"],"status":"ok"}]});
        let r = detect(&loc, Ok(reply));
        let ids: Vec<_> = r.connections.iter().map(|c| c.id.as_str()).collect();
        assert_eq!(ids, vec!["gmail|a@x.com", "google_calendar|a@x.com", "google_meet|a@x.com", "slack|"]);
        assert_eq!(r.connections[0].found_via, vec!["freddai_google_account", "agent_mcp:claude"]);
        assert_eq!(r.connections[3].found_via, vec!["installed_app", "agent_mcp:claude"]);
        assert_eq!(r.warnings.len(), 1);
        assert_eq!(r.warnings[0].signal, "agent_mcp:gemini");

        let r = detect(&Locations { app_dirs: vec![], mcp_configs: vec![] }, Err("host down".into()));
        assert!(r.connections.is_empty());
        assert_eq!(r.warnings[0].signal, "freddai_google_accounts");
    }

    /// Prints what this machine detects (no Google accounts); run with --nocapture.
    #[test]
    fn real_machine_smoke() {
        let r = detect(&Locations::system(), Ok(json!({"accounts": []})));
        println!("{}", serde_json::to_string_pretty(&r).unwrap());
    }
}
