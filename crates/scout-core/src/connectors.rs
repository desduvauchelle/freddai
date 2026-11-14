//! Per-agent-account connector detection: which connectors (claude.ai Gmail, local MCP servers, ...)
//! each Freddai agent account already has, and whether each is connected. Pure logic only: parsing
//! CLI output and config files, naming, and turning CLI outcomes into results. Spawning the CLIs
//! lives in the app (`apps/native/src-tauri/src/scout.rs`). Only server names and status are read,
//! never credentials, env values or tokens. Every failure ends up in `warning`.
use crate::detect::{classify_mcp_name, mcp_server_names, ConnectionKind};
use serde::Serialize;
use serde_json::Value;
use std::path::{Path, PathBuf};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorKind {
    Email,
    Calendar,
    Chat,
    Meetings,
    Files,
    Other,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConnectorStatus {
    Connected,
    NeedsAuth,
    Failed,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AccountConnector {
    /// `${via}:${raw_name}`.
    pub key: String,
    pub provider: String,
    pub label: String,
    pub kind: ConnectorKind,
    pub status: ConnectorStatus,
    /// `claude_ai_connector`, `claude_plugin_mcp`, `claude_mcp`, `codex_mcp`, `gemini_mcp`.
    pub via: String,
    pub raw_name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AccountConnectors {
    pub account: String,
    pub connectors: Vec<AccountConnector>,
    pub warning: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct AccountDetection {
    pub accounts: Vec<AccountConnectors>,
}

/// What the app knows about one Freddai account.
#[derive(Clone, Debug)]
pub struct AccountSpec {
    pub id: String,
    pub name: String,
    pub provider: String,
    /// The account's config directory (CLAUDE_CONFIG_DIR / CODEX_HOME / HOME for antigravity).
    pub home: PathBuf,
    /// Claude account on the shared default login (CLAUDE_CONFIG_DIR unset; config in ~/.claude.json).
    pub claude_default_config: bool,
}

/// Result of running one CLI command.
#[derive(Clone, Debug)]
pub enum CliOutcome {
    Done { code: Option<i32>, stdout: String, stderr: String },
    TimedOut { secs: u64 },
    /// Binary not found or could not be started.
    Unavailable(String),
}

struct Extra {
    needle: &'static str,
    id: &'static str,
    label: &'static str,
    kind: ConnectorKind,
}
const EXTRAS: &[Extra] = &[
    Extra { needle: "google-drive", id: "google_drive", label: "Google Drive", kind: ConnectorKind::Files },
    Extra { needle: "google-docs", id: "google_docs", label: "Google Docs", kind: ConnectorKind::Files },
    Extra { needle: "google-sheets", id: "google_sheets", label: "Google Sheets", kind: ConnectorKind::Files },
    Extra { needle: "dropbox", id: "dropbox", label: "Dropbox", kind: ConnectorKind::Files },
    Extra { needle: "onedrive", id: "onedrive", label: "OneDrive", kind: ConnectorKind::Files },
    Extra { needle: "sharepoint", id: "sharepoint", label: "SharePoint", kind: ConnectorKind::Files },
    Extra { needle: "microsoft-365", id: "microsoft_365", label: "Microsoft 365", kind: ConnectorKind::Other },
    Extra { needle: "notion", id: "notion", label: "Notion", kind: ConnectorKind::Other },
    Extra { needle: "linear", id: "linear", label: "Linear", kind: ConnectorKind::Other },
    Extra { needle: "asana", id: "asana", label: "Asana", kind: ConnectorKind::Other },
    Extra { needle: "atlassian", id: "atlassian", label: "Atlassian", kind: ConnectorKind::Other },
    Extra { needle: "jira", id: "jira", label: "Jira", kind: ConnectorKind::Other },
    Extra { needle: "figma", id: "figma", label: "Figma", kind: ConnectorKind::Other },
    Extra { needle: "github", id: "github", label: "GitHub", kind: ConnectorKind::Other },
    Extra { needle: "hubspot", id: "hubspot", label: "HubSpot", kind: ConnectorKind::Other },
    Extra { needle: "salesforce", id: "salesforce", label: "Salesforce", kind: ConnectorKind::Other },
    Extra { needle: "intercom", id: "intercom", label: "Intercom", kind: ConnectorKind::Other },
    Extra { needle: "clickup", id: "clickup", label: "ClickUp", kind: ConnectorKind::Other },
    Extra { needle: "monday", id: "monday", label: "monday.com", kind: ConnectorKind::Other },
    Extra { needle: "calendly", id: "calendly", label: "Calendly", kind: ConnectorKind::Calendar },
    Extra { needle: "datadog", id: "datadog", label: "Datadog", kind: ConnectorKind::Other },
    Extra { needle: "quickbooks", id: "quickbooks", label: "QuickBooks", kind: ConnectorKind::Other },
];

fn kind_from(k: ConnectionKind) -> ConnectorKind {
    match k {
        ConnectionKind::Email => ConnectorKind::Email,
        ConnectionKind::Calendar => ConnectorKind::Calendar,
        ConnectionKind::Chat => ConnectorKind::Chat,
        ConnectionKind::Meetings => ConnectorKind::Meetings,
    }
}

/// Name without the `claude.ai ` / `plugin:<plugin>:` decoration.
fn bare_name(raw: &str) -> &str {
    if let Some(rest) = raw.strip_prefix("claude.ai ") {
        return rest;
    }
    if let Some(rest) = raw.strip_prefix("plugin:") {
        return rest.split_once(':').map(|(_, n)| n).unwrap_or(rest);
    }
    raw
}

/// Raw server name -> (provider id, label, kind). Unknown names become provider `other` with the raw name as label.
pub fn map_connector_name(raw: &str) -> (String, String, ConnectorKind) {
    let bare = bare_name(raw);
    if let Some((id, label, kind)) = classify_mcp_name(bare) {
        return (id.into(), label.into(), kind_from(kind));
    }
    let lower = bare.to_lowercase().replace([' ', '_'], "-");
    if let Some(e) = EXTRAS.iter().find(|e| lower.contains(e.needle)) {
        return (e.id.into(), e.label.into(), e.kind);
    }
    ("other".into(), raw.into(), ConnectorKind::Other)
}

fn connector(via: &str, raw: &str, status: ConnectorStatus) -> AccountConnector {
    let (provider, label, kind) = map_connector_name(raw);
    AccountConnector { key: format!("{via}:{raw}"), provider, label, kind, status, via: via.into(), raw_name: raw.into() }
}

fn push_unique(list: &mut Vec<AccountConnector>, c: AccountConnector) {
    if !list.iter().any(|x| x.key == c.key) {
        list.push(c);
    }
}

fn claude_via(raw: &str) -> &'static str {
    if raw.starts_with("claude.ai ") {
        "claude_ai_connector"
    } else if raw.starts_with("plugin:") {
        "claude_plugin_mcp"
    } else {
        "claude_mcp"
    }
}

/// Parsed `claude mcp list`: connectors plus the lines that could not be understood.
#[derive(Debug, Default)]
pub struct Parsed {
    pub connectors: Vec<AccountConnector>,
    pub unparsed: Vec<String>,
}

fn claude_status(text: &str) -> Option<Option<ConnectorStatus>> {
    // Outer None: not a status. Inner None: recognised but not a real server (not configured).
    let t = text.trim_start_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
    if t.starts_with("connected") {
        Some(Some(ConnectorStatus::Connected))
    } else if t.starts_with("needs auth") {
        Some(Some(ConnectorStatus::NeedsAuth))
    } else if t.starts_with("failed") || t.starts_with("disconnected") || t.starts_with("error") {
        Some(Some(ConnectorStatus::Failed))
    } else if t.starts_with("not configured") {
        Some(None)
    } else {
        None
    }
}

/// `claude mcp list` lines look like `<name>: <url or command> [(HTTP)] - <marker> <status>[ — reason]`.
pub fn parse_claude_mcp_list(stdout: &str) -> Parsed {
    let mut out = Parsed::default();
    for line in stdout.lines().map(str::trim).filter(|l| !l.is_empty()) {
        if line.starts_with("Checking MCP server health") || line.starts_with("[mcp-sdk]") {
            continue;
        }
        let Some((name, rest)) = line.split_once(": ") else {
            out.unparsed.push(line.chars().take(80).collect());
            continue;
        };
        let status = rest.match_indices(" - ").find_map(|(i, _)| claude_status(&rest[i + 3..]));
        match status {
            Some(Some(s)) => push_unique(&mut out.connectors, connector(claude_via(name), name.trim(), s)),
            Some(None) => {}
            None => out.unparsed.push(line.chars().take(80).collect()),
        }
    }
    out
}

/// `codex mcp list --json`: array of `{name, enabled, auth_status, ...}`.
pub fn parse_codex_mcp_json(stdout: &str) -> Result<Vec<AccountConnector>, String> {
    let v: Value = serde_json::from_str(stdout.trim()).map_err(|e| format!("codex mcp list --json was not valid JSON: {e}"))?;
    let arr = v.as_array().ok_or("codex mcp list --json did not return an array")?;
    let mut out = vec![];
    for item in arr {
        let name = item.get("name").and_then(Value::as_str).ok_or("codex mcp list --json entry has no name")?;
        if item.get("enabled").and_then(Value::as_bool) == Some(false) {
            continue;
        }
        let status = match item.get("auth_status").and_then(Value::as_str) {
            Some("not_logged_in") => ConnectorStatus::NeedsAuth,
            Some("o_auth") | Some("bearer_token") => ConnectorStatus::Connected,
            _ => ConnectorStatus::Unknown,
        };
        push_unique(&mut out, connector("codex_mcp", name, status));
    }
    Ok(out)
}

/// `agy mcp list`: `No MCP servers configured.` or a table `NAME TYPE STATUS COMMAND/URL`.
pub fn parse_agy_mcp_list(stdout: &str) -> Result<Vec<AccountConnector>, String> {
    let text = stdout.trim();
    if text.is_empty() || text.starts_with("No MCP servers") {
        return Ok(vec![]);
    }
    let mut lines = text.lines();
    let header = lines.next().unwrap_or("");
    if !header.trim_start().starts_with("NAME") {
        return Err(format!("unrecognised agy mcp list output: {}", header.chars().take(80).collect::<String>()));
    }
    let mut out = vec![];
    for line in lines.map(str::trim).filter(|l| !l.is_empty()) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 3 {
            return Err(format!("unrecognised agy mcp list row: {}", line.chars().take(80).collect::<String>()));
        }
        if cols[2] == "disabled" {
            continue;
        }
        push_unique(&mut out, connector("gemini_mcp", cols[0], ConnectorStatus::Unknown));
    }
    Ok(out)
}

fn read_names(path: &Path) -> Result<Vec<String>, String> {
    if std::fs::metadata(path).map(|m| m.len() == 0).unwrap_or(false) {
        return Ok(vec![]);
    }
    Ok(mcp_server_names(path)?.unwrap_or_default())
}

/// Config-file view of a Claude account (status unknown): claude.ai connectors it ever connected plus MCP servers.
pub fn claude_config_connectors(file: &Path) -> Result<Vec<AccountConnector>, String> {
    let mut out = vec![];
    let text = match std::fs::read_to_string(file) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(out),
        Err(e) => return Err(format!("Could not read {}: {e}", file.display())),
    };
    if text.trim().is_empty() {
        return Ok(out);
    }
    let json: Value = serde_json::from_str(&text).map_err(|e| format!("{} is not valid JSON: {e}", file.display()))?;
    if let Some(names) = json.get("claudeAiMcpEverConnected").and_then(Value::as_array) {
        for n in names.iter().filter_map(Value::as_str) {
            push_unique(&mut out, connector("claude_ai_connector", n, ConnectorStatus::Unknown));
        }
    }
    for n in read_names(file)? {
        push_unique(&mut out, connector("claude_mcp", &n, ConnectorStatus::Unknown));
    }
    Ok(out)
}

fn names_to_connectors(names: Vec<String>, via: &str) -> Vec<AccountConnector> {
    let mut out = vec![];
    for n in names {
        push_unique(&mut out, connector(via, &n, ConnectorStatus::Unknown));
    }
    out
}

/// Where a Claude account keeps its config (used for the fallback read).
pub fn claude_config_file(spec: &AccountSpec, user_home: &Path) -> PathBuf {
    if spec.claude_default_config {
        user_home.join(".claude.json")
    } else {
        spec.home.join(".claude.json")
    }
}

fn reason(outcome: &CliOutcome, what: &str) -> Option<String> {
    match outcome {
        CliOutcome::Done { code: Some(0), .. } => None,
        CliOutcome::Done { code, stderr, .. } => {
            let first = stderr.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("[mcp-sdk]")).unwrap_or("no error output");
            let code = code.map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
            Some(format!("{what} failed (exit {code}): {}", first.chars().take(200).collect::<String>()))
        }
        CliOutcome::TimedOut { secs } => Some(format!("{what} timed out after {secs}s; showing connectors from the config file without live status")),
        CliOutcome::Unavailable(why) => Some(format!("{what} could not run: {why}")),
    }
}

