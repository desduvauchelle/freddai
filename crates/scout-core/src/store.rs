//! JSON persistence and mutations for Scout. Every mutation works on a copy of the
//! state, bumps `revision`, writes it atomically and only then commits in memory, so a
//! failed write never leaves memory and disk out of sync.
use crate::model::*;
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn now_rfc3339() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}

pub struct ScoutStore {
    pub path: PathBuf,
    pub state: ScoutState,
}

impl ScoutStore {
    /// Missing file = default state. Unreadable or corrupt file = Err naming the path;
    /// the file is never replaced.
    pub fn load(path: impl Into<PathBuf>) -> Result<ScoutStore, String> {
        let path = path.into();
        let state = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|e| format!("Scout state at {} is corrupt: {e}", path.display()))?,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => ScoutState::default(),
            Err(e) => return Err(format!("Cannot read Scout state at {}: {e}", path.display())),
        };
        Ok(ScoutStore { path, state })
    }

    pub fn save(&self) -> Result<(), String> {
        write_atomic(&self.path, &self.state)
    }

    /// Apply `f` to a copy, bump revision, persist, commit. Returns the new state.
    pub fn mutate(
        &mut self,
        f: impl FnOnce(&mut ScoutState) -> Result<(), String>,
    ) -> Result<ScoutState, String> {
        let mut next = self.state.clone();
        f(&mut next)?;
        next.revision += 1;
        write_atomic(&self.path, &next)?;
        self.state = next;
        Ok(self.state.clone())
    }

    pub fn workspace_save(&mut self, w: Workspace) -> Result<ScoutState, String> {
        self.mutate(|s| {
            nonempty(&w.id, "workspace id")?;
            place(&mut s.workspaces, w, |_| String::new());
            Ok(())
        })
    }

    pub fn workspace_delete(&mut self, id: &str) -> Result<ScoutState, String> {
        self.mutate(|s| {
            take(&mut s.workspaces, id, "workspace")?;
            let gone: Vec<String> =
                s.projects.iter().filter(|p| p.workspace == id).map(|p| p.id.clone()).collect();
            s.projects.retain(|p| p.workspace != id);
            s.items.retain(|i| !gone.contains(&i.project));
            s.rules.iter_mut().for_each(|r| {
                if r.project.as_ref().is_some_and(|p| gone.contains(p)) {
                    r.project = None
                }
            });
            repack_all(s);
            Ok(())
        })
    }

    pub fn workspace_reorder(&mut self, ids: &[String]) -> Result<ScoutState, String> {
        self.mutate(|s| {
            for id in ids {
                if !s.workspaces.iter().any(|w| &w.id == id) {
                    return Err(format!("Unknown workspace {id}"));
                }
            }
            // Listed ids first in the given order, unlisted ones after in their old order.
            let rest = ids.len() as i64;
            for w in s.workspaces.iter_mut() {
                w.order = match ids.iter().position(|i| i == &w.id) {
                    Some(p) => p as i64,
                    None => rest + w.order.max(0),
                };
            }
            repack_all(s);
            Ok(())
        })
    }

    pub fn project_save(&mut self, p: Project) -> Result<ScoutState, String> {
        self.mutate(|s| {
            nonempty(&p.id, "project id")?;
            exists(&s.workspaces, &p.workspace, "workspace")?;
            place(&mut s.projects, p, |p| p.workspace.clone());
            repack_all(s);
            Ok(())
        })
    }

    pub fn project_delete(&mut self, id: &str) -> Result<ScoutState, String> {
        self.mutate(|s| {
            take(&mut s.projects, id, "project")?;
            s.items.retain(|i| i.project != id);
            s.rules.iter_mut().for_each(|r| {
                if r.project.as_deref() == Some(id) {
                    r.project = None
                }
            });
            repack_all(s);
            Ok(())
        })
    }

    pub fn project_move(&mut self, id: &str, workspace: &str, index: i64) -> Result<ScoutState, String> {
        self.mutate(|s| {
            exists(&s.workspaces, workspace, "workspace")?;
            let mut p = find(&s.projects, id, "project")?;
            p.workspace = workspace.to_string();
            p.order = index;
            place(&mut s.projects, p, |p| p.workspace.clone());
            repack_all(s);
            Ok(())
        })
    }

    pub fn item_save(&mut self, mut item: Item) -> Result<ScoutState, String> {
        let now = now_rfc3339();
        self.mutate(|s| {
            nonempty(&item.id, "item id")?;
            exists(&s.projects, &item.project, "project")?;
            if item.created.is_empty() {
                item.created = s
                    .items
                    .iter()
                    .find(|i| i.id == item.id && !i.created.is_empty())
                    .map(|i| i.created.clone())
                    .unwrap_or_else(|| now.clone());
            }
            item.updated = now.clone();
            done_rules(&mut item, &now);
            place(&mut s.items, item, item_group);
            repack_all(s);
            Ok(())
        })
    }

    pub fn item_delete(&mut self, id: &str) -> Result<ScoutState, String> {
        self.mutate(|s| {
            take(&mut s.items, id, "item")?;
            repack_all(s);
            Ok(())
        })
    }

    pub fn item_move(&mut self, id: &str, lane: Lane, index: i64) -> Result<ScoutState, String> {
        let now = now_rfc3339();
        self.mutate(|s| {
            let mut item = find(&s.items, id, "item")?;
            item.lane = lane;
            item.order = index;
            item.updated = now.clone();
            done_rules(&mut item, &now);
            place(&mut s.items, item, item_group);
            repack_all(s);
            Ok(())
        })
    }

    pub fn rule_save(&mut self, r: Rule) -> Result<ScoutState, String> {
        self.mutate(|s| {
            nonempty(&r.id, "rule id")?;
            if let Some(p) = &r.project {
                exists(&s.projects, p, "project")?;
            }
            place(&mut s.rules, r, |_| String::new());
            Ok(())
        })
    }

    pub fn rule_delete(&mut self, id: &str) -> Result<ScoutState, String> {
        self.mutate(|s| {
            take(&mut s.rules, id, "rule")?;
            repack_all(s);
            Ok(())
        })
    }

    pub fn source_save(&mut self, src: Source) -> Result<ScoutState, String> {
        self.mutate(|s| {
            nonempty(&src.id, "source id")?;
            match s.sources.iter_mut().find(|x| x.id == src.id) {
                Some(x) => *x = src,
                None => s.sources.push(src),
            }
            Ok(())
        })
    }

    pub fn source_delete(&mut self, id: &str) -> Result<ScoutState, String> {
        self.mutate(|s| {
            take(&mut s.sources, id, "source")?;
            s.items.iter_mut().for_each(|i| {
                if i.source.as_deref() == Some(id) {
                    i.source = None
                }
            });
            Ok(())
        })
    }

    pub fn settings_save(&mut self, settings: Settings) -> Result<ScoutState, String> {
        self.mutate(|s| {
            s.settings = settings;
            Ok(())
        })
    }
}

