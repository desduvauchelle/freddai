//! View and edit agent configuration (MCP servers, hooks, plugins, memory files)
//! for Claude Code and Codex, per account profile.
//!
//! These are user-owned files. Every write is read-modify-write that preserves
//! unknown keys (JSON via `serde_json::Value` with `preserve_order`, TOML via
//! `toml_edit`), is atomic (temp file + rename), and first copies the previous
//! file into a timestamped backup under Freddai's app-data directory.
//! Changes only affect agent sessions started afterwards.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::fs;
use std::path::{Path, PathBuf};
use toml_edit::{value, Array, DocumentMut, Item, Table};

type Res<T> = Result<T, String>;

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Request {
    pub op: String,
    pub provider: String,
    pub account_id: Option<String>,
    pub config_home: Option<String>,
    pub project: Option<String>,
    pub scope: Option<String>,
    pub name: Option<String>,
    pub original_name: Option<String>,
    pub server: Option<Value>,
    pub enabled: Option<bool>,
    pub hook: Option<Value>,
    pub locator: Option<Value>,
    pub plugin: Option<String>,
    pub memory: Option<String>,
    pub content: Option<String>,
}

struct Ctx {
    provider: String,
    home: PathBuf,
    user_home: PathBuf,
    project: Option<PathBuf>,
    backups: PathBuf,
}

/// Entry point used by the native shell. `root` is Freddai's app-data directory.
pub fn handle(root: &Path, req: Request) -> Res<Value> {
    handle_with_home(root, crate::platform::home_dir(), req)
}

pub fn handle_with_home(root: &Path, user_home: Option<PathBuf>, req: Request) -> Res<Value> {
    if req.provider != "claude" && req.provider != "codex" {
        return Err("Agent config editing is available for Claude Code and Codex only.".into());
    }
    let user_home = user_home.ok_or("Cannot locate the home directory")?;
    let home = match (&req.config_home, &req.account_id) {
        (Some(h), _) if !h.is_empty() => PathBuf::from(h),
        (_, Some(id)) if !id.is_empty() && !id.contains(['/', '\\']) && id != ".." => {
            root.join("accounts").join(id)
        }
        _ => return Err("This account has no configuration folder yet. Sign in first.".into()),
    };
    let project = match req.project.as_deref().filter(|p| !p.is_empty()) {
        Some(p) => {
            let p = PathBuf::from(p);
            if !p.is_dir() {
                return Err(format!("project: {} is not a folder", p.display()));
            }
            Some(p)
        }
        None => None,
    };
    let ctx = Ctx {
        provider: req.provider.clone(),
        home,
        user_home,
        project,
        backups: root.join("agent-config-backups"),
    };
    match req.op.as_str() {
        "mcp_list" => mcp_list(&ctx),
        "mcp_save" => mcp_save(&ctx, &req),
        "mcp_delete" => mcp_delete(&ctx, &req),
        "mcp_set_enabled" => mcp_set_enabled(&ctx, &req),
        "hooks_list" => hooks_list(&ctx),
        "hooks_save" => hooks_save(&ctx, &req),
        "hooks_delete" => hooks_delete(&ctx, &req),
        "plugins_list" => plugins_list(&ctx),
        "plugins_set_enabled" => plugins_set_enabled(&ctx, &req),
        "memory_list" => memory_list(&ctx),
        "memory_read" => memory_read(&ctx, &req),
        "memory_write" => memory_write(&ctx, &req),
        other => Err(format!("Unknown agent config operation: {other}")),
    }
}

// ---------------------------------------------------------------- file layer

fn read_text(path: &Path) -> Res<Option<String>> {
    match fs::read_to_string(path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("{}: cannot read ({e})", path.display())),
    }
}
fn read_json(path: &Path) -> Res<Value> {
    match read_text(path)? {
        None => Ok(json!({})),
        Some(s) if s.trim().is_empty() => Ok(json!({})),
        Some(s) => {
            let v: Value = serde_json::from_str(&s)
                .map_err(|e| format!("{}: invalid JSON, not modified ({e})", path.display()))?;
            if !v.is_object() {
                return Err(format!(
                    "{}: expected a JSON object at the top level",
                    path.display()
                ));
            }
            Ok(v)
        }
    }
}
fn read_toml(path: &Path) -> Res<DocumentMut> {
    match read_text(path)? {
        None => Ok(DocumentMut::new()),
        Some(s) => s
            .parse::<DocumentMut>()
            .map_err(|e| format!("{}: invalid TOML, not modified ({e})", path.display())),
    }
}

/// Copy the current file (if any) into the backup dir, then atomically replace it.
fn write_text(ctx: &Ctx, path: &Path, content: &str) -> Res<()> {
    let target = if path.exists() {
        fs::canonicalize(path).map_err(|e| format!("{}: {e}", path.display()))?
    } else {
        path.to_path_buf()
    };
    let dir = target
        .parent()
        .ok_or_else(|| format!("{}: no parent folder", path.display()))?;
    fs::create_dir_all(dir)
        .map_err(|e| format!("{}: cannot create folder ({e})", dir.display()))?;
    if target.exists() {
        fs::create_dir_all(&ctx.backups).map_err(|e| {
            format!(
                "{}: cannot create backup folder ({e})",
                ctx.backups.display()
            )
        })?;
        let tag: String = target
            .to_string_lossy()
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || c == '.' || c == '-' {
                    c
                } else {
                    '_'
                }
            })
            .collect();
        let tag = if tag.len() > 120 {
            tag[tag.len() - 120..].to_string()
        } else {
            tag
        };
        let stamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%3fZ");
        // Multiple edits can occur in the same millisecond. Never overwrite an earlier backup.
        let backup = ctx.backups.join(format!("{stamp}__{}__{tag}", uuid::Uuid::new_v4().simple()));
        fs::copy(&target, &backup).map_err(|e| {
            format!(
                "{}: backup failed, nothing was written ({e})",
                backup.display()
            )
        })?;
    }
    let tmp = dir.join(format!(
        ".{}.freddai-{}.tmp",
        target
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("config"),
        uuid::Uuid::new_v4().simple()
    ));
    let result = (|| -> std::io::Result<()> {
        fs::write(&tmp, content)?;
        if let Ok(meta) = fs::metadata(&target) {
            fs::set_permissions(&tmp, meta.permissions())?;
        }
        fs::rename(&tmp, &target)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(format!("{}: write failed ({e})", path.display()));
    }
    Ok(())
}

