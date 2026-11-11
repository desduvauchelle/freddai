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
    #[serde(default)]
    pub project_name_uppercase: bool,
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

// Account order mirrors project order: its own file, atomic temp+rename.
pub fn load_account_order(root: &std::path::Path) -> Result<Option<Vec<String>>, String> {
    match std::fs::read(root.join("companion/account-order.json")) {
        Ok(bytes) => serde_json::from_slice(&bytes).map(Some).map_err(|e| e.to_string()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}
pub fn save_account_order(root: &std::path::Path, order: &[String]) -> Result<(), String> {
    let dir = root.join("companion");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let temporary = dir.join(format!("account-order-{}.tmp", crate::companion_crypto::random()));
    std::fs::write(&temporary, serde_json::to_vec(order).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(temporary, dir.join("account-order.json")).map_err(|e| e.to_string())
}
/// Known ids first in saved order, unknown ids after in their existing order.
#[allow(dead_code)]
pub fn order_accounts(accounts: Vec<freddai_core::runtime::Account>, order: &[String]) -> Vec<freddai_core::runtime::Account> {
    let mut accounts = accounts;
    accounts.sort_by_key(|a| order.iter().position(|id| *id == a.id).unwrap_or(usize::MAX));
    accounts
}
/// Same ordering for already-serialised snapshot JSON (`accounts` array of objects with `id`).
pub fn order_accounts_json(accounts: &mut [serde_json::Value], order: &[String]) {
    accounts.sort_by_key(|a| order.iter().position(|id| a["id"].as_str() == Some(id.as_str())).unwrap_or(usize::MAX));
}
#[cfg(test)]
mod account_order_tests {
    use super::*;
    fn acct(id: &str) -> freddai_core::runtime::Account {
        serde_json::from_value(serde_json::json!({"id":id,"name":id,"provider":"codex","color":"#000"})).unwrap()
    }
    #[test]
    fn order_accounts_known_first_unknown_appended_stable() {
        let out = order_accounts(vec![acct("a"), acct("b"), acct("c"), acct("d")], &["c".into(), "gone".into(), "a".into()]);
        assert_eq!(out.iter().map(|a| a.id.as_str()).collect::<Vec<_>>(), ["c", "a", "b", "d"]);
    }
    #[test]
    fn order_accounts_json_matches() {
        let mut v = vec![serde_json::json!({"id":"a"}), serde_json::json!({"id":"b"})];
        order_accounts_json(&mut v, &["b".into()]);
        assert_eq!(v[0]["id"], "b");
    }
}