fn write_atomic(path: &Path, state: &ScoutState) -> Result<(), String> {
    let fail = |what: &str, e: std::io::Error| format!("Cannot {what} Scout state at {}: {e}", path.display());
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| fail("create folder for", e))?;
    }
    let json = serde_json::to_vec_pretty(state).map_err(|e| format!("Cannot serialise Scout state: {e}"))?;
    let tmp = path.with_extension("json.tmp");
    let mut f = fs::File::create(&tmp).map_err(|e| fail("write", e))?;
    f.write_all(&json).map_err(|e| fail("write", e))?;
    f.sync_all().map_err(|e| fail("sync", e))?;
    drop(f);
    fs::rename(&tmp, path).map_err(|e| fail("replace", e))
}

fn item_group(i: &Item) -> String {
    format!("{}\u{0}{:?}", i.project, i.lane)
}

/// Lane `done` sets `done_at` (kept if already set); any other lane clears it.
fn done_rules(item: &mut Item, now: &str) {
    if item.lane == Lane::Done {
        if item.done_at.is_none() {
            item.done_at = Some(now.to_string());
        }
    } else {
        item.done_at = None;
    }
}

fn nonempty(v: &str, what: &str) -> Result<(), String> {
    if v.trim().is_empty() {
        Err(format!("Missing {what}"))
    } else {
        Ok(())
    }
}

