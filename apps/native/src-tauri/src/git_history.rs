//! Read-only git summary for a project folder (branch, uncommitted changes, recent commits).
use serde::Serialize;
use std::{path::Path, process::Command};

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct GitChange {
    pub path: String,
    pub orig_path: Option<String>,
    /// "staged" | "unstaged" | "untracked" | "conflicted"
    pub group: String,
    /// "modified" | "added" | "deleted" | "renamed" | "copied" | "typechange" | "untracked" | "conflicted"
    pub status: String,
    /// Short badge: M, A, D, R, C, T, ??, U
    pub code: String,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct GitCommit {
    pub hash: String,
    pub parents: Vec<String>,
    pub refs: Vec<String>,
    pub subject: String,
    pub author: String,
    pub date: String,
}

#[derive(Debug, Serialize, Default, PartialEq, Eq, Clone)]
pub struct GitCounts {
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicted: usize,
    /// Distinct files with any uncommitted change.
    pub files: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct GitHistory {
    pub branch: String,
    pub detached: bool,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub changes: Vec<GitChange>,
    pub counts: GitCounts,
    pub commits: Vec<GitCommit>,
}

fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    let out = freddai_core::platform::quiet_command("git")
        .arg("--no-optional-locks")
        .arg("-C")
        .arg(dir)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .output()
        .map_err(|e| format!("Could not run git: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(if err.is_empty() {
            format!("git {} failed ({})", args.join(" "), out.status)
        } else {
            err
        })
    }
}

fn describe(c: char) -> (&'static str, &'static str) {
    match c {
        'M' => ("modified", "M"),
        'A' => ("added", "A"),
        'D' => ("deleted", "D"),
        'R' => ("renamed", "R"),
        'C' => ("copied", "C"),
        'T' => ("typechange", "T"),
        _ => ("modified", "M"),
    }
}

fn is_conflict(x: char, y: char) -> bool {
    matches!((x, y), ('D', 'D') | ('A', 'A') | ('U', _) | (_, 'U'))
}

/// Parse `git status --porcelain=v1 -z` output.
pub fn parse_status(raw: &str) -> Result<(Vec<GitChange>, GitCounts), String> {
    let mut changes = Vec::new();
    let mut counts = GitCounts::default();
    let mut parts = raw.split('\0');
    while let Some(entry) = parts.next() {
        if entry.is_empty() {
            continue;
        }
        let mut chars = entry.chars();
        let (x, y) = (chars.next(), chars.next());
        let (Some(x), Some(y)) = (x, y) else {
            return Err(format!("Unrecognized git status entry: {entry:?}"));
        };
        if entry.chars().nth(2) != Some(' ') {
            return Err(format!("Unrecognized git status entry: {entry:?}"));
        }
        let path = entry.chars().skip(3).collect::<String>();
        // In -z mode a rename/copy is followed by its source path as a separate field.
        let orig = if matches!(x, 'R' | 'C') || matches!(y, 'R' | 'C') {
            parts.next().map(str::to_string)
        } else {
            None
        };
        let mut push = |group: &str, status: &str, code: &str, orig: Option<String>| {
            changes.push(GitChange {
                path: path.clone(),
                orig_path: orig,
                group: group.into(),
                status: status.into(),
                code: code.into(),
            });
        };
        if x == '?' && y == '?' {
            push("untracked", "untracked", "??", None);
            counts.untracked += 1;
        } else if x == '!' {
            continue; // ignored
        } else if is_conflict(x, y) {
            push("conflicted", "conflicted", "U", None);
            counts.conflicted += 1;
        } else {
            if x != ' ' {
                let (s, c) = describe(x);
                push("staged", s, c, orig.clone());
                counts.staged += 1;
            }
            if y != ' ' {
                let (s, c) = describe(y);
                push("unstaged", s, c, if x == ' ' { orig } else { None });
                counts.unstaged += 1;
            }
        }
        counts.files += 1;
    }
    Ok((changes, counts))
}

/// Parse `git log --format=%h%x1f%s%x1f%an%x1f%aI%x1e` output.
pub fn parse_log(raw: &str) -> Result<Vec<GitCommit>, String> {
    raw.split('\x1e')
        .map(|r| r.trim_matches(|c| c == '\n' || c == '\r'))
        .filter(|r| !r.is_empty())
        .map(|record| {
            let f: Vec<&str> = record.split('\x1f').collect();
            if f.len() != 6 {
                return Err(format!("Unrecognized git log record: {record:?}"));
            }
            Ok(GitCommit {
                hash: f[0].into(),
                parents: f[4].split_whitespace().map(str::to_string).collect(),
                refs: f[5].split(", ").filter(|s| !s.is_empty()).map(str::to_string).collect(),
                subject: f[1].into(),
                author: f[2].into(),
                date: f[3].into(),
            })
        })
        .collect()
}

