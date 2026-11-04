//! Git write actions for the Git pane and the thread-list "Save & push" button. Everything shells out
//! to the `git` / `gh` CLIs with explicit argument vectors (no shell), in the project directory, and
//! returns the CLI's stderr verbatim on failure. There is no force-push path.
use serde::Serialize;
use std::{
    path::Path,
    process::{Command, Stdio},
};

/// Maximum diff bytes returned to the viewer / sent for message generation.
const DIFF_CAP: usize = 400_000;

#[derive(Debug, Serialize, PartialEq, Eq, Clone, Default)]
pub struct GitStatusSummary {
    pub branch: String,
    pub upstream: Option<String>,
    pub ahead: u32,
    pub behind: u32,
    pub staged: usize,
    pub unstaged: usize,
    pub untracked: usize,
    pub conflicted: usize,
    /// Distinct files with an uncommitted change.
    pub files: usize,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct ShipPreview {
    pub stat: String,
    pub diff: String,
    pub files: Vec<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq, Clone)]
pub struct PrStatus {
    pub available: bool,
    pub reason: String,
}

fn failure(program: &str, args: &[&str], out: &std::process::Output) -> String {
    let err = String::from_utf8_lossy(&out.stderr).trim().to_string();
    if !err.is_empty() {
        return err;
    }
    let o = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if !o.is_empty() {
        return o;
    }
    format!("{program} {} failed ({})", args.join(" "), out.status)
}

fn run(program: &str, dir: &Path, args: &[&str], ok_codes: &[i32]) -> Result<String, String> {
    if !dir.is_dir() {
        return Err(format!("Project folder not found: {}", dir.display()));
    }
    let mut cmd = Command::new(program);
    if program == "git" {
        cmd.arg("-C").arg(dir);
    } else {
        cmd.current_dir(dir);
    }
    let out = cmd
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GH_PROMPT_DISABLED", "1")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("Could not run {program}: {e}"))?;
    if out.status.success() || out.status.code().is_some_and(|c| ok_codes.contains(&c)) {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        Err(failure(program, args, &out))
    }
}
fn git(dir: &Path, args: &[&str]) -> Result<String, String> {
    run("git", dir, args, &[])
}
fn has_head(dir: &Path) -> bool {
    git(dir, &["rev-parse", "--verify", "-q", "HEAD"]).is_ok()
}
fn safe_ref(name: &str) -> Result<&str, String> {
    let n = name.trim();
    if n.is_empty() || n.starts_with('-') {
        return Err(format!("Invalid branch name: {name:?}"));
    }
    Ok(n)
}
fn safe_files(files: &[String]) -> Result<(), String> {
    if files.is_empty() {
        return Err("No files given".into());
    }
    if files.iter().any(|f| f.is_empty() || f.contains('\0')) {
        return Err("Invalid file path".into());
    }
    Ok(())
}
fn with_files<'a>(mut base: Vec<&'a str>, files: &'a [String]) -> Vec<&'a str> {
    base.push("--");
    base.extend(files.iter().map(String::as_str));
    base
}

/// Parse `git status --porcelain=v2 -b` output.
pub fn parse_status_v2(raw: &str) -> Result<GitStatusSummary, String> {
    let mut s = GitStatusSummary::default();
    for line in raw.lines() {
        if let Some(h) = line.strip_prefix("# ") {
            if let Some(b) = h.strip_prefix("branch.head ") {
                s.branch = if b == "(detached)" { "detached HEAD".into() } else { b.into() };
            } else if let Some(u) = h.strip_prefix("branch.upstream ") {
                s.upstream = Some(u.into());
            } else if let Some(ab) = h.strip_prefix("branch.ab ") {
                let mut p = ab.split_whitespace();
                let (a, b) = (p.next().and_then(|v| v.strip_prefix('+')), p.next().and_then(|v| v.strip_prefix('-')));
                match (a.and_then(|v| v.parse().ok()), b.and_then(|v| v.parse().ok())) {
                    (Some(a), Some(b)) => (s.ahead, s.behind) = (a, b),
                    _ => return Err(format!("Unrecognized branch.ab line: {line:?}")),
                }
            }
            continue;
        }
        let mut f = line.splitn(3, ' ');
        match (f.next(), f.next()) {
            (Some("1" | "2"), Some(xy)) => {
                let mut c = xy.chars();
                let (x, y) = (c.next().unwrap_or('.'), c.next().unwrap_or('.'));
                if x != '.' {
                    s.staged += 1;
                }
                if y != '.' {
                    s.unstaged += 1;
                }
                s.files += 1;
            }
            (Some("u"), _) => {
                s.conflicted += 1;
                s.files += 1;
            }
            (Some("?"), _) => {
                s.untracked += 1;
                s.files += 1;
            }
            (Some("!"), _) => {}
            _ => return Err(format!("Unrecognized git status line: {line:?}")),
        }
    }
    Ok(s)
}

