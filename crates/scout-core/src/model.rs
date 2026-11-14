use serde::{Deserialize, Serialize};

/// `order` value meaning "not set": the store appends the record at the end of its group.
pub const UNSET_ORDER: i64 = -1;
fn unset_order() -> i64 {
    UNSET_ORDER
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Workspace {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default = "unset_order")]
    pub order: i64,
    #[serde(default)]
    pub collapsed: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Project {
    pub id: String,
    pub workspace: String,
    pub name: String,
    #[serde(default)]
    pub color: String,
    #[serde(default = "unset_order")]
    pub order: i64,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub hidden: bool,
    #[serde(default)]
    pub freddai_project: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Email,
    Meeting,
    #[default]
    Task,
    Contact,
    Note,
    Code,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Lane {
    Focus,
    #[default]
    Backlog,
    Done,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemStatus {
    NeedsYou,
    AgentWorking,
    Ready,
    #[default]
    None,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Origin {
    #[default]
    User,
    Rule,
    Agent,
    Import,
    Sample,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Item {
    pub id: String,
    pub project: String,
    #[serde(default)]
    pub kind: ItemKind,
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub lane: Lane,
    #[serde(default)]
    pub status: ItemStatus,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub origin: Origin,
    #[serde(default)]
    pub thread: Option<String>,
    #[serde(default = "unset_order")]
    pub order: i64,
    #[serde(default)]
    pub created: String,
    #[serde(default)]
    pub updated: String,
    #[serde(default)]
    pub done_at: Option<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub when_text: String,
    #[serde(default)]
    pub then_text: String,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub project: Option<String>,
    #[serde(default = "unset_order")]
    pub order: i64,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Gmail,
    Slack,
    Calendar,
    Meet,
    Imessage,
    Whatsapp,
    Discord,
    #[default]
    Custom,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceAccess {
    #[default]
    Direct,
    ComputerUse,
    Browser,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceStatus {
    Connected,
    NeedsSignIn,
    #[default]
    NotConnected,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Source {
    pub id: String,
    #[serde(default)]
    pub account: String,
    #[serde(default)]
    pub kind: SourceKind,
    pub label: String,
    #[serde(default)]
    pub detail: String,
    #[serde(default)]
    pub access: SourceAccess,
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub status: SourceStatus,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub onboarding_done: bool,
    #[serde(default)]
    pub onboarding_step: u32,
    #[serde(default)]
    pub sample_data: bool,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct ScoutState {
    #[serde(default)]
    pub revision: u64,
    #[serde(default)]
    pub workspaces: Vec<Workspace>,
    #[serde(default)]
    pub projects: Vec<Project>,
    #[serde(default)]
    pub items: Vec<Item>,
    #[serde(default)]
    pub rules: Vec<Rule>,
    #[serde(default)]
    pub sources: Vec<Source>,
    #[serde(default)]
    pub settings: Settings,
}
