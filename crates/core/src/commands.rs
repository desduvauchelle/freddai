//! Composer helpers: provider-aware slash command discovery, Codex custom prompt expansion and project file listing.
//! Only commands that really execute are listed: Claude Code accepts them as stream-json prompt text, ACP agents
//! advertise their own through `available_commands_update`, and Codex custom prompts are expanded by the host
//! before the text is sent (Codex app-server has no slash command protocol).
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct SlashCommand {
    pub name: String,
    pub description: String,
    #[serde(rename = "argumentHint")]
    pub argument_hint: String,
    pub source: String,
}

fn cmd(name: &str, description: &str, hint: &str, source: &str) -> SlashCommand {
    SlashCommand {
        name: name.into(),
        description: description.into(),
        argument_hint: hint.into(),
        source: source.into(),
    }
}

/// Built-ins that Claude Code runs when sent as a prompt over `--input-format stream-json`.
/// Interactive-only commands (/clear, /model, /config, /login ...) are deliberately absent.
const CLAUDE_BUILTINS: &[(&str, &str, &str)] = &[
    (
        "compact",
        "Summarize the conversation to free up context",
        "[focus instructions]",
    ),
    ("init", "Create a CLAUDE.md for this project", ""),
    ("review", "Review a pull request", "[pull request]"),
    (
        "security-review",
        "Review pending changes for security issues",
        "",
    ),
];

static DYNAMIC: OnceLock<Mutex<HashMap<String, Vec<SlashCommand>>>> = OnceLock::new();
fn dynamic() -> &'static Mutex<HashMap<String, Vec<SlashCommand>>> {
    DYNAMIC.get_or_init(Default::default)
}

/// Remember the commands an ACP agent advertised, per thread and per provider (so a new draft sees them too).
pub fn record_acp(session: &str, provider: &str, commands: &Value) {
    let list: Vec<SlashCommand> = commands
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|c| {
                    let name = c["name"].as_str()?.trim_start_matches('/');
                    if name.is_empty() {
                        return None;
                    }
                    Some(cmd(
                        name,
                        c["description"].as_str().unwrap_or(""),
                        c["input"]["hint"].as_str().unwrap_or(""),
                        "agent",
                    ))
                })
                .collect()
        })
        .unwrap_or_default();
    let mut map = dynamic().lock().unwrap();
    map.insert(format!("session:{session}"), list.clone());
    map.insert(format!("provider:{provider}"), list);
}

/// Remember the `slash_commands` list from Claude's `system` init event for this thread.
pub fn record_claude_init(session: &str, names: &Value) {
    let list: Vec<SlashCommand> = names
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|n| n.as_str())
                .map(|n| cmd(n.trim_start_matches('/'), "", "", "claude"))
                .collect()
        })
        .unwrap_or_default();
    if !list.is_empty() {
        dynamic()
            .lock()
            .unwrap()
            .insert(format!("session:{session}"), list);
    }
}

fn recorded(key: &str) -> Vec<SlashCommand> {
    dynamic()
        .lock()
        .unwrap()
        .get(key)
        .cloned()
        .unwrap_or_default()
}

/// Parse `---` YAML-ish frontmatter (flat `key: value`, optional folded continuation lines) and return (fields, body).
pub fn parse_frontmatter(text: &str) -> (HashMap<String, String>, String) {
    let mut fields = HashMap::new();
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines();
    if lines.next().map(str::trim_end) != Some("---") {
        return (fields, text.to_string());
    }
    let mut body_start = None;
    let mut consumed = 4;
    let mut key: Option<String> = None;
    for line in lines {
        consumed += line.len() + 1;
        if line.trim_end() == "---" {
            body_start = Some(consumed.min(text.len()));
            break;
        }
        if line.starts_with(' ') || line.starts_with('\t') {
            if let Some(k) = &key {
                let entry: &mut String = fields.entry(k.clone()).or_default();
                if !entry.is_empty() {
                    entry.push(' ');
                }
                entry.push_str(line.trim());
            }
            continue;
        }
        if let Some((k, v)) = line.split_once(':') {
            let k = k.trim().to_string();
            let v = v.trim();
            let v = if matches!(v, ">" | "|" | ">-" | "|-") {
                ""
            } else {
                v
            };
            let v = v.trim_matches(|c| c == '"' || c == '\'');
            fields.insert(k.clone(), v.to_string());
            key = Some(k);
        }
    }
    match body_start {
        Some(i) => (fields, text.get(i..).unwrap_or("").to_string()),
        None => (HashMap::new(), text.to_string()),
    }
}