pub fn status(path: &str) -> Result<GitStatusSummary, String> {
    parse_status_v2(&git(Path::new(path), &["--no-optional-locks", "status", "--porcelain=v2", "-b"])?)
}

fn cap(mut s: String) -> String {
    if s.len() > DIFF_CAP {
        let mut end = DIFF_CAP;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        s.truncate(end);
        s.push_str("\n… diff truncated …\n");
    }
    s
}

/// Unified diff of one file. `group` is staged | unstaged | untracked | conflicted.
pub fn diff_file(path: &str, file: &str, group: &str) -> Result<String, String> {
    let dir = Path::new(path);
    let file = [file.to_string()];
    safe_files(&file)?;
    let out = match group {
        "staged" if has_head(dir) => git(dir, &with_files(vec!["diff", "--cached", "--no-color"], &file))?,
        "staged" => git(dir, &with_files(vec!["diff", "--cached", "--no-color"], &file))?,
        "untracked" => run("git", dir, &["diff", "--no-index", "--no-color", "--", "/dev/null", &file[0]], &[1])?,
        _ => git(dir, &with_files(vec!["diff", "--no-color"], &file))?,
    };
    Ok(cap(out))
}

pub fn stage(path: &str, files: &[String]) -> Result<(), String> {
    safe_files(files)?;
    git(Path::new(path), &with_files(vec!["add", "-A"], files)).map(|_| ())
}
pub fn stage_all(path: &str) -> Result<(), String> {
    git(Path::new(path), &["add", "-A"]).map(|_| ())
}
pub fn unstage(path: &str, files: &[String]) -> Result<(), String> {
    safe_files(files)?;
    let dir = Path::new(path);
    if has_head(dir) {
        git(dir, &with_files(vec!["restore", "--staged"], files)).map(|_| ())
    } else {
        git(dir, &with_files(vec!["rm", "--cached", "-r", "-q"], files)).map(|_| ())
    }
}
pub fn unstage_all(path: &str) -> Result<(), String> {
    let dir = Path::new(path);
    if has_head(dir) {
        git(dir, &["reset", "-q"]).map(|_| ())
    } else {
        git(dir, &["rm", "--cached", "-r", "-q", "--", "."]).map(|_| ())
    }
}
/// Throws away changes to one file. `group` is staged | unstaged | untracked | conflicted.
pub fn discard(path: &str, file: &str, group: &str, code: &str) -> Result<(), String> {
    let dir = Path::new(path);
    let f = [file.to_string()];
    safe_files(&f)?;
    match (group, code) {
        ("untracked", _) => git(dir, &with_files(vec!["clean", "-f", "-d"], &f)),
        ("staged", "A") => git(dir, &with_files(vec!["rm", "-f", "-q"], &f)),
        ("staged", _) => git(dir, &with_files(vec!["restore", "--source=HEAD", "--staged", "--worktree"], &f)),
        _ => git(dir, &with_files(vec!["restore"], &f)),
    }
    .map(|_| ())
}