fn finish(spec: &AccountSpec, connectors: Vec<AccountConnector>, warnings: Vec<String>) -> AccountConnectors {
    let warning = if warnings.is_empty() { None } else { Some(warnings.join("; ")) };
    if let Some(w) = &warning {
        eprintln!(
            "{}",
            serde_json::json!({"event": "scout.detect_account_connectors.warning", "account": spec.id, "provider": spec.provider, "reason": w})
        );
    }
    AccountConnectors { account: spec.id.clone(), connectors, warning }
}

/// Arguments (after the program) to run for this provider, or `None` when no CLI call is needed.
pub fn cli_args(provider: &str) -> Option<&'static [&'static str]> {
    match provider {
        "claude" | "antigravity" => Some(&["mcp", "list"]),
        "codex" => Some(&["mcp", "list", "--json"]),
        _ => None,
    }
}

/// Turns one account plus the outcome of its CLI call (`None` when `cli_args` is `None`) into a result.
/// Falls back to config files, with a warning, when the CLI call did not succeed.
pub fn build_account(spec: &AccountSpec, user_home: &Path, outcome: Option<CliOutcome>) -> AccountConnectors {
    let mut warnings = vec![];
    let connectors = match spec.provider.as_str() {
        "claude" => {
            let file = claude_config_file(spec, user_home);
            let fallback = |w: &mut Vec<String>| match claude_config_connectors(&file) {
                Ok(c) => c,
                Err(e) => {
                    w.push(format!("config fallback failed: {e}"));
                    vec![]
                }
            };
            match outcome {
                Some(CliOutcome::Done { code: Some(0), stdout, .. }) => {
                    let parsed = parse_claude_mcp_list(&stdout);
                    if parsed.connectors.is_empty() && !parsed.unparsed.is_empty() {
                        warnings.push(format!("could not parse claude mcp list output (first line: {})", parsed.unparsed[0]));
                        fallback(&mut warnings)
                    } else {
                        if !parsed.unparsed.is_empty() {
                            warnings.push(format!("{} claude mcp list line(s) not understood (first: {})", parsed.unparsed.len(), parsed.unparsed[0]));
                        }
                        parsed.connectors
                    }
                }
                Some(o) => {
                    warnings.extend(reason(&o, "claude mcp list"));
                    fallback(&mut warnings)
                }
                None => {
                    warnings.push("claude mcp list was not run".into());
                    vec![]
                }
            }
        }
        "codex" => {
            let fallback = |w: &mut Vec<String>| match read_names(&spec.home.join("config.toml")) {
                Ok(n) => names_to_connectors(n, "codex_mcp"),
                Err(e) => {
                    w.push(format!("config fallback failed: {e}"));
                    vec![]
                }
            };
            match outcome {
                Some(CliOutcome::Done { code: Some(0), stdout, .. }) => match parse_codex_mcp_json(&stdout) {
                    Ok(c) => c,
                    Err(e) => {
                        warnings.push(e);
                        fallback(&mut warnings)
                    }
                },
                Some(o) => {
                    warnings.extend(reason(&o, "codex mcp list"));
                    fallback(&mut warnings)
                }
                None => {
                    warnings.push("codex mcp list was not run".into());
                    vec![]
                }
            }
        }
        "antigravity" => {
            let fallback = |w: &mut Vec<String>| match read_names(&spec.home.join(".gemini/config/mcp_config.json")) {
                Ok(n) => names_to_connectors(n, "gemini_mcp"),
                Err(e) => {
                    w.push(format!("config fallback failed: {e}"));
                    vec![]
                }
            };
            match outcome {
                Some(CliOutcome::Done { code: Some(0), stdout, .. }) => match parse_agy_mcp_list(&stdout) {
                    Ok(c) => c,
                    Err(e) => {
                        warnings.push(e);
                        fallback(&mut warnings)
                    }
                },
                Some(o) => {
                    warnings.extend(reason(&o, "agy mcp list"));
                    fallback(&mut warnings)
                }
                None => {
                    warnings.push("agy mcp list was not run".into());
                    vec![]
                }
            }
        }
        "gemini" => match read_names(&spec.home.join(".gemini/settings.json")) {
            Ok(n) => names_to_connectors(n, "gemini_mcp"),
            Err(e) => {
                warnings.push(format!("config read failed: {e}"));
                vec![]
            }
        },
        other => {
            warnings.push(format!("Connector detection is not supported for {other} accounts yet."));
            vec![]
        }
    };
    finish(spec, connectors, warnings)
}