fn first_line(body: &str) -> String {
    body.lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.starts_with('#'))
        .unwrap_or("")
        .to_string()
}

fn clip(s: String) -> String {
    if s.chars().count() <= 200 {
        s
    } else {
        format!("{}…", s.chars().take(199).collect::<String>())
    }
}

fn markdown_files(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    for e in entries {
        let path = e.path();
        if path.is_dir() {
            if depth < 4 {
                markdown_files(&path, depth + 1, out);
            }
        } else if path.extension().is_some_and(|x| x == "md") {
            out.push(path);
        }
    }
}

/// `<dir>/**/*.md` as commands; subdirectories namespace the name as `ns:name`.
fn command_dir(dir: &Path, prefix: &str, source: &str) -> Vec<SlashCommand> {
    let mut files = Vec::new();
    markdown_files(dir, 0, &mut files);
    files
        .into_iter()
        .filter_map(|path| {
            let rel = path.strip_prefix(dir).ok()?.with_extension("");
            let name = rel
                .components()
                .map(|c| c.as_os_str().to_string_lossy().into_owned())
                .collect::<Vec<_>>()
                .join(":");
            let (f, body) = parse_frontmatter(&fs::read_to_string(&path).ok()?);
            let description = f
                .get("description")
                .cloned()
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| first_line(&body));
            Some(cmd(
                &format!("{prefix}{name}"),
                &clip(description),
                f.get("argument-hint").map(String::as_str).unwrap_or(""),
                source,
            ))
        })
        .collect()
}

/// `<dir>/*/SKILL.md` as commands named by frontmatter `name` (or the folder).
fn skill_dir(dir: &Path, prefix: &str, source: &str) -> Vec<SlashCommand> {
    let Ok(entries) = fs::read_dir(dir) else {
        return vec![];
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    entries
        .into_iter()
        .filter_map(|e| {
            let text = fs::read_to_string(e.path().join("SKILL.md")).ok()?;
            let (f, body) = parse_frontmatter(&text);
            if f.get("user-invocable").is_some_and(|v| v == "false") {
                return None;
            }
            let name = f
                .get("name")
                .cloned()
                .filter(|n| !n.is_empty())
                .unwrap_or_else(|| e.file_name().to_string_lossy().into_owned());
            let description = f
                .get("description")
                .cloned()
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| first_line(&body));
            Some(cmd(
                &format!("{prefix}{name}"),
                &clip(description),
                f.get("argument-hint").map(String::as_str).unwrap_or(""),
                source,
            ))
        })
        .collect()
}

/// Installed plugins: any folder (bounded depth) holding `.claude-plugin/plugin.json`.
fn plugin_roots(dir: &Path, depth: usize, out: &mut Vec<(String, PathBuf)>) {
    if let Ok(text) = fs::read_to_string(dir.join(".claude-plugin/plugin.json")) {
        let name = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v["name"].as_str().map(String::from))
            .unwrap_or_else(|| {
                dir.file_name()
                    .map(|n| n.to_string_lossy().into_owned())
                    .unwrap_or_default()
            });
        out.push((name, dir.to_path_buf()));
        return;
    }
    if depth >= 5 {
        return;
    }
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| std::cmp::Reverse(e.file_name()));
    for e in entries {
        if e.path().is_dir() {
            plugin_roots(&e.path(), depth + 1, out);
        }
    }
}

fn claude_commands(home: &Path, project: Option<&Path>) -> Vec<SlashCommand> {
    let mut out: Vec<SlashCommand> = CLAUDE_BUILTINS
        .iter()
        .map(|(n, d, h)| cmd(n, d, h, "builtin"))
        .collect();
    if let Some(p) = project {
        out.extend(command_dir(&p.join(".claude/commands"), "", "project"));
        out.extend(skill_dir(&p.join(".claude/skills"), "", "project-skill"));
    }
    out.extend(command_dir(&home.join("commands"), "", "user"));
    out.extend(skill_dir(&home.join("skills"), "", "user-skill"));
    let mut roots = Vec::new();
    plugin_roots(&home.join("plugins"), 0, &mut roots);
    for (plugin, root) in roots {
        let prefix = format!("{plugin}:");
        out.extend(command_dir(&root.join("commands"), &prefix, "plugin"));
        out.extend(skill_dir(&root.join("skills"), &prefix, "plugin-skill"));
    }
    out
}