/// Read-modify-write a JSON object file. Skips the write when nothing changed.
fn edit_json(
    ctx: &Ctx,
    path: &Path,
    f: impl FnOnce(&mut Map<String, Value>) -> Res<()>,
) -> Res<()> {
    let mut doc = read_json(path)?;
    let before = doc.clone();
    f(doc.as_object_mut().expect("checked object"))?;
    if doc == before && path.exists() {
        return Ok(());
    }
    if doc == before && doc.as_object().map(|o| o.is_empty()).unwrap_or(false) {
        return Ok(());
    }
    let mut text = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
    text.push('\n');
    write_text(ctx, path, &text)
}
fn edit_toml(ctx: &Ctx, path: &Path, f: impl FnOnce(&mut DocumentMut) -> Res<()>) -> Res<()> {
    let mut doc = read_toml(path)?;
    let before = doc.to_string();
    f(&mut doc)?;
    let after = doc.to_string();
    if after == before {
        return Ok(());
    }
    after.parse::<DocumentMut>().map_err(|e| {
        format!(
            "{}: produced invalid TOML, nothing written ({e})",
            path.display()
        )
    })?;
    write_text(ctx, path, &after)
}

// ---------------------------------------------------------------- paths

fn claude_json(ctx: &Ctx) -> PathBuf {
    // The default Claude profile (~/.claude) keeps its state in ~/.claude.json;
    // a custom CLAUDE_CONFIG_DIR keeps it inside the profile folder.
    if ctx.home == ctx.user_home.join(".claude") {
        ctx.user_home.join(".claude.json")
    } else {
        ctx.home.join(".claude.json")
    }
}
fn codex_toml(ctx: &Ctx) -> PathBuf {
    ctx.home.join("config.toml")
}
fn need_project(ctx: &Ctx) -> Res<&Path> {
    ctx.project
        .as_deref()
        .ok_or_else(|| "scope: select a project to use project settings".to_string())
}
fn settings_path(ctx: &Ctx, scope: &str) -> Res<PathBuf> {
    match scope {
        "user" => Ok(ctx.home.join("settings.json")),
        "project" => Ok(need_project(ctx)?.join(".claude/settings.json")),
        "local" => Ok(need_project(ctx)?.join(".claude/settings.local.json")),
        other => Err(format!("scope: unknown scope \"{other}\"")),
    }
}
fn require_claude(ctx: &Ctx, what: &str) -> Res<()> {
    if ctx.provider == "claude" {
        Ok(())
    } else {
        Err(format!("{what} editing is available for Claude Code only."))
    }
}
fn s(v: &Option<String>, field: &str) -> Res<String> {
    v.clone()
        .filter(|x| !x.trim().is_empty())
        .ok_or_else(|| format!("{field}: required"))
}

// ---------------------------------------------------------------- MCP

struct Form {
    name: String,
    kind: String,
    command: String,
    args: Vec<String>,
    env: Map<String, Value>,
    url: String,
    headers: Map<String, Value>,
}

fn str_map(v: Option<&Value>, path: &str) -> Res<Map<String, Value>> {
    let mut out = Map::new();
    match v {
        None | Some(Value::Null) => {}
        Some(Value::Object(m)) => {
            for (k, val) in m {
                if k.trim().is_empty() {
                    return Err(format!("{path}: empty key"));
                }
                out.insert(
                    k.clone(),
                    Value::String(
                        val.as_str()
                            .ok_or_else(|| format!("{path}.{k}: must be text"))?
                            .to_string(),
                    ),
                );
            }
        }
        Some(_) => return Err(format!("{path}: must be an object of text values")),
    }
    Ok(out)
}
fn parse_form(v: &Value, provider: &str) -> Res<Form> {
    let o = v.as_object().ok_or("server: expected an object")?;
    let text = |k: &str| {
        o.get(k)
            .and_then(|x| x.as_str())
            .unwrap_or("")
            .trim()
            .to_string()
    };
    let name = text("name");
    let mut errs = vec![];
    if name.is_empty() {
        errs.push("server.name: required".to_string());
    } else if !name
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        errs.push("server.name: use letters, numbers, - and _ only".to_string());
    }
    let kind = {
        let k = text("type");
        if k.is_empty() {
            "stdio".to_string()
        } else {
            k
        }
    };
    if !["stdio", "http", "sse"].contains(&kind.as_str()) {
        errs.push(format!(
            "server.type: \"{kind}\" must be stdio, http or sse"
        ));
    }
    if provider == "codex" && kind == "sse" {
        errs.push("server.type: Codex supports stdio and http only".into());
    }
    let command = text("command");
    let url = text("url");
    if kind == "stdio" && command.is_empty() {
        errs.push("server.command: required for stdio servers".into());
    }
    if kind != "stdio" {
        if url.is_empty() {
            errs.push("server.url: required for http/sse servers".into());
        } else if !(url.starts_with("http://") || url.starts_with("https://")) {
            errs.push("server.url: must start with http:// or https://".into());
        }
    }
    let mut args = vec![];
    match o.get("args") {
        None | Some(Value::Null) => {}
        Some(Value::Array(a)) => {
            for (i, x) in a.iter().enumerate() {
                match x.as_str() {
                    Some(t) => args.push(t.to_string()),
                    None => errs.push(format!("server.args[{i}]: must be text")),
                }
            }
        }
        Some(_) => errs.push("server.args: must be a list".into()),
    }
    let env = str_map(o.get("env"), "server.env")
        .map_err(|e| {
            errs.push(e);
        })
        .unwrap_or_default();
    let headers = str_map(o.get("headers"), "server.headers")
        .map_err(|e| {
            errs.push(e);
        })
        .unwrap_or_default();
    if !errs.is_empty() {
        return Err(errs.join("; "));
    }
    Ok(Form {
        name,
        kind,
        command,
        args,
        env,
        url,
        headers,
    })
}