pub(crate) trait Ordered: Clone {
    fn id(&self) -> &str;
    fn order(&self) -> i64;
    fn set_order(&mut self, o: i64);
}
macro_rules! ordered {
    ($($t:ty),*) => {$(
        impl Ordered for $t {
            fn id(&self) -> &str { &self.id }
            fn order(&self) -> i64 { self.order }
            fn set_order(&mut self, o: i64) { self.order = o }
        }
    )*};
}
ordered!(Workspace, Project, Item, Rule);

trait HasId {
    fn hid(&self) -> &str;
}
macro_rules! has_id {
    ($($t:ty),*) => {$( impl HasId for $t { fn hid(&self) -> &str { &self.id } } )*};
}
has_id!(Workspace, Project, Item, Rule, Source);

fn exists<T: HasId>(v: &[T], id: &str, what: &str) -> Result<(), String> {
    if v.iter().any(|x| x.hid() == id) {
        Ok(())
    } else {
        Err(format!("Unknown {what} {id}"))
    }
}

fn find<T: HasId + Clone>(v: &[T], id: &str, what: &str) -> Result<T, String> {
    v.iter().find(|x| x.hid() == id).cloned().ok_or_else(|| format!("Unknown {what} {id}"))
}

fn take<T: HasId>(v: &mut Vec<T>, id: &str, what: &str) -> Result<T, String> {
    let at = v.iter().position(|x| x.hid() == id).ok_or_else(|| format!("Unknown {what} {id}"))?;
    Ok(v.remove(at))
}

/// Upsert `rec` into `v` at position `rec.order` within its group (append when the
/// order is unset or out of range), then renumber that group 0..n.
pub(crate) fn place<T: Ordered>(v: &mut Vec<T>, mut rec: T, group: impl Fn(&T) -> String) {
    v.retain(|x| x.id() != rec.id());
    let g = group(&rec);
    let mut siblings: Vec<usize> = (0..v.len()).filter(|&i| group(&v[i]) == g).collect();
    siblings.sort_by_key(|&i| v[i].order());
    let len = siblings.len() as i64;
    let at = if (0..=len).contains(&rec.order()) { rec.order() } else { len };
    for (n, &i) in siblings.iter().enumerate() {
        let n = n as i64;
        v[i].set_order(if n < at { n } else { n + 1 });
    }
    rec.set_order(at);
    v.push(rec);
}

/// Renumber every group 0..n in current order (stable for ties).
pub(crate) fn repack<T: Ordered>(v: &mut [T], group: impl Fn(&T) -> String) {
    let mut groups: BTreeMap<String, Vec<usize>> = BTreeMap::new();
    for (i, x) in v.iter().enumerate() {
        groups.entry(group(x)).or_default().push(i);
    }
    for (_, mut idx) in groups {
        idx.sort_by_key(|&i| v[i].order());
        for (n, i) in idx.into_iter().enumerate() {
            v[i].set_order(n as i64);
        }
    }
}