fn codex_commands(home: &Path) -> Vec<SlashCommand> {
    let Ok(entries) = fs::read_dir(home.join("prompts")) else {
        return vec![];
    };
    let mut entries: Vec<_> = entries.filter_map(Result::ok).collect();
    entries.sort_by_key(|e| e.file_name());
    entries
        .into_iter()
        .filter_map(|e| {
            let path = e.path();
            if path.extension().is_none_or(|x| x != "md") {
                return None;
            }
            let stem = path.file_stem()?.to_string_lossy().into_owned();
            let (f, body) = parse_frontmatter(&fs::read_to_string(&path).ok()?);
            let description = f
                .get("description")
                .cloned()
                .filter(|d| !d.is_empty())
                .unwrap_or_else(|| first_line(&body));
            Some(cmd(
                &format!("prompts:{stem}"),
                &clip(description),
                f.get("argument-hint").map(String::as_str).unwrap_or(""),
                "codex-prompt",
            ))
        })
        .collect()
}

/// Merge in order; the first definition of a name wins.
fn dedupe(list: Vec<SlashCommand>) -> Vec<SlashCommand> {
    let mut seen = std::collections::HashSet::new();
    let mut out: Vec<SlashCommand> = Vec::new();
    for c in list {
        if seen.insert(c.name.clone()) {
            out.push(c);
        } else if let Some(prev) = out.iter_mut().find(|p| p.name == c.name) {
            if prev.description.is_empty() {
                prev.description = c.description;
            }
            if prev.argument_hint.is_empty() {
                prev.argument_hint = c.argument_hint;
            }
        }
    }
    out
}

/// `home` is the provider's configuration folder for the selected account (for example `~/.claude`).
pub fn discover(
    provider: &str,
    home: Option<&Path>,
    project: Option<&Path>,
    session: Option<&str>,
) -> Vec<SlashCommand> {
    let mut list = match provider {
        "claude" => {
            let mut v = home
                .map(|h| claude_commands(h, project))
                .unwrap_or_default();
            if let Some(s) = session {
                v.extend(recorded(&format!("session:{s}")));
            }
            v
        }
        "codex" => home.map(codex_commands).unwrap_or_default(),
        "gemini" | "antigravity" | "grok" | "opencode" | "cursor" | "copilot" => {
            let mut v = session
                .map(|s| recorded(&format!("session:{s}")))
                .unwrap_or_default();
            if v.is_empty() {
                v = recorded(&format!("provider:{provider}"));
            }
            v
        }
        _ => vec![],
    };
    list = dedupe(list);
    list.sort_by(|a, b| a.name.cmp(&b.name));
    list
}

pub fn default_home(provider: &str, configured: Option<&Path>) -> Option<PathBuf> {
    if let Some(p) = configured {
        return Some(p.to_path_buf());
    }
    let folder = match provider {
        "claude" => ".claude",
        "codex" => ".codex",
        _ => return None,
    };
    let key = if provider == "claude" {
        "CLAUDE_CONFIG_DIR"
    } else {
        "CODEX_HOME"
    };
    std::env::var_os(key)
        .map(PathBuf::from)
        .or_else(|| crate::platform::home_dir().map(|h| h.join(folder)))
}

/// Expand `/prompts:name args` with the Codex custom prompt file. Other text is returned untouched.
pub fn expand_codex_prompt(prompt: &str, home: Option<&Path>) -> Result<String, String> {
    let trimmed = prompt.trim_start();
    let Some(rest) = trimmed.strip_prefix("/prompts:") else {
        return Ok(prompt.to_string());
    };
    let (name, args) = match rest.split_once(char::is_whitespace) {
        Some((n, a)) => (n, a.trim()),
        None => (rest, ""),
    };
    if name.is_empty() || name.contains(['/', '\\']) || name.contains("..") {
        return Err("Invalid Codex prompt name".into());
    }
    let home = home.ok_or("Cannot locate the Codex configuration folder")?;
    let path = home.join("prompts").join(format!("{name}.md"));
    let text = fs::read_to_string(&path).map_err(|_| {
        format!(
            "Codex has no custom prompt named /prompts:{name} (looked for {})",
            path.display()
        )
    })?;
    let (_, mut body) = parse_frontmatter(&text);
    let tokens: Vec<&str> = args.split_whitespace().collect();
    let mut named: Vec<(&str, &str)> = tokens.iter().filter_map(|t| t.split_once('=')).collect();
    named.sort_by_key(|(k, _)| std::cmp::Reverse(k.len()));
    body = body.replace("$$", "\u{0}");
    for (k, v) in &named {
        body = body.replace(&format!("${k}"), v.trim_matches('"'));
    }
    for n in (1..=9).rev() {
        body = body.replace(&format!("${n}"), tokens.get(n - 1).copied().unwrap_or(""));
    }
    body = body.replace("$ARGUMENTS", args).replace('\u{0}', "$");
    Ok(body)
}