fn apply_json_form(obj: &mut Map<String, Value>, f: &Form) {
    for k in ["type", "command", "args", "env", "url", "headers"] {
        obj.remove(k);
    }
    obj.insert("type".into(), json!(f.kind));
    if f.kind == "stdio" {
        obj.insert("command".into(), json!(f.command));
        if !f.args.is_empty() {
            obj.insert("args".into(), json!(f.args));
        }
        if !f.env.is_empty() {
            obj.insert("env".into(), Value::Object(f.env.clone()));
        }
    } else {
        obj.insert("url".into(), json!(f.url));
        if !f.headers.is_empty() {
            obj.insert("headers".into(), Value::Object(f.headers.clone()));
        }
    }
}
fn json_to_view(name: &str, v: &Value, scope: &str, path: &Path, enabled: Option<bool>) -> Value {
    let o = v.as_object().cloned().unwrap_or_default();
    let kind = o.get("type").and_then(|x| x.as_str()).unwrap_or(
        if o.contains_key("url") && !o.contains_key("command") {
            "http"
        } else {
            "stdio"
        },
    );
    json!({
        "name": name, "scope": scope, "type": kind,
        "command": o.get("command").and_then(|x| x.as_str()).unwrap_or(""),
        "args": o.get("args").cloned().unwrap_or(json!([])),
        "env": o.get("env").cloned().unwrap_or(json!({})),
        "url": o.get("url").and_then(|x| x.as_str()).unwrap_or(""),
        "headers": o.get("headers").cloned().unwrap_or(json!({})),
        "enabled": enabled, "source": path.display().to_string(),
    })
}

fn toml_str_map(item: Option<&Item>) -> Value {
    let mut m = Map::new();
    if let Some(t) = item.and_then(|i| i.as_table_like()) {
        for (k, v) in t.iter() {
            if let Some(x) = v.as_str() {
                m.insert(k.to_string(), json!(x));
            }
        }
    }
    Value::Object(m)
}
fn toml_to_view(name: &str, t: &dyn toml_edit::TableLike, path: &Path) -> Value {
    let text = |k: &str| t.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    let args: Vec<String> = t
        .get("args")
        .and_then(|a| a.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();
    let kind = if t.contains_key("url") && !t.contains_key("command") {
        "http"
    } else {
        "stdio"
    };
    json!({
        "name": name, "scope": "user", "type": kind, "command": text("command"), "args": args,
        "env": toml_str_map(t.get("env")), "url": text("url"), "headers": toml_str_map(t.get("http_headers")),
        "enabled": t.get("enabled").and_then(|x| x.as_bool()).unwrap_or(true), "source": path.display().to_string(),
    })
}
/// Replace a string value in place so trailing comments and ordering survive.
fn set_str(t: &mut Table, key: &str, text: &str) {
    if let Some(v) = t.get_mut(key).and_then(|i| i.as_value_mut()) {
        let decor = v.decor().clone();
        *v = text.into();
        *v.decor_mut() = decor;
    } else {
        t.insert(key, value(text));
    }
}
fn apply_toml_form(t: &mut Table, f: &Form) {
    let drop: &[&str] = if f.kind == "stdio" {
        &["url", "http_headers"]
    } else {
        &["command", "args", "env"]
    };
    for k in drop {
        t.remove(k);
    }
    for k in ["args", "env", "http_headers"] {
        t.remove(k);
    }
    let strs = |m: &Map<String, Value>| {
        let mut tb = Table::new();
        for (k, v) in m {
            tb.insert(k, value(v.as_str().unwrap_or("")));
        }
        tb
    };
    if f.kind == "stdio" {
        set_str(t, "command", &f.command);
        if !f.args.is_empty() {
            let mut a = Array::new();
            for x in &f.args {
                a.push(x.as_str());
            }
            t.insert("args", value(a));
        }
        if !f.env.is_empty() {
            t.insert("env", Item::Table(strs(&f.env)));
        }
    } else {
        set_str(t, "url", &f.url);
        if !f.headers.is_empty() {
            t.insert("http_headers", Item::Table(strs(&f.headers)));
        }
    }
}

fn disabled_project_servers(ctx: &Ctx) -> Vec<String> {
    let Some(p) = &ctx.project else { return vec![] };
    read_json(&p.join(".claude/settings.local.json"))
        .ok()
        .and_then(|v| {
            v.get("disabledMcpjsonServers")
                .and_then(|a| a.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_str().map(String::from))
                        .collect()
                })
        })
        .unwrap_or_default()
}

fn mcp_list(ctx: &Ctx) -> Res<Value> {
    let mut servers = vec![];
    let mut scopes = vec![json!({"id": "user", "label": "User", "path": ""})];
    let mut notes = vec![];
    if ctx.provider == "claude" {
        let path = claude_json(ctx);
        scopes[0]["path"] = json!(path.display().to_string());
        if let Some(m) = read_json(&path)?
            .get("mcpServers")
            .and_then(|v| v.as_object())
        {
            for (n, v) in m {
                servers.push(json_to_view(n, v, "user", &path, None));
            }
        }
        if let Some(p) = &ctx.project {
            let path = p.join(".mcp.json");
            scopes.push(
                json!({"id": "project", "label": "Project", "path": path.display().to_string()}),
            );
            let disabled = disabled_project_servers(ctx);
            if let Some(m) = read_json(&path)?
                .get("mcpServers")
                .and_then(|v| v.as_object())
            {
                for (n, v) in m {
                    servers.push(json_to_view(
                        n,
                        v,
                        "project",
                        &path,
                        Some(!disabled.contains(n)),
                    ));
                }
            }
        }
        notes.push("Claude Code has no enable/disable switch for user-scope servers; remove the server to stop it loading.");
    } else {
        let path = codex_toml(ctx);
        scopes[0]["path"] = json!(path.display().to_string());
        let doc = read_toml(&path)?;
        if let Some(t) = doc.get("mcp_servers").and_then(|i| i.as_table_like()) {
            for (n, v) in t.iter() {
                if let Some(tl) = v.as_table_like() {
                    servers.push(toml_to_view(n, tl, &path));
                }
            }
        }
    }
    Ok(json!({"servers": servers, "scopes": scopes, "notes": notes}))
}