#[cfg(test)]
mod tests {
    use super::*;

    const CLAUDE: &str = include_str!("fixtures/claude_mcp_list.txt");
    const CODEX: &str = include_str!("fixtures/codex_mcp_list.json");
    const AGY: &str = include_str!("fixtures/agy_mcp_list.txt");

    fn spec(provider: &str, home: &Path) -> AccountSpec {
        AccountSpec { id: "acc1".into(), name: "T".into(), provider: provider.into(), home: home.into(), claude_default_config: false }
    }
    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("scout-conn-{tag}-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn find<'a>(c: &'a [AccountConnector], raw: &str) -> &'a AccountConnector {
        c.iter().find(|x| x.raw_name == raw).unwrap_or_else(|| panic!("missing {raw}"))
    }

    #[test]
    fn maps_names() {
        let m = |n: &str| map_connector_name(n);
        assert_eq!(m("claude.ai Gmail"), ("gmail".into(), "Gmail".into(), ConnectorKind::Email));
        assert_eq!(m("claude.ai Google Calendar"), ("google_calendar".into(), "Google Calendar".into(), ConnectorKind::Calendar));
        assert_eq!(m("claude.ai Google Drive").2, ConnectorKind::Files);
        assert_eq!(m("claude.ai Zoom for Claude").0, "zoom");
        assert_eq!(m("claude.ai Zoom for Claude").2, ConnectorKind::Meetings);
        assert_eq!(m("plugin:design:slack"), ("slack".into(), "Slack".into(), ConnectorKind::Chat));
        assert_eq!(m("discord-bot").2, ConnectorKind::Chat);
        assert_eq!(m("plugin:design:notion"), ("notion".into(), "Notion".into(), ConnectorKind::Other));
        assert_eq!(m("claude.ai LOOOT"), ("other".into(), "claude.ai LOOOT".into(), ConnectorKind::Other));
        assert_eq!(m("global-lucy"), ("other".into(), "global-lucy".into(), ConnectorKind::Other));
    }