pub fn commit(path: &str, message: &str, all: bool) -> Result<String, String> {
    if message.trim().is_empty() {
        return Err("Commit message is empty.".into());
    }
    let dir = Path::new(path);
    if all {
        git(dir, &["add", "-A"])?;
    }
    git(dir, &["commit", "-q", "-m", message])?;
    Ok(git(dir, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

/// Pushes the current branch, setting its upstream first if missing. Never forces.
pub fn push(path: &str) -> Result<String, String> {
    let dir = Path::new(path);
    let branch = git(dir, &["branch", "--show-current"])?.trim().to_string();
    if branch.is_empty() {
        return Err("Cannot push a detached HEAD. Switch to a branch first.".into());
    }
    let has_upstream = git(dir, &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]).is_ok();
    if has_upstream {
        return git(dir, &["push"]).map(|_| format!("Pushed {branch}"));
    }
    let remotes = git(dir, &["remote"])?;
    let mut names = remotes.lines().map(str::trim).filter(|l| !l.is_empty());
    let remote = if names.clone().any(|n| n == "origin") { "origin" } else { names.next().ok_or("No git remote is configured. Add one (git remote add origin <url>) before pushing.")? };
    git(dir, &["push", "--set-upstream", remote, &branch]).map(|_| format!("Pushed {branch} and set upstream {remote}/{branch}"))
}

pub fn pull(path: &str) -> Result<String, String> {
    git(Path::new(path), &["pull", "--ff-only"]).map(|o| o.trim().to_string())
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct BranchList {
    pub current: String,
    pub branches: Vec<String>,
}
pub fn branches(path: &str) -> Result<BranchList, String> {
    let dir = Path::new(path);
    let current = git(dir, &["branch", "--show-current"])?.trim().to_string();
    let branches = git(dir, &["for-each-ref", "--format=%(refname:short)", "refs/heads"])?.lines().map(str::to_string).filter(|l| !l.is_empty()).collect();
    Ok(BranchList { current, branches })
}
pub fn switch_branch(path: &str, name: &str, create: bool) -> Result<(), String> {
    let name = safe_ref(name)?;
    let args: Vec<&str> = if create { vec!["switch", "-c", name] } else { vec!["switch", name] };
    git(Path::new(path), &args).map(|_| ())
}

/// Whether the GitHub CLI can create a PR here; the reason is shown verbatim when it cannot.
pub fn pr_status(path: &str) -> PrStatus {
    let dir = Path::new(path);
    if let Err(e) = run("gh", dir, &["--version"], &[]) {
        return PrStatus { available: false, reason: format!("GitHub CLI (gh) is not installed or not runnable: {e}") };
    }
    match run("gh", dir, &["auth", "status"], &[]) {
        Ok(_) => PrStatus { available: true, reason: String::new() },
        Err(e) => PrStatus { available: false, reason: format!("GitHub CLI is not signed in: {e}") },
    }
}
pub fn create_pr(path: &str, title: &str, body: &str) -> Result<String, String> {
    if title.trim().is_empty() {
        return Err("Pull request title is empty.".into());
    }
    run("gh", Path::new(path), &["pr", "create", "--title", title, "--body", body], &[]).map(|o| o.trim().to_string())
}

/// Everything the commit-message generator needs, without staging anything.
pub fn ship_preview(path: &str) -> Result<ShipPreview, String> {
    let dir = Path::new(path);
    let (stat, mut diff) = if has_head(dir) {
        (git(dir, &["diff", "HEAD", "--stat"])?, git(dir, &["diff", "HEAD", "--no-color"])?)
    } else {
        (git(dir, &["diff", "--cached", "--stat"])?, git(dir, &["diff", "--cached", "--no-color"])?)
    };
    let raw = git(dir, &["--no-optional-locks", "status", "--porcelain=v1", "-z", "-uall"])?;
    let mut files = Vec::new();
    let mut parts = raw.split('\0');
    while let Some(e) = parts.next() {
        if e.len() < 4 {
            continue;
        }
        let (code, name) = e.split_at(3);
        if code.starts_with(['R', 'C']) {
            parts.next();
        }
        files.push(name.to_string());
        if code.starts_with("??") {
            diff.push_str(&format!("\n# new untracked file: {name}\n"));
        }
    }
    Ok(ShipPreview { stat, diff: cap(diff), files })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, path::PathBuf};

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("freddai-gitact-{name}-{}-{:?}", std::process::id(), std::time::Instant::now()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }
    fn sh(dir: &Path, args: &[&str]) -> String {
        git(dir, args).unwrap_or_else(|e| panic!("git {args:?}: {e}"))
    }
    fn repo(name: &str) -> (PathBuf, PathBuf) {
        let bare = tmp(&format!("{name}-bare"));
        sh(&bare, &["init", "-q", "--bare", "-b", "main"]);
        let work = tmp(name);
        sh(&work, &["init", "-q", "-b", "main"]);
        sh(&work, &["config", "user.email", "t@example.com"]);
        sh(&work, &["config", "user.name", "T"]);
        sh(&work, &["config", "commit.gpgsign", "false"]);
        sh(&work, &["remote", "add", "origin", bare.to_str().unwrap()]);
        (work, bare)
    }
    fn p(d: &Path) -> &str {
        d.to_str().unwrap()
    }

    #[test]
    fn status_v2_parses_branch_and_counts() {
        let raw = "# branch.oid abc\n# branch.head main\n# branch.upstream origin/main\n# branch.ab +2 -1\n1 M. N... 100644 100644 100644 a b a.rs\n1 .M N... 100644 100644 100644 a b b.rs\n1 MM N... 100644 100644 100644 a b c.rs\n2 R. N... 100644 100644 100644 a b R100 new.rs\told.rs\nu UU N... 1 2 3 4 a b g.rs\n? f.txt\n! ign\n";
        let s = parse_status_v2(raw).unwrap();
        assert_eq!((s.branch.as_str(), s.upstream.as_deref(), s.ahead, s.behind), ("main", Some("origin/main"), 2, 1));
        assert_eq!((s.staged, s.unstaged, s.untracked, s.conflicted, s.files), (3, 2, 1, 1, 6));
        assert!(parse_status_v2("garbage line\n").is_err());
    }

    #[test]
    fn stage_commit_push_to_bare_remote_sets_upstream() {
        let (w, bare) = repo("flow");
        fs::write(w.join("a.txt"), "one\n").unwrap();
        assert_eq!(status(p(&w)).unwrap().untracked, 1);
        assert!(diff_file(p(&w), "a.txt", "untracked").unwrap().contains("+one"));
        stage(p(&w), &["a.txt".into()]).unwrap();
        let s = status(p(&w)).unwrap();
        assert_eq!((s.staged, s.untracked), (1, 0));
        assert!(diff_file(p(&w), "a.txt", "staged").unwrap().contains("+one"));
        unstage(p(&w), &["a.txt".into()]).unwrap();
        assert_eq!(status(p(&w)).unwrap().untracked, 1);
        assert!(commit(p(&w), "  ", true).unwrap_err().contains("empty"));
        commit(p(&w), "first", true).unwrap();
        assert_eq!(status(p(&w)).unwrap().files, 0);
        let msg = push(p(&w)).unwrap();
        assert!(msg.contains("set upstream"), "{msg}");
        let st = status(p(&w)).unwrap();
        assert_eq!((st.upstream.as_deref(), st.ahead), (Some("origin/main"), 0));
        assert!(sh(&bare, &["log", "--format=%s", "main"]).contains("first"));
        // second change pushes without re-setting upstream
        fs::write(w.join("a.txt"), "two\n").unwrap();
        assert!(diff_file(p(&w), "a.txt", "unstaged").unwrap().contains("+two"));
        commit(p(&w), "second", true).unwrap();
        assert_eq!(status(p(&w)).unwrap().ahead, 1);
        assert_eq!(push(p(&w)).unwrap(), "Pushed main");
    }

    #[test]
    fn push_rejected_when_behind_surfaces_stderr_and_pull_ff_recovers() {
        let (w, bare) = repo("behind");
        fs::write(w.join("a.txt"), "1\n").unwrap();
        commit(p(&w), "init", true).unwrap();
        push(p(&w)).unwrap();
        // a second clone pushes ahead of us
        let other = tmp("behind-other");
        sh(&other, &["clone", "-q", bare.to_str().unwrap(), "."]);
        sh(&other, &["config", "user.email", "o@example.com"]);
        sh(&other, &["config", "user.name", "O"]);
        fs::write(other.join("b.txt"), "x\n").unwrap();
        commit(p(&other), "remote work", true).unwrap();
        push(p(&other)).unwrap();
        fs::write(w.join("c.txt"), "y\n").unwrap();
        commit(p(&w), "local work", true).unwrap();
        let err = push(p(&w)).unwrap_err();
        assert!(err.contains("rejected") || err.contains("fetch first") || err.contains("non-fast-forward"), "{err}");
        // diverged: ff-only pull must fail loudly, never merge
        let err = pull(p(&w)).unwrap_err();
        assert!(!err.is_empty());
    }

    #[test]
    fn pull_fast_forwards() {
        let (w, bare) = repo("ff");
        fs::write(w.join("a.txt"), "1\n").unwrap();
        commit(p(&w), "init", true).unwrap();
        push(p(&w)).unwrap();
        let other = tmp("ff-other");
        sh(&other, &["clone", "-q", bare.to_str().unwrap(), "."]);
        sh(&other, &["config", "user.email", "o@example.com"]);
        sh(&other, &["config", "user.name", "O"]);
        fs::write(other.join("b.txt"), "x\n").unwrap();
        commit(p(&other), "remote", true).unwrap();
        push(p(&other)).unwrap();
        sh(&w, &["fetch", "-q"]);
        assert_eq!(status(p(&w)).unwrap().behind, 1);
        pull(p(&w)).unwrap();
        assert!(w.join("b.txt").exists());
    }

    #[test]
    fn push_without_remote_or_on_detached_head_is_an_error() {
        let w = tmp("noremote");
        sh(&w, &["init", "-q", "-b", "main"]);
        sh(&w, &["config", "user.email", "t@example.com"]);
        sh(&w, &["config", "user.name", "T"]);
        fs::write(w.join("a"), "1").unwrap();
        commit(p(&w), "init", true).unwrap();
        assert!(push(p(&w)).unwrap_err().contains("No git remote"));
        sh(&w, &["checkout", "-q", "--detach"]);
        assert!(push(p(&w)).unwrap_err().contains("detached"));
    }

    #[test]
    fn discard_and_unstage_variants() {
        let (w, _b) = repo("discard");
        fs::write(w.join("a.txt"), "1\n").unwrap();
        commit(p(&w), "init", true).unwrap();
        fs::write(w.join("a.txt"), "changed\n").unwrap();
        discard(p(&w), "a.txt", "unstaged", "M").unwrap();
        assert_eq!(fs::read_to_string(w.join("a.txt")).unwrap(), "1\n");
        fs::write(w.join("a.txt"), "staged change\n").unwrap();
        stage(p(&w), &["a.txt".into()]).unwrap();
        discard(p(&w), "a.txt", "staged", "M").unwrap();
        assert_eq!(fs::read_to_string(w.join("a.txt")).unwrap(), "1\n");
        assert_eq!(status(p(&w)).unwrap().files, 0);
        fs::write(w.join("n.txt"), "new\n").unwrap();
        stage(p(&w), &["n.txt".into()]).unwrap();
        discard(p(&w), "n.txt", "staged", "A").unwrap();
        assert!(!w.join("n.txt").exists());
        fs::write(w.join("u.txt"), "u\n").unwrap();
        discard(p(&w), "u.txt", "untracked", "??").unwrap();
        assert!(!w.join("u.txt").exists());
        fs::write(w.join("x.txt"), "x\n").unwrap();
        fs::write(w.join("y.txt"), "y\n").unwrap();
        stage_all(p(&w)).unwrap();
        assert_eq!(status(p(&w)).unwrap().staged, 2);
        unstage_all(p(&w)).unwrap();
        assert_eq!(status(p(&w)).unwrap().untracked, 2);
    }

    #[test]
    fn unstage_in_unborn_repo_and_errors_are_verbatim() {
        let (w, _b) = repo("unborn");
        fs::write(w.join("a.txt"), "1\n").unwrap();
        stage_all(p(&w)).unwrap();
        unstage_all(p(&w)).unwrap();
        assert_eq!(status(p(&w)).unwrap().untracked, 1);
        let err = stage(p(&w), &["missing.txt".into()]).unwrap_err();
        assert!(err.contains("did not match any files"), "{err}");
        let nongit = tmp("nongit");
        assert!(status(p(&nongit)).unwrap_err().to_lowercase().contains("not a git repository"));
        assert!(status("/nonexistent/freddai").unwrap_err().contains("not found"));
    }

    #[test]
    fn branches_create_and_switch_and_reject_flags() {
        let (w, _b) = repo("branches");
        fs::write(w.join("a.txt"), "1\n").unwrap();
        commit(p(&w), "init", true).unwrap();
        switch_branch(p(&w), "feature/x", true).unwrap();
        let l = branches(p(&w)).unwrap();
        assert_eq!(l.current, "feature/x");
        assert!(l.branches.contains(&"main".to_string()));
        switch_branch(p(&w), "main", false).unwrap();
        assert!(switch_branch(p(&w), "--orphan", true).is_err());
        assert!(switch_branch(p(&w), "nope", false).is_err());
    }

    #[test]
    fn ship_preview_lists_files_and_untracked_without_staging() {
        let (w, _b) = repo("preview");
        fs::write(w.join("a.txt"), "1\n").unwrap();
        commit(p(&w), "init", true).unwrap();
        fs::write(w.join("a.txt"), "2\n").unwrap();
        fs::write(w.join("new.txt"), "n\n").unwrap();
        let pv = ship_preview(p(&w)).unwrap();
        assert_eq!(pv.files, vec!["a.txt".to_string(), "new.txt".to_string()]);
        assert!(pv.diff.contains("+2") && pv.diff.contains("new.txt") && pv.stat.contains("a.txt"));
        assert_eq!(status(p(&w)).unwrap().staged, 0);
    }
}