pub fn read(path: &str) -> Result<GitHistory, String> {
    let dir = Path::new(path);
    if !dir.is_dir() {
        return Err(format!("Project folder not found: {path}"));
    }
    git(dir, &["rev-parse", "--is-inside-work-tree"])?;
    let (changes, counts) = parse_status(&git(dir, &["status", "--porcelain=v1", "-z"])?)?;
    let branch = git(dir, &["branch", "--show-current"])?.trim().to_string();
    let detached = branch.is_empty();
    let branch = if detached {
        match git(dir, &["rev-parse", "--short", "HEAD"]) {
            Ok(h) => format!("detached at {}", h.trim()),
            Err(_) => "no commits yet".into(),
        }
    } else {
        branch
    };
    // No upstream is normal; it is reported as None rather than an error.
    let upstream = git(dir, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let (mut ahead, mut behind) = (0, 0);
    if upstream.is_some() {
        let counts = git(dir, &["rev-list", "--left-right", "--count", "@{u}...HEAD"])?;
        let mut n = counts.split_whitespace().map(|v| v.parse::<u32>());
        match (n.next(), n.next()) {
            (Some(Ok(b)), Some(Ok(a))) => (behind, ahead) = (b, a),
            _ => return Err(format!("Unrecognized rev-list output: {counts:?}")),
        }
    }
    let head = if git(dir, &["rev-parse", "--verify", "HEAD"]).is_ok() { "HEAD" } else { "--all" };
    let commits = match git(
        dir,
        &["log", "--all", head, "--topo-order", "-n", "300", "--decorate=short", "--format=%H%x1f%s%x1f%an%x1f%aI%x1f%P%x1f%D%x1e"],
    ) {
        Ok(raw) => parse_log(&raw)?,
        Err(e) if e.contains("does not have any commits yet") => Vec::new(),
        Err(e) => return Err(e),
    };
    Ok(GitHistory { branch, detached, upstream, ahead, behind, changes, counts, commits })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_groups_staged_unstaged_untracked_and_renames() {
        let raw = "M  a.rs\0 M b.rs\0MM c.rs\0A  d.rs\0 D e.rs\0R  new.rs\0old.rs\0?? f.txt\0UU g.rs\0!! ignored\0";
        let (c, n) = parse_status(raw).unwrap();
        assert_eq!(n, GitCounts { staged: 4, unstaged: 3, untracked: 1, conflicted: 1, files: 8 });
        assert!(c.iter().any(|x| x.path == "a.rs" && x.group == "staged" && x.code == "M"));
        assert!(c.iter().any(|x| x.path == "c.rs" && x.group == "unstaged"));
        assert!(c.iter().any(|x| x.path == "c.rs" && x.group == "staged"));
        let r = c.iter().find(|x| x.code == "R").unwrap();
        assert_eq!((r.path.as_str(), r.orig_path.as_deref()), ("new.rs", Some("old.rs")));
        assert!(c.iter().any(|x| x.path == "f.txt" && x.code == "??" && x.group == "untracked"));
        assert!(c.iter().any(|x| x.path == "g.rs" && x.group == "conflicted"));
        assert!(!c.iter().any(|x| x.path == "ignored"));
    }

    #[test]
    fn status_rejects_garbage_and_accepts_empty() {
        assert!(parse_status("").unwrap().0.is_empty());
        assert!(parse_status("x\0").is_err());
    }

    #[test]
    fn log_parses_records_and_rejects_malformed() {
        let raw = "abc123\x1ffix: thing | pipe\x1fAda\x1f2026-11-03T10:00:00+00:00\x1fdef456\x1fHEAD -> main, origin/main\x1e\ndef456\x1fsecond\x1fBob\x1f2026-11-02T09:00:00+00:00\x1f\x1f\x1e";
        let c = parse_log(raw).unwrap();
        assert_eq!(c.len(), 2);
        assert_eq!(c[0].subject, "fix: thing | pipe");
        assert_eq!(c[1].author, "Bob");
        assert_eq!(c[0].parents, vec!["def456"]);
        assert_eq!(c[0].refs, vec!["HEAD -> main", "origin/main"]);
        assert!(parse_log("a\x1fb\x1e").is_err());
    }

    #[test]
    fn read_reports_git_errors_for_non_repos() {
        let dir = std::env::temp_dir().join(format!("freddai-nogit-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let err = read(dir.to_str().unwrap()).unwrap_err();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(err.to_lowercase().contains("not a git repository"), "{err}");
        assert!(read("/nonexistent/freddai-path").unwrap_err().contains("not found"));
    }
}
