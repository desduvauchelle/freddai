//! Folder operations explicitly available to paired companions, confined to the Mac user's home.
use serde_json::{json, Value};
use std::{fs, path::{Path, PathBuf}};

fn directory(home: &Path, requested: Option<&str>) -> Result<PathBuf, String> {
    let path = fs::canonicalize(requested.map(Path::new).unwrap_or(home)).map_err(|e| e.to_string())?;
    if !path.starts_with(home) || !path.is_dir() { return Err("Choose a folder inside your Mac home folder.".into()); }
    Ok(path)
}
pub fn run(home: &Path, input: &Value) -> Result<Value, String> {
    let home = fs::canonicalize(home).map_err(|e| e.to_string())?;
    let mut path = directory(&home, input["path"].as_str())?;
    if let Some(name) = input["name"].as_str() {
        if name.trim().is_empty() || name.len() > 255 || matches!(name, "." | "..") || name.contains(['/', '\\', '\0']) {
            return Err("Enter a folder name without slashes.".into());
        }
        path = path.join(name);
        fs::create_dir(&path).map_err(|e| format!("Could not create folder: {e}"))?;
    }
    let mut folders = Vec::new();
    for entry in fs::read_dir(&path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') { continue; }
        if let Ok(child) = directory(&home, entry.path().to_str()) {
            folders.push(json!({"name":name,"path":child}));
        }
    }
    folders.sort_by_key(|v| v["name"].as_str().unwrap_or_default().to_lowercase());
    Ok(json!({"path":path,"parent":if path == home { None } else { path.parent() },"folders":folders}))
}
pub fn project(home: &Path, input: &Value) -> Result<Value, String> {
    let home = fs::canonicalize(home).map_err(|e| e.to_string())?;
    let requested = input["path"].as_str().ok_or("Select a folder")?;
    let path = directory(&home, Some(requested))?;
    let name = path.file_name().and_then(|s| s.to_str()).ok_or("Invalid folder name")?;
    Ok(json!({"id":"","name":name,"path":path,"color":"#60a5fa","policy":"inherit","account":null,"last":null}))
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn browse_create_and_confine() {
        let root = std::env::temp_dir().join(format!("freddai-folders-{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(root.join("Documents/code")).unwrap();
        let home = fs::canonicalize(&root).unwrap();
        assert_eq!(run(&home, &json!({})).unwrap()["parent"], Value::Null);
        let result = run(&home, &json!({"path":home.join("Documents/code"),"name":"New project"})).unwrap();
        assert_eq!(project(&home, &result).unwrap()["name"], "New project");
        assert!(run(&home, &json!({"name":"../escape"})).is_err());
        assert!(run(&home, &json!({"path":home.parent().unwrap()})).is_err());
        assert!(run(&home, &json!({"path":home.join("Documents/code"),"name":"New project"})).is_err());
        #[cfg(unix)] {
            std::os::unix::fs::symlink(home.parent().unwrap(), home.join("escape")).unwrap();
            assert!(project(&home, &json!({"path":home.join("escape")})).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }
}