pub(crate) fn repack_all(s: &mut ScoutState) {
    repack(&mut s.workspaces, |_| String::new());
    repack(&mut s.projects, |p| p.workspace.clone());
    repack(&mut s.items, item_group);
    repack(&mut s.rules, |_| String::new());
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp() -> PathBuf {
        std::env::temp_dir().join(format!("scout-test-{}", uuid::Uuid::new_v4())).join("state.json")
    }
    fn ws(id: &str) -> Workspace {
        Workspace { id: id.into(), name: id.into(), order: UNSET_ORDER, ..Default::default() }
    }
    fn proj(id: &str, w: &str) -> Project {
        Project { id: id.into(), workspace: w.into(), name: id.into(), order: UNSET_ORDER, ..Default::default() }
    }
    fn item(id: &str, p: &str) -> Item {
        Item { id: id.into(), project: p.into(), title: id.into(), order: UNSET_ORDER, ..Default::default() }
    }

    #[test]
    fn load_missing_is_default() {
        let s = ScoutStore::load(tmp()).unwrap();
        assert_eq!(s.state, ScoutState::default());
        assert!(!s.state.settings.onboarding_done);
    }

    #[test]
    fn save_reload_roundtrip() {
        let path = tmp();
        let mut s = ScoutStore::load(&path).unwrap();
        s.workspace_save(ws("w")).unwrap();
        s.project_save(proj("p", "w")).unwrap();
        let out = s.item_save(item("i", "p")).unwrap();
        assert_eq!(out.revision, 3);
        assert!(!out.items[0].created.is_empty());
        assert!(!path.with_extension("json.tmp").exists());
        let again = ScoutStore::load(&path).unwrap();
        assert_eq!(again.state, out);
    }

    #[test]
    fn corrupt_file_errors_and_is_kept() {
        let path = tmp();
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{not json").unwrap();
        let err = ScoutStore::load(&path).err().unwrap();
        assert!(err.contains(&path.display().to_string()), "{err}");
        assert_eq!(fs::read_to_string(&path).unwrap(), "{not json");
    }

    #[test]
    fn missing_order_in_json_appends() {
        let w: Workspace = serde_json::from_str(r#"{"id":"a","name":"A"}"#).unwrap();
        assert_eq!(w.order, UNSET_ORDER);
    }

    #[test]
    fn item_move_sets_and_clears_done_at() {
        let mut s = ScoutStore::load(tmp()).unwrap();
        s.workspace_save(ws("w")).unwrap();
        s.project_save(proj("p", "w")).unwrap();
        s.item_save(item("a", "p")).unwrap();
        let st = s.item_move("a", Lane::Done, 0).unwrap();
        assert!(st.items[0].done_at.is_some());
        let st = s.item_move("a", Lane::Focus, 0).unwrap();
        assert_eq!(st.items[0].done_at, None);
        assert_eq!(st.items[0].lane, Lane::Focus);
        assert!(s.item_move("nope", Lane::Done, 0).is_err());
    }

    #[test]
    fn reorder_and_moves_pack_orders() {
        let mut s = ScoutStore::load(tmp()).unwrap();
        for id in ["a", "b", "c"] {
            s.workspace_save(ws(id)).unwrap();
        }
        let st = s.workspace_reorder(&["c".into(), "a".into()]).unwrap();
        let order = |st: &ScoutState| {
            let mut v: Vec<_> = st.workspaces.iter().map(|w| (w.order, w.id.clone())).collect();
            v.sort();
            v
        };
        assert_eq!(order(&st), vec![(0, "c".into()), (1, "a".into()), (2, "b".into())]);
        s.project_save(proj("p", "a")).unwrap();
        for id in ["x", "y", "z"] {
            s.item_save(item(id, "p")).unwrap();
        }
        let st = s.item_move("z", Lane::Backlog, 0).unwrap();
        let mut items: Vec<_> = st.items.iter().map(|i| (i.order, i.id.as_str())).collect();
        items.sort();
        assert_eq!(items, vec![(0, "z"), (1, "x"), (2, "y")]);
        let st = s.item_delete("x").unwrap();
        let mut items: Vec<_> = st.items.iter().map(|i| (i.order, i.id.as_str())).collect();
        items.sort();
        assert_eq!(items, vec![(0, "z"), (1, "y")]);
        // Workspace delete cascades.
        let st = s.workspace_delete("a").unwrap();
        assert!(st.projects.is_empty() && st.items.is_empty());
        assert_eq!(order(&st), vec![(0, "c".into()), (1, "b".into())]);
    }
}