fn mcp_save(ctx: &Ctx, req: &Request) -> Res<Value> {
    let form = parse_form(
        req.server.as_ref().ok_or("server: required")?,
        &ctx.provider,
    )?;
    let scope = req.scope.clone().unwrap_or_else(|| "user".into());
    let original = req.original_name.clone().filter(|n| !n.is_empty());
    let enabled = req.enabled;
    if ctx.provider == "codex" {
        if scope != "user" {
            return Err(
                "scope: Codex servers are stored in the profile config.toml (user scope)".into(),
            );
        }
        edit_toml(ctx, &codex_toml(ctx), |doc| {
            if !doc.contains_key("mcp_servers") {
                let mut t = Table::new();
                t.set_implicit(true);
                doc.insert("mcp_servers", Item::Table(t));
            }
            let servers = doc["mcp_servers"]
                .as_table_like_mut()
                .ok_or("mcp_servers: must be a table")?;
            if original.as_deref() != Some(form.name.as_str()) && servers.contains_key(&form.name) {
                return Err(format!("server.name: \"{}\" already exists", form.name));
            }
            let mut table = match original
                .as_deref()
                .and_then(|o| servers.get(o))
                .and_then(|i| i.as_table())
            {
                Some(t) => t.clone(),
                None => Table::new(),
            };
            if let Some(o) = original.as_deref() {
                servers.remove(o);
            }
            apply_toml_form(&mut table, &form);
            if let Some(e) = enabled {
                if e {
                    table.remove("enabled");
                } else {
                    table.insert("enabled", value(false));
                }
            }
            servers.insert(&form.name, Item::Table(table));
            Ok(())
        })?;
    } else {
        let path = match scope.as_str() {
            "user" => claude_json(ctx),
            "project" => need_project(ctx)?.join(".mcp.json"),
            o => return Err(format!("scope: unknown scope \"{o}\"")),
        };
        edit_json(ctx, &path, |root| {
            let servers = root.entry("mcpServers").or_insert_with(|| json!({}));
            let servers = servers
                .as_object_mut()
                .ok_or("mcpServers: must be an object")?;
            if original.as_deref() != Some(form.name.as_str()) && servers.contains_key(&form.name) {
                return Err(format!("server.name: \"{}\" already exists", form.name));
            }
            let mut obj = original
                .as_deref()
                .and_then(|o| servers.get(o))
                .and_then(|v| v.as_object())
                .cloned()
                .unwrap_or_default();
            if let Some(o) = original.as_deref() {
                servers.shift_remove(o);
            }
            apply_json_form(&mut obj, &form);
            servers.insert(form.name.clone(), Value::Object(obj));
            Ok(())
        })?;
    }
    mcp_list(ctx)
}

fn mcp_delete(ctx: &Ctx, req: &Request) -> Res<Value> {
    let name = s(&req.name, "name")?;
    let scope = req.scope.clone().unwrap_or_else(|| "user".into());
    if ctx.provider == "codex" {
        edit_toml(ctx, &codex_toml(ctx), |doc| {
            let t = doc
                .get_mut("mcp_servers")
                .and_then(|i| i.as_table_like_mut())
                .ok_or_else(|| format!("name: \"{name}\" not found"))?;
            t.remove(&name)
                .map(|_| ())
                .ok_or_else(|| format!("name: \"{name}\" not found"))
        })?;
    } else {
        let path = match scope.as_str() {
            "user" => claude_json(ctx),
            "project" => need_project(ctx)?.join(".mcp.json"),
            o => return Err(format!("scope: unknown scope \"{o}\"")),
        };
        edit_json(ctx, &path, |root| {
            let m = root
                .get_mut("mcpServers")
                .and_then(|v| v.as_object_mut())
                .ok_or_else(|| format!("name: \"{name}\" not found"))?;
            m.shift_remove(&name)
                .map(|_| ())
                .ok_or_else(|| format!("name: \"{name}\" not found"))
        })?;
    }
    mcp_list(ctx)
}

fn mcp_set_enabled(ctx: &Ctx, req: &Request) -> Res<Value> {
    let name = s(&req.name, "name")?;
    let enabled = req.enabled.ok_or("enabled: required")?;
    let scope = req.scope.clone().unwrap_or_else(|| "user".into());
    if ctx.provider == "codex" {
        edit_toml(ctx, &codex_toml(ctx), |doc| {
            let t = doc
                .get_mut("mcp_servers")
                .and_then(|i| i.as_table_like_mut())
                .and_then(|t| t.get_mut(&name))
                .and_then(|i| i.as_table_like_mut())
                .ok_or_else(|| format!("name: \"{name}\" not found"))?;
            if enabled {
                t.remove("enabled");
            } else {
                t.insert("enabled", value(false));
            }
            Ok(())
        })?;
    } else if scope == "project" {
        let path = settings_path(ctx, "local")?;
        edit_json(ctx, &path, |root| {
            let arr = root
                .entry("disabledMcpjsonServers")
                .or_insert_with(|| json!([]));
            let arr = arr
                .as_array_mut()
                .ok_or("disabledMcpjsonServers: must be a list")?;
            arr.retain(|x| x.as_str() != Some(name.as_str()));
            if !enabled {
                arr.push(json!(name));
            }
            if arr.is_empty() {
                root.shift_remove("disabledMcpjsonServers");
            }
            Ok(())
        })?;
    } else {
        return Err(
            "scope: Claude Code user-scope servers cannot be disabled; remove the server instead"
                .into(),
        );
    }
    mcp_list(ctx)
}

