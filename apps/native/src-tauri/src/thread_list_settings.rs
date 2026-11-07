/// Only presentation fields cross the companion boundary, independent of host upgrades.
#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadListSettings {
    pub project_order: Vec<String>,
    pub grouped: bool,
    pub hide_read: bool,
    #[serde(default)]
    pub ignore_unread: bool,
    pub recent_finished: usize,
}

// A separate file lets either UI change order without replacing other sidebar settings.
pub fn project_order(root: &std::path::Path) -> Result<Option<Vec<String>>, String> {
    match std::fs::read(root.join("companion/project-order.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub fn save_project_order(root: &std::path::Path, order: &[String]) -> Result<(), String> {
    let dir = root.join("companion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temporary = dir.join(format!("project-order-{}.tmp", crate::companion_crypto::random()));
    std::fs::write(&temporary, serde_json::to_vec(order).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, dir.join("project-order.json")).map_err(|e| e.to_string())
}
