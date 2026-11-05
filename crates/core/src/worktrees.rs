use std::{
    path::{Path, PathBuf},
    process::Command,
};
fn git(cwd: &Path, args: &[&str]) -> Result<String, String> {
    let out = crate::platform::quiet_command("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().into());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().into())
}
pub fn create(project: &Path, root: &Path, id: &str) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(id).map_err(|_| "Invalid thread ID")?;
    git(project, &["rev-parse", "--verify", "HEAD"])?;
    let parent = root.join("worktrees");
    super::runtime::private_dir(&parent)?;
    let path = parent.join(id);
    git(
        project,
        &[
            "worktree",
            "add",
            "-b",
            &format!("freddai/{id}"),
            path.to_str().ok_or("Invalid path")?,
            "HEAD",
        ],
    )?;
    Ok(path)
}
pub fn remove(project: &Path, path: &Path) -> Result<(), String> {
    if !git(path, &["status", "--porcelain"])?.is_empty() {
        return Err("Worktree has changes. Commit or move them before removing it.".into());
    }
    git(
        project,
        &["worktree", "remove", path.to_str().ok_or("Invalid path")?],
    )?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn worktree_is_opt_in_and_never_discards_dirty_files() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&root).unwrap();
        git(&root, &["init"]).unwrap();
        git(
            &root,
            &[
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.invalid",
                "commit",
                "--allow-empty",
                "-m",
                "initial",
            ],
        )
        .unwrap();
        let id = uuid::Uuid::new_v4().to_string();
        let path = create(&root, &root.join("managed"), &id).unwrap();
        std::fs::write(path.join("new.txt"), "keep").unwrap();
        assert!(remove(&root, &path).is_err());
        std::fs::remove_file(path.join("new.txt")).unwrap();
        remove(&root, &path).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }
}