// ---------------------------------------------------------------- hooks

const HOOK_EVENTS: [&str; 12] = [
    "PreToolUse",
    "PostToolUse",
    "UserPromptSubmit",
    "Notification",
    "Stop",
    "SubagentStop",
    "PreCompact",
    "SessionStart",
    "SessionEnd",
    "PostToolUseFailure",
    "PermissionRequest",
    "SubagentStart",
];

fn hooks_list(ctx: &Ctx) -> Res<Value> {
    require_claude(ctx, "Hooks")?;
    let mut out = vec![];
    let mut scopes = vec![];
    let mut names = vec!["user", "project", "local"];
    if ctx.project.is_none() {
        names.retain(|n| *n == "user");
    }
    for scope in names {
        let path = settings_path(ctx, scope)?;
        scopes.push(json!({"id": scope, "path": path.display().to_string()}));
        let doc = read_json(&path)?;
        let Some(events) = doc.get("hooks").and_then(|h| h.as_object()) else {
            continue;
        };
        for (event, groups) in events {
            for (gi, g) in groups.as_array().into_iter().flatten().enumerate() {
                let matcher = g.get("matcher").and_then(|m| m.as_str()).unwrap_or("");
                for (hi, h) in g
                    .get("hooks")
                    .and_then(|h| h.as_array())
                    .into_iter()
                    .flatten()
                    .enumerate()
                {
                    let kind = h.get("type").and_then(|t| t.as_str()).unwrap_or("command");
                    let main = ["command", "prompt", "url"]
                        .iter()
                        .find_map(|k| h.get(*k).and_then(|x| x.as_str()))
                        .unwrap_or("");
                    out.push(json!({"scope": scope, "event": event, "matcher": matcher, "type": kind, "command": main,
                        "timeout": h.get("timeout").cloned().unwrap_or(Value::Null), "editable": kind == "command",
                        "locator": {"scope": scope, "event": event, "group": gi, "index": hi}}));
                }
            }
        }
    }
    Ok(json!({"hooks": out, "events": HOOK_EVENTS, "scopes": scopes}))
}

fn locator(v: &Option<Value>) -> Res<(String, String, usize, usize)> {
    let l = v.as_ref().ok_or("locator: required")?;
    let g = |k: &str| {
        l.get(k)
            .and_then(|x| x.as_u64())
            .map(|n| n as usize)
            .ok_or_else(|| format!("locator.{k}: required"))
    };
    Ok((
        l.get("scope")
            .and_then(|x| x.as_str())
            .ok_or("locator.scope: required")?
            .to_string(),
        l.get("event")
            .and_then(|x| x.as_str())
            .ok_or("locator.event: required")?
            .to_string(),
        g("group")?,
        g("index")?,
    ))
}
fn remove_hook(root: &mut Map<String, Value>, event: &str, group: usize, index: usize) -> Res<()> {
    let events = root
        .get_mut("hooks")
        .and_then(|h| h.as_object_mut())
        .ok_or("hooks: not found (the file changed since it was loaded)")?;
    let groups = events
        .get_mut(event)
        .and_then(|g| g.as_array_mut())
        .ok_or_else(|| {
            format!("hooks.{event}: not found (the file changed since it was loaded)")
        })?;
    let hooks = groups
        .get_mut(group)
        .and_then(|g| g.get_mut("hooks"))
        .and_then(|h| h.as_array_mut())
        .ok_or_else(|| format!("hooks.{event}[{group}]: not found"))?;
    if index >= hooks.len() {
        return Err(format!("hooks.{event}[{group}].hooks[{index}]: not found"));
    }
    hooks.remove(index);
    if hooks.is_empty() {
        groups.remove(group);
    }
    if groups.is_empty() {
        events.shift_remove(event);
    }
    if events.is_empty() {
        root.shift_remove("hooks");
    }
    Ok(())
}