const FILE_CAP: usize = 50_000;
const FILE_TTL: Duration = Duration::from_secs(30);
static FILES: OnceLock<Mutex<HashMap<PathBuf, (Instant, Vec<String>)>>> = OnceLock::new();

/// Project-relative files respecting .gitignore (git when available, else a bounded walk). Cached per project.
pub fn list_files(root: &Path) -> Result<Vec<String>, String> {
    if !root.is_dir() {
        return Err(format!("Project folder {} does not exist", root.display()));
    }
    let cache = FILES.get_or_init(Default::default);
    if let Some((at, v)) = cache.lock().unwrap().get(root) {
        if at.elapsed() < FILE_TTL {
            return Ok(v.clone());
        }
    }
    let files = git_files(root).unwrap_or_else(|| walk_files(root));
    cache
        .lock()
        .unwrap()
        .insert(root.to_path_buf(), (Instant::now(), files.clone()));
    Ok(files)
}

fn git_files(root: &Path) -> Option<Vec<String>> {
    let out = crate::platform::quiet_command("git")
        .arg("-C")
        .arg(root)
        .args(["ls-files", "-co", "--exclude-standard", "-z"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let mut files: Vec<String> = out
        .stdout
        .split(|b| *b == 0)
        .filter(|s| !s.is_empty())
        .map(|s| String::from_utf8_lossy(s).into_owned())
        .filter(|f| root.join(f).is_file())
        .take(FILE_CAP)
        .collect();
    files.sort();
    files.dedup();
    Some(files)
}

fn walk_files(root: &Path) -> Vec<String> {
    const SKIP: &[&str] = &[
        "node_modules",
        "target",
        "dist",
        "build",
        "__pycache__",
        "venv",
    ];
    let mut out = Vec::new();
    let mut stack = vec![(root.to_path_buf(), 0usize)];
    while let Some((dir, depth)) = stack.pop() {
        let Ok(entries) = fs::read_dir(&dir) else {
            continue;
        };
        for e in entries.filter_map(Result::ok) {
            let name = e.file_name().to_string_lossy().into_owned();
            let Ok(kind) = e.file_type() else { continue };
            if kind.is_symlink() {
                continue;
            }
            if kind.is_dir() {
                if depth < 12 && !name.starts_with('.') && !SKIP.contains(&name.as_str()) {
                    stack.push((e.path(), depth + 1));
                }
            } else if let Ok(rel) = e.path().strip_prefix(root) {
                out.push(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"));
                if out.len() >= FILE_CAP {
                    out.sort();
                    return out;
                }
            }
        }
    }
    out.sort();
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    fn temp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("freddai-cmd-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    #[test]
    fn frontmatter_fields_and_body() {
        let (f, body) = parse_frontmatter("---\ndescription: \"Fix it\"\nargument-hint: [issue]\nlong: >\n  one\n  two\n---\nBody here\n");
        assert_eq!(f["description"], "Fix it");
        assert_eq!(f["argument-hint"], "[issue]");
        assert_eq!(f["long"], "one two");
        assert_eq!(body, "Body here\n");
        let (f, body) = parse_frontmatter("no frontmatter");
        assert!(f.is_empty());
        assert_eq!(body, "no frontmatter");
    }
    #[test]
    fn claude_discovers_user_project_skill_and_plugin_commands() {
        let home = temp("claude-home");
        let project = temp("claude-project");
        fs::create_dir_all(home.join("commands/team")).unwrap();
        fs::write(
            home.join("commands/team/ship.md"),
            "---\ndescription: Ship it\nargument-hint: <env>\n---\nDeploy $ARGUMENTS",
        )
        .unwrap();
        fs::create_dir_all(project.join(".claude/commands")).unwrap();
        fs::write(
            project.join(".claude/commands/lint.md"),
            "Run the linter\nmore",
        )
        .unwrap();
        fs::create_dir_all(home.join("skills/pdf")).unwrap();
        fs::write(
            home.join("skills/pdf/SKILL.md"),
            "---\nname: pdf\ndescription: Work with PDFs\n---\n",
        )
        .unwrap();
        let plugin = home.join("plugins/cache/mk/tools/1.0.0");
        fs::create_dir_all(plugin.join(".claude-plugin")).unwrap();
        fs::create_dir_all(plugin.join("commands")).unwrap();
        fs::write(
            plugin.join(".claude-plugin/plugin.json"),
            r#"{"name":"tools"}"#,
        )
        .unwrap();
        fs::write(
            plugin.join("commands/fmt.md"),
            "---\ndescription: Format\n---\n",
        )
        .unwrap();
        let list = discover("claude", Some(&home), Some(&project), None);
        let by = |n: &str| {
            list.iter()
                .find(|c| c.name == n)
                .unwrap_or_else(|| panic!("missing {n}: {list:?}"))
        };
        assert_eq!(by("team:ship").description, "Ship it");
        assert_eq!(by("team:ship").argument_hint, "<env>");
        assert_eq!(by("team:ship").source, "user");
        assert_eq!(by("lint").description, "Run the linter");
        assert_eq!(by("lint").source, "project");
        assert_eq!(by("pdf").source, "user-skill");
        assert_eq!(by("tools:fmt").source, "plugin");
        assert_eq!(by("compact").source, "builtin");
        assert!(!list.iter().any(|c| c.name == "clear"));
    }
    #[test]
    fn claude_init_commands_merge_without_duplicates() {
        record_claude_init(
            "t-init",
            &serde_json::json!(["compact", "custom-from-init"]),
        );
        let list = discover("claude", None, None, Some("t-init"));
        assert_eq!(list.iter().filter(|c| c.name == "compact").count(), 1);
        assert!(list.iter().any(|c| c.name == "custom-from-init"));
    }
    #[test]
    fn acp_uses_advertised_commands_only() {
        assert!(discover("gemini", None, None, Some("never-seen")).is_empty());
        record_acp(
            "t-acp",
            "grok",
            &serde_json::json!([{"name":"/web","description":"Search","input":{"hint":"query"}}]),
        );
        let list = discover("grok", None, None, Some("t-acp"));
        assert_eq!(list, vec![cmd("web", "Search", "query", "agent")]);
        assert_eq!(discover("grok", None, None, None).len(), 1);
    }
    #[test]
    fn codex_lists_and_expands_custom_prompts() {
        let home = temp("codex-home");
        fs::create_dir_all(home.join("prompts")).unwrap();
        fs::write(home.join("prompts/fix.md"), "---\ndescription: Fix an issue\nargument-hint: ISSUE=<n>\n---\nFix $ISSUE. Also $1 and all: $ARGUMENTS. Cost $$5").unwrap();
        let list = discover("codex", Some(&home), None, None);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].name, "prompts:fix");
        assert_eq!(list[0].description, "Fix an issue");
        let expanded = expand_codex_prompt("/prompts:fix ISSUE=42 extra", Some(&home)).unwrap();
        assert_eq!(
            expanded,
            "Fix 42. Also ISSUE=42 and all: ISSUE=42 extra. Cost $5"
        );
        assert_eq!(
            expand_codex_prompt("hello /prompts:x", Some(&home)).unwrap(),
            "hello /prompts:x"
        );
        assert_eq!(
            expand_codex_prompt("/Users/me/file.txt", Some(&home)).unwrap(),
            "/Users/me/file.txt"
        );
        assert!(expand_codex_prompt("/prompts:missing", Some(&home))
            .unwrap_err()
            .contains("no custom prompt"));
        assert!(expand_codex_prompt("/prompts:../x", Some(&home)).is_err());
    }
    #[test]
    fn walk_skips_heavy_and_hidden_folders() {
        let root = temp("walk");
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules/x")).unwrap();
        fs::create_dir_all(root.join(".git")).unwrap();
        fs::write(root.join("src/a.rs"), "").unwrap();
        fs::write(root.join("node_modules/x/i.js"), "").unwrap();
        fs::write(root.join(".git/HEAD"), "").unwrap();
        assert_eq!(list_files(&root).unwrap(), vec!["src/a.rs".to_string()]);
    }
    #[test]
    fn git_listing_respects_gitignore() {
        let root = temp("git");
        let git = |args: &[&str]| {
            assert!(crate::platform::quiet_command("git")
                .arg("-C")
                .arg(&root)
                .args(args)
                .output()
                .unwrap()
                .status
                .success())
        };
        git(&["init", "-q"]);
        fs::write(root.join(".gitignore"), "secret.txt\n").unwrap();
        fs::write(root.join("keep.txt"), "").unwrap();
        fs::write(root.join("secret.txt"), "").unwrap();
        let files = list_files(&root).unwrap();
        assert!(files.contains(&"keep.txt".to_string()));
        assert!(!files.contains(&"secret.txt".to_string()));
    }
}