    #[test]
    fn parses_real_claude_output() {
        let p = parse_claude_mcp_list(CLAUDE);
        assert!(p.unparsed.is_empty(), "{:?}", p.unparsed);
        assert_eq!(p.connectors.len(), 8, "Not configured plugin placeholders are skipped");
        let gmail = find(&p.connectors, "claude.ai Gmail");
        assert_eq!((gmail.status, gmail.via.as_str(), gmail.key.as_str()), (ConnectorStatus::Connected, "claude_ai_connector", "claude_ai_connector:claude.ai Gmail"));
        assert_eq!(find(&p.connectors, "claude.ai LiveCase Prod").status, ConnectorStatus::NeedsAuth);
        assert_eq!(find(&p.connectors, "plugin:design:slack").status, ConnectorStatus::NeedsAuth);
        assert_eq!(find(&p.connectors, "plugin:design:slack").via, "claude_plugin_mcp");
        assert_eq!(find(&p.connectors, "plugin:design:asana").status, ConnectorStatus::Failed);
    }

    #[test]
    fn unparseable_claude_output_warns_and_falls_back() {
        let home = tmp("badparse");
        std::fs::write(home.join(".claude.json"), r#"{"claudeAiMcpEverConnected":["claude.ai Gmail"],"mcpServers":{"slack":{"env":{"TOKEN":"secret"}}}}"#).unwrap();
        let out = CliOutcome::Done { code: Some(0), stdout: "something new\nnot a list".into(), stderr: String::new() };
        let r = build_account(&spec("claude", &home), &home, Some(out));
        assert!(r.warning.as_deref().unwrap().contains("could not parse"));
        assert_eq!(r.connectors.len(), 2);
        assert!(r.connectors.iter().all(|c| c.status == ConnectorStatus::Unknown));
        assert!(!format!("{r:?}").contains("secret"));
    }

    #[test]
    fn timeout_falls_back_to_config_with_warning() {
        let home = tmp("timeout");
        std::fs::write(home.join(".claude.json"), r#"{"claudeAiMcpEverConnected":["claude.ai Gmail","claude.ai Google Calendar"]}"#).unwrap();
        let r = build_account(&spec("claude", &home), &home, Some(CliOutcome::TimedOut { secs: 25 }));
        assert_eq!(r.connectors.len(), 2);
        assert_eq!(r.connectors[0].status, ConnectorStatus::Unknown);
        assert!(r.warning.unwrap().contains("timed out after 25s"));
    }

    #[test]
    fn missing_binary_and_nonzero_exit_warn_loudly() {
        let home = tmp("fail");
        let r = build_account(&spec("claude", &home), &home, Some(CliOutcome::Unavailable("Install claude CLI".into())));
        assert!(r.warning.unwrap().contains("could not run: Install claude CLI"));
        let r = build_account(&spec("codex", &home), &home, Some(CliOutcome::Done { code: Some(2), stdout: String::new(), stderr: "boom\n".into() }));
        assert!(r.warning.unwrap().contains("exit 2): boom"));
        let r = build_account(&spec("codex", &home), &home, Some(CliOutcome::Done { code: Some(0), stdout: "garbage".into(), stderr: String::new() }));
        assert!(r.warning.unwrap().contains("not valid JSON"));
        let r = build_account(&spec("opencode", &home), &home, None);
        assert!(r.warning.unwrap().contains("not supported"));
    }

    #[test]
    fn codex_json_and_toml_fallback() {
        let c = parse_codex_mcp_json(CODEX).unwrap();
        assert_eq!(c.len(), 1);
        assert_eq!((c[0].via.as_str(), c[0].status, c[0].provider.as_str()), ("codex_mcp", ConnectorStatus::Unknown, "other"));
        let j = r#"[{"name":"slack","enabled":true,"auth_status":"not_logged_in"},{"name":"gmail","enabled":true,"auth_status":"o_auth"},{"name":"off","enabled":false,"auth_status":"o_auth"}]"#;
        let c = parse_codex_mcp_json(j).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].status, ConnectorStatus::NeedsAuth);
        assert_eq!(c[1].status, ConnectorStatus::Connected);
        assert_eq!(parse_codex_mcp_json("[]").unwrap().len(), 0);
        let home = tmp("codex");
        std::fs::write(home.join("config.toml"), "[mcp_servers.zoom]\ncommand=\"x\"\n[mcp_servers.zoom.env]\nK=\"v\"\n").unwrap();
        let r = build_account(&spec("codex", &home), &home, Some(CliOutcome::TimedOut { secs: 25 }));
        assert_eq!(r.connectors[0].provider, "zoom");
        assert!(r.warning.is_some());
    }

    #[test]
    fn agy_table() {
        let c = parse_agy_mcp_list(AGY).unwrap();
        assert_eq!((c[0].provider.as_str(), c[0].via.as_str()), ("slack", "gemini_mcp"));
        assert!(parse_agy_mcp_list("No MCP servers configured.").unwrap().is_empty());
        assert!(parse_agy_mcp_list("weird").is_err());
    }

    #[test]
    fn serializes_snake_case() {
        let c = connector("claude_ai_connector", "claude.ai Gmail", ConnectorStatus::NeedsAuth);
        let v = serde_json::to_value(&c).unwrap();
        assert_eq!(v["status"], "needs_auth");
        assert_eq!(v["kind"], "email");
        assert_eq!(v["raw_name"], "claude.ai Gmail");
    }
}