fn hooks_save(ctx: &Ctx, req: &Request) -> Res<Value> {
    require_claude(ctx, "Hooks")?;
    let scope = s(&req.scope, "scope")?;
    let h = req.hook.as_ref().ok_or("hook: required")?;
    let event = h
        .get("event")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let matcher = h
        .get("matcher")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let command = h
        .get("command")
        .and_then(|x| x.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let mut errs = vec![];
    if event.is_empty() {
        errs.push("hook.event: required".to_string());
    } else if !event.chars().all(|c| c.is_ascii_alphanumeric()) {
        errs.push("hook.event: letters and numbers only".to_string());
    }
    if command.is_empty() {
        errs.push("hook.command: required".to_string());
    }
    let timeout = match h.get("timeout") {
        None | Some(Value::Null) => None,
        Some(v) => match v.as_u64().filter(|n| *n > 0) {
            Some(n) => Some(n),
            None => {
                errs.push("hook.timeout: must be a positive whole number of seconds".into());
                None
            }
        },
    };
    if !errs.is_empty() {
        return Err(errs.join("; "));
    }
    let old = if req.locator.is_some() {
        Some(locator(&req.locator)?)
    } else {
        None
    };
    let path = settings_path(ctx, &scope)?;
    edit_json(ctx, &path, |root| {
        let mut updated = false;
        if let Some((osc, oev, og, oi)) = &old {
            if *osc != scope {
                return Err(
                    "locator.scope: cannot move a hook between files; delete and re-add it".into(),
                );
            }
            let same_matcher = root
                .get("hooks")
                .and_then(|h| h.get(oev))
                .and_then(|g| g.get(*og))
                .map(|g| g.get("matcher").and_then(|m| m.as_str()).unwrap_or("") == matcher)
                .unwrap_or(false);
            if *oev == event && same_matcher {
                let hook = root
                    .get_mut("hooks")
                    .and_then(|h| h.get_mut(oev))
                    .and_then(|g| g.get_mut(*og))
                    .and_then(|g| g.get_mut("hooks"))
                    .and_then(|h| h.get_mut(*oi))
                    .and_then(|h| h.as_object_mut())
                    .ok_or("locator: hook not found (the file changed since it was loaded)")?;
                hook.insert("command".into(), json!(command));
                match timeout {
                    Some(t) => {
                        hook.insert("timeout".into(), json!(t));
                    }
                    None => {
                        hook.remove("timeout");
                    }
                }
                updated = true;
            } else {
                remove_hook(root, oev, *og, *oi)?;
            }
        }
        if updated {
            return Ok(());
        }
        let hooks = root
            .entry("hooks")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("hooks: must be an object")?;
        let groups = hooks
            .entry(event.clone())
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .ok_or_else(|| format!("hooks.{event}: must be a list"))?;
        let mut entry = Map::new();
        entry.insert("type".into(), json!("command"));
        entry.insert("command".into(), json!(command));
        if let Some(t) = timeout {
            entry.insert("timeout".into(), json!(t));
        }
        if let Some(g) = groups
            .iter_mut()
            .find(|g| g.get("matcher").and_then(|m| m.as_str()).unwrap_or("") == matcher)
        {
            let list = g
                .as_object_mut()
                .ok_or_else(|| format!("hooks.{event}: group must be an object"))?
                .entry("hooks")
                .or_insert_with(|| json!([]));
            list.as_array_mut()
                .ok_or_else(|| format!("hooks.{event}.hooks: must be a list"))?
                .push(Value::Object(entry));
        } else {
            let mut g = Map::new();
            if !matcher.is_empty() {
                g.insert("matcher".into(), json!(matcher));
            }
            g.insert("hooks".into(), json!([Value::Object(entry)]));
            groups.push(Value::Object(g));
        }
        Ok(())
    })?;
    hooks_list(ctx)
}

fn hooks_delete(ctx: &Ctx, req: &Request) -> Res<Value> {
    require_claude(ctx, "Hooks")?;
    let (scope, event, g, i) = locator(&req.locator)?;
    let path = settings_path(ctx, &scope)?;
    edit_json(ctx, &path, |root| remove_hook(root, &event, g, i))?;
    hooks_list(ctx)
}

// ---------------------------------------------------------------- plugins

fn plugins_list(ctx: &Ctx) -> Res<Value> {
    require_claude(ctx, "Plugin")?;
    let dir = ctx.home.join("plugins");
    let installed = read_json(&dir.join("installed_plugins.json"))?;
    let settings = read_json(&ctx.home.join("settings.json"))?;
    let enabled = settings
        .get("enabledPlugins")
        .and_then(|e| e.as_object())
        .cloned()
        .unwrap_or_default();
    let mut plugins: Vec<Value> = vec![];
    let mut seen = std::collections::HashSet::new();
    if let Some(m) = installed.get("plugins").and_then(|p| p.as_object()) {
        for (key, installs) in m {
            seen.insert(key.clone());
            let first = installs
                .as_array()
                .and_then(|a| a.first())
                .cloned()
                .unwrap_or(json!({}));
            plugins.push(plugin_view(key, true, &enabled, &first));
        }
    }
    for key in enabled.keys() {
        if !seen.contains(key) {
            plugins.push(plugin_view(key, false, &enabled, &json!({})));
        }
    }
    let mut markets = vec![];
    if let Some(m) = read_json(&dir.join("known_marketplaces.json"))?.as_object() {
        for (name, v) in m {
            markets.push(json!({"name": name, "source": v.get("source").cloned().unwrap_or(Value::Null), "lastUpdated": v.get("lastUpdated").cloned().unwrap_or(Value::Null)}));
        }
    }
    let default_profile = ctx.home == ctx.user_home.join(".claude");
    let prefix = if default_profile {
        String::new()
    } else {
        format!(
            "CLAUDE_CONFIG_DIR={} ",
            shell_quote(&ctx.home.display().to_string())
        )
    };
    Ok(
        json!({"plugins": plugins, "marketplaces": markets, "commandPrefix": prefix, "settingsPath": ctx.home.join("settings.json").display().to_string()}),
    )
}
fn shell_quote(t: &str) -> String {
    format!("'{}'", t.replace('\'', "'\\''"))
}
fn plugin_view(key: &str, installed: bool, enabled: &Map<String, Value>, first: &Value) -> Value {
    let (name, market) = key.split_once('@').unwrap_or((key, ""));
    json!({"id": key, "name": name, "marketplace": market, "installed": installed, "enabled": enabled.get(key).and_then(|v| v.as_bool()).unwrap_or(false),
        "version": first.get("version").cloned().unwrap_or(Value::Null), "scope": first.get("scope").cloned().unwrap_or(Value::Null)})
}
fn plugins_set_enabled(ctx: &Ctx, req: &Request) -> Res<Value> {
    require_claude(ctx, "Plugin")?;
    let id = s(&req.plugin, "plugin")?;
    let on = req.enabled.ok_or("enabled: required")?;
    edit_json(ctx, &ctx.home.join("settings.json"), |root| {
        let e = root
            .entry("enabledPlugins")
            .or_insert_with(|| json!({}))
            .as_object_mut()
            .ok_or("enabledPlugins: must be an object")?;
        e.insert(id.clone(), json!(on));
        Ok(())
    })?;
    plugins_list(ctx)
}

// ---------------------------------------------------------------- memory

fn memory_path(ctx: &Ctx, id: &str) -> Res<PathBuf> {
    match id {
        "user" => Ok(ctx.home.join(if ctx.provider == "claude" {
            "CLAUDE.md"
        } else {
            "AGENTS.md"
        })),
        "project_claude" => Ok(need_project(ctx)
            .map_err(|_| "memory: select a project first".to_string())?
            .join("CLAUDE.md")),
        "project_agents" => Ok(need_project(ctx)
            .map_err(|_| "memory: select a project first".to_string())?
            .join("AGENTS.md")),
        o => Err(format!("memory: unknown file \"{o}\"")),
    }
}
fn memory_list(ctx: &Ctx) -> Res<Value> {
    let mut ids = vec![("user", "User memory")];
    if ctx.project.is_some() {
        ids.push(("project_claude", "Project CLAUDE.md"));
        ids.push(("project_agents", "Project AGENTS.md"));
    }
    let files: Vec<Value> = ids.into_iter().map(|(id, label)| {
        let p = memory_path(ctx, id).expect("known id");
        json!({"id": id, "label": if id == "user" { format!("{label} ({})", p.file_name().and_then(|n| n.to_str()).unwrap_or("")) } else { label.to_string() }, "path": p.display().to_string(), "exists": p.is_file()})
    }).collect();
    Ok(json!({"files": files}))
}
fn memory_read(ctx: &Ctx, req: &Request) -> Res<Value> {
    let p = memory_path(ctx, &s(&req.memory, "memory")?)?;
    Ok(
        json!({"path": p.display().to_string(), "exists": p.is_file(), "content": read_text(&p)?.unwrap_or_default()}),
    )
}
fn memory_write(ctx: &Ctx, req: &Request) -> Res<Value> {
    let p = memory_path(ctx, &s(&req.memory, "memory")?)?;
    let content = req.content.clone().ok_or("content: required")?;
    if read_text(&p)?.as_deref() != Some(content.as_str()) {
        write_text(ctx, &p, &content)?;
    }
    memory_read(ctx, req)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Env {
        dir: PathBuf,
        root: PathBuf,
        user: PathBuf,
        home: PathBuf,
        project: PathBuf,
    }
    impl Env {
        fn new(provider: &str) -> Env {
            let dir = std::env::temp_dir().join(format!(
                "freddai-agent-config-{}",
                uuid::Uuid::new_v4().simple()
            ));
            let (root, user, project) = (dir.join("root"), dir.join("user"), dir.join("proj"));
            let home = user.join(if provider == "claude" {
                "profile-claude"
            } else {
                ".codex"
            });
            for d in [&root, &user, &home, &project] {
                fs::create_dir_all(d).unwrap();
            }
            Env {
                dir,
                root,
                user,
                home,
                project,
            }
        }
        fn call(&self, provider: &str, f: impl FnOnce(&mut Request)) -> Res<Value> {
            let mut r = Request {
                provider: provider.into(),
                config_home: Some(self.home.display().to_string()),
                project: Some(self.project.display().to_string()),
                ..Default::default()
            };
            f(&mut r);
            handle_with_home(&self.root, Some(self.user.clone()), r)
        }
        fn backups(&self) -> usize {
            fs::read_dir(self.root.join("agent-config-backups"))
                .map(|d| d.count())
                .unwrap_or(0)
        }
    }
    impl Drop for Env {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn claude_mcp_round_trip_preserves_unknown_keys_and_backs_up() {
        let e = Env::new("claude");
        let file = e.home.join(".claude.json");
        fs::write(&file, r#"{"zeta":1,"numStartups":7,"mcpServers":{"old":{"type":"stdio","command":"x","extra":{"keep":true}}},"projects":{"a":{}}}"#).unwrap();
        e.call("claude", |r| { r.op = "mcp_save".into(); r.scope = Some("user".into()); r.original_name = Some("old".into());
            r.server = Some(json!({"name":"old","type":"stdio","command":"node","args":["s.js"],"env":{"API_KEY":"abc"}})); }).unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&file).unwrap()).unwrap();
        assert_eq!(v["zeta"], 1);
        assert_eq!(v["projects"], json!({"a":{}}));
        assert_eq!(v["mcpServers"]["old"]["extra"], json!({"keep":true}));
        assert_eq!(v["mcpServers"]["old"]["command"], "node");
        assert_eq!(v["mcpServers"]["old"]["env"]["API_KEY"], "abc");
        assert_eq!(e.backups(), 1);
        let keys: Vec<_> = v.as_object().unwrap().keys().cloned().collect();
        assert_eq!(keys, ["zeta", "numStartups", "mcpServers", "projects"]);
        let listed = e.call("claude", |r| r.op = "mcp_list".into()).unwrap();
        assert_eq!(listed["servers"][0]["args"], json!(["s.js"]));
    }

    #[test]
    fn mcp_validation_reports_field_paths_and_does_not_write() {
        let e = Env::new("claude");
        let err = e
            .call("claude", |r| {
                r.op = "mcp_save".into();
                r.server = Some(json!({"name":"bad name","type":"http","url":"ftp://x"}));
            })
            .unwrap_err();
        assert!(
            err.contains("server.name") && err.contains("server.url"),
            "{err}"
        );
        assert!(!e.home.join(".claude.json").exists());
        fs::write(e.home.join(".claude.json"), "{ not json").unwrap();
        let err = e
            .call("claude", |r| {
                r.op = "mcp_list".into();
            })
            .unwrap_err();
        assert!(
            err.contains(".claude.json") && err.contains("invalid JSON"),
            "{err}"
        );
    }

    #[test]
    fn project_mcp_and_disable_toggle() {
        let e = Env::new("claude");
        e.call("claude", |r| { r.op = "mcp_save".into(); r.scope = Some("project".into()); r.server = Some(json!({"name":"web","type":"http","url":"https://x.test/mcp","headers":{"Authorization":"Bearer t"}})); }).unwrap();
        assert!(e.project.join(".mcp.json").exists());
        let v = e
            .call("claude", |r| {
                r.op = "mcp_set_enabled".into();
                r.scope = Some("project".into());
                r.name = Some("web".into());
                r.enabled = Some(false);
            })
            .unwrap();
        assert_eq!(v["servers"][0]["enabled"], false);
        let local: Value = serde_json::from_str(
            &fs::read_to_string(e.project.join(".claude/settings.local.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(local["disabledMcpjsonServers"], json!(["web"]));
    }

    #[test]
    fn codex_toml_preserves_comments_and_unknown_keys() {
        let e = Env::new("codex");
        let file = e.home.join("config.toml");
        fs::write(&file, "# my config\nmodel = \"gpt\"\n\n[mcp_servers.fs]\ncommand = \"npx\" # runner\nstartup_timeout_sec = 20\n\n[profiles.x]\nmodel = \"y\"\n").unwrap();
        e.call("codex", |r| { r.op = "mcp_save".into(); r.original_name = Some("fs".into()); r.server = Some(json!({"name":"fs","type":"stdio","command":"npx","args":["-y","fs"],"env":{"TOKEN":"s"}})); }).unwrap();
        e.call("codex", |r| {
            r.op = "mcp_set_enabled".into();
            r.name = Some("fs".into());
            r.enabled = Some(false);
        })
        .unwrap();
        let text = fs::read_to_string(&file).unwrap();
        assert!(
            text.contains("# my config")
                && text.contains("# runner")
                && text.contains("startup_timeout_sec = 20")
                && text.contains("[profiles.x]"),
            "{text}"
        );
        assert!(
            text.contains("enabled = false") && text.contains("TOKEN"),
            "{text}"
        );
        assert_eq!(e.backups(), 2);
        let l = e.call("codex", |r| r.op = "mcp_list".into()).unwrap();
        assert_eq!(l["servers"][0]["enabled"], false);
        assert_eq!(l["servers"][0]["args"], json!(["-y", "fs"]));
        e.call("codex", |r| {
            r.op = "mcp_delete".into();
            r.name = Some("fs".into());
        })
        .unwrap();
        assert!(!fs::read_to_string(&file)
            .unwrap()
            .contains("[mcp_servers.fs]"));
    }

    #[test]
    fn hooks_add_edit_delete() {
        let e = Env::new("claude");
        let settings = e.home.join("settings.json");
        fs::write(&settings, r#"{"model":"opus","hooks":{"Stop":[{"hooks":[{"type":"command","command":"echo a"}]}]}}"#).unwrap();
        let v = e
            .call("claude", |r| {
                r.op = "hooks_save".into();
                r.scope = Some("user".into());
                r.hook = Some(
                    json!({"event":"PreToolUse","matcher":"Bash","command":"check.sh","timeout":5}),
                );
            })
            .unwrap();
        assert_eq!(v["hooks"].as_array().unwrap().len(), 2);
        let h = v["hooks"]
            .as_array()
            .unwrap()
            .iter()
            .find(|h| h["event"] == "PreToolUse")
            .unwrap()
            .clone();
        e.call("claude", |r| {
            r.op = "hooks_save".into();
            r.scope = Some("user".into());
            r.locator = Some(h["locator"].clone());
            r.hook = Some(json!({"event":"PreToolUse","matcher":"Bash","command":"check2.sh"}));
        })
        .unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        assert_eq!(doc["model"], "opus");
        assert_eq!(
            doc["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
            "check2.sh"
        );
        assert!(doc["hooks"]["PreToolUse"][0]["hooks"][0]
            .get("timeout")
            .is_none());
        e.call("claude", |r| {
            r.op = "hooks_delete".into();
            r.locator = Some(h["locator"].clone());
        })
        .unwrap();
        let doc: Value = serde_json::from_str(&fs::read_to_string(&settings).unwrap()).unwrap();
        assert!(doc["hooks"].get("PreToolUse").is_none() && doc["hooks"].get("Stop").is_some());
        let err = e
            .call("claude", |r| {
                r.op = "hooks_save".into();
                r.scope = Some("user".into());
                r.hook = Some(json!({"event":"","command":"","timeout":0}));
            })
            .unwrap_err();
        assert!(
            err.contains("hook.event")
                && err.contains("hook.command")
                && err.contains("hook.timeout"),
            "{err}"
        );
    }

    #[test]
    fn plugins_list_and_toggle() {
        let e = Env::new("claude");
        fs::create_dir_all(e.home.join("plugins")).unwrap();
        fs::write(
            e.home.join("plugins/installed_plugins.json"),
            r#"{"version":2,"plugins":{"foo@mk":[{"scope":"user","version":"1.0"}]}}"#,
        )
        .unwrap();
        fs::write(
            e.home.join("plugins/known_marketplaces.json"),
            r#"{"mk":{"source":{"source":"github","repo":"a/b"}}}"#,
        )
        .unwrap();
        fs::write(
            e.home.join("settings.json"),
            r#"{"theme":"dark","enabledPlugins":{"foo@mk":true}}"#,
        )
        .unwrap();
        let v = e.call("claude", |r| r.op = "plugins_list".into()).unwrap();
        assert_eq!(v["plugins"][0]["enabled"], true);
        assert_eq!(v["marketplaces"][0]["name"], "mk");
        assert!(v["commandPrefix"]
            .as_str()
            .unwrap()
            .starts_with("CLAUDE_CONFIG_DIR="));
        let v = e
            .call("claude", |r| {
                r.op = "plugins_set_enabled".into();
                r.plugin = Some("foo@mk".into());
                r.enabled = Some(false);
            })
            .unwrap();
        assert_eq!(v["plugins"][0]["enabled"], false);
        assert!(fs::read_to_string(e.home.join("settings.json"))
            .unwrap()
            .contains("\"theme\": \"dark\""));
    }

    #[test]
    fn memory_write_backs_up_and_rejects_unknown_ids() {
        let e = Env::new("claude");
        fs::write(e.home.join("CLAUDE.md"), "old").unwrap();
        e.call("claude", |r| {
            r.op = "memory_write".into();
            r.memory = Some("user".into());
            r.content = Some("new\n".into());
        })
        .unwrap();
        assert_eq!(
            fs::read_to_string(e.home.join("CLAUDE.md")).unwrap(),
            "new\n"
        );
        assert_eq!(e.backups(), 1);
        e.call("claude", |r| {
            r.op = "memory_write".into();
            r.memory = Some("project_agents".into());
            r.content = Some("p".into());
        })
        .unwrap();
        assert!(e.project.join("AGENTS.md").exists());
        assert!(e
            .call("claude", |r| {
                r.op = "memory_read".into();
                r.memory = Some("../etc".into());
            })
            .is_err());
    }
}
