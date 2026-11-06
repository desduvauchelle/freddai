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
