#[path = "companion_folders.rs"]
mod folders;
// Device-authorized companion. Never forwards arbitrary desktop RPC methods.
use freddai_core::{host, runtime::{Database, LaunchOptions, resolve}};
use serde_json::{json, Value};
use std::{fs, io::Read, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::{Duration, Instant}};
#[cfg(test)]
use subtle::ConstantTimeEq;
use fs2::FileExt;
use tiny_http::{Header, Method, Response, Server, SslConfig, StatusCode};

use crate::thread_list_settings::ThreadListSettings;

// Quota reads run outside snapshot delivery and never start a model turn.
fn companion_product_usage(root: &Path, db: &Database) -> Value {
    type Entry = (Instant, Option<Value>, bool, Option<String>);
    static CACHE: std::sync::OnceLock<Mutex<std::collections::HashMap<PathBuf, Entry>>> = std::sync::OnceLock::new();
    let cache = CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()));
    let mut cache = cache.lock().unwrap();
    Value::Array(db.accounts.iter().map(|account| {
        let key = root.join("usage").join(&account.id);
        let entry = cache.entry(key.clone()).or_insert((Instant::now() - Duration::from_secs(121), None, false, None));
        if !entry.2 && entry.0.elapsed() >= Duration::from_secs(120) {
            entry.2 = true;
            let root = root.to_path_buf();
            let id = account.id.clone();
            std::thread::spawn(move || {
                let result = host::call(&root, "account_usage", json!({"account":id}));
                if let Some(entry) = CACHE.get().unwrap().lock().unwrap().get_mut(&key) {
                    match result {
                        Ok(value) => { entry.1 = Some(value); entry.3 = None; }
                        Err(error) => entry.3 = Some(error),
                    }
                    entry.0 = Instant::now();
                    entry.2 = false;
                }
            });
        }
        json!({"id":account.id,"name":account.name,"provider":account.provider,"color":account.color,"usage":entry.1,"error":entry.3})
    }).collect())
}

const PORT: u16 = 49744;
const LIMIT: u64 = 128 * 1024;

// The first provider turn may not have published its session ID yet. Its follow-ups
// can already enter the host FIFO, which waits for the active turn to finish.
fn can_queue_reply(has_provider_session: bool, status: &str) -> bool {
    has_provider_session || matches!(status, "starting" | "running" | "waiting")
}

#[cfg(test)]
mod reply_readiness_tests {
    use super::*;
    #[test]
    fn active_first_turn_accepts_queued_followups_before_provider_session_exists() {
        for status in ["starting", "running", "waiting"] { assert!(can_queue_reply(false, status)); }
        for status in ["done", "failed", "interrupted"] { assert!(!can_queue_reply(false, status)); }
        assert!(can_queue_reply(true, "done"));
    }
}


pub fn project_snapshot(db: &Database) -> Value {
    project_snapshot_selection(db, None, false)
}
/// Scoped clients fetch summaries plus only the open transcript. Legacy clients retain their full snapshot.
fn project_snapshot_selection(db: &Database, thread: Option<&str>, scoped: bool) -> Value {
    let projects: Vec<_> = db.projects.iter().map(|p| json!({
        "id":p.id, "name":p.name, "color":p.color,
        "provider":resolve(db,p,None).ok().and_then(|id|db.accounts.iter().find(|a|a.id==id).map(|a|a.provider.clone())),
        "defaultAssistant":resolve(db,p,None).ok(),
        "assistants":db.accounts.iter().map(|a|json!({"id":a.id,"name":a.name,"provider":a.provider,"color":a.color})).collect::<Vec<_>>(),
        "canStart":!db.accounts.is_empty() && Path::new(&p.path).is_dir(),
        "kind":p.kind, "objective":p.objective
    })).collect();
    let threads: Vec<_> = db.sessions.iter().filter(|s| !s.archived && s.deleted_at.is_none() && s.status != "archived").map(|s| {
        let queue = db.queues.iter().find(|q| q.session == s.id);
        let include_history = !scoped || thread == Some(s.id.as_str());
        if !include_history {
            // Keep the searchable title index and attention/read badges, not conversation payloads.
            // An empty pending object is a presence marker; messagesLoaded=false prevents acting on it.
            return json!({"id":s.id,"project":s.project,"origin":s.origin,"title":s.title,"status":s.status,"pinned":s.pinned,"scheduled":s.schedule_id.is_some() || s.options.scheduled,
                "updated":s.updated,"read_at":s.read_at,"last_user_message_at":s.last_user_message_at,
                "messages":[],"messagesLoaded":false,"canReply":false,"error":null,
                "pending":s.pending.as_ref().map(|_|json!({})),
                "queued":queue.map(|q|q.messages.iter().filter(|m| !m.id.starts_with(freddai_core::commander_autonomy::WAKE_ID_PREFIX)).count()).unwrap_or(0)});
        }
        json!({"id":s.id,"project":s.project,"origin":s.origin,"title":s.title,"status":s.status,"pinned":s.pinned,"scheduled":s.schedule_id.is_some() || s.options.scheduled,
            "updated":s.updated,"read_at":s.read_at,"last_user_message_at":s.last_user_message_at,"messages":if include_history { json!(s.messages) } else { json!([]) },
            "tasks":if include_history { json!(s.tasks) } else { json!([]) },"messagesLoaded":include_history,"error":s.error,
            "canReply":s.pending.is_none() && (s.provider_id.is_some() || !s.agent_history.is_empty()) && db.accounts.iter().any(|a| a.id==s.account),
            "agent":s.account,"usage":s.usage,"pending":s.pending,"provider":db.accounts.iter().find(|a|a.id==s.account).map(|a|a.provider.as_str()),
            "options":{"model":s.options.model,"effort":s.options.effort,"speed":s.options.speed,"permission_mode":s.options.permission_mode},
            "queue":queue.map(|q|q.messages.iter().map(|m|json!({"id":m.id,"prompt":m.prompt,"attachments":m.options.attachments.len()})).collect::<Vec<_>>()).unwrap_or_default(),
            "queued":queue.map(|q|q.messages.iter().filter(|m| !m.id.starts_with(freddai_core::commander_autonomy::WAKE_ID_PREFIX)).count()).unwrap_or(0),
            "queuePaused":queue.is_some_and(|q|q.paused && q.messages.iter().any(|m| !m.id.starts_with(freddai_core::commander_autonomy::WAKE_ID_PREFIX))),
            "queueError":queue.and_then(|q|q.error.clone())})
    }).collect();
    json!({"projects":projects,"threads":threads,"schedules":db.schedules,"workspaces":db.preferences.workspaces,"modelConfiguration":db.preferences.model_configuration})
}
fn snapshot(root: &Path, scoped: bool, thread: Option<&str>) -> Result<(Database, bool, bool), String> {
    let mut value = if scoped {
        // Scope at the host boundary, before its reply can exceed the IPC limit.
        // Revision zero always gives a complete index; no client-side delta state is needed.
        host::call(root,"snapshot_since",json!({"revision":0,"openThreads":thread.into_iter().collect::<Vec<_>>()}))?
    } else { host::call(root,"snapshot",json!({}))? };
    if scoped {
        if let Some(sessions)=value["sessions"].as_array_mut() {
            for session in sessions {
                if session["id"].as_str()!=thread {
                    session["messages"]=json!([]);
                    continue;
                }
                // Desktop projections bound tool output. Restore only the open phone
                // transcript through bounded, hash-checked reads, preserving its history.
                let id=session["id"].as_str().unwrap_or("").to_owned();
                if let Some(messages)=session["messages"].as_array_mut() { for message in messages {
                    let Some(bytes)=message["toolTextBytes"].as_u64() else {continue};
                    let mut text=String::new();
                    while (text.len() as u64)<bytes {
                        let page=host::call(root,"tool_text",json!({"thread":id,"message":message["id"],"offset":text.len(),"hash":message["toolTextHash"]}))?;
                        let chunk=page["text"].as_str().ok_or("Invalid tool output page")?;
                        if chunk.is_empty() || page["offset"].as_u64()!=Some(text.len() as u64) || text.len() as u64+chunk.len() as u64>bytes {
                            return Err("Invalid tool output page".into());
                        }
                        text.push_str(chunk);
                    }
                    message["text"]=json!(text);
                }}
            }
        }
    }
    let workspaces = value["preferences"]["workspaces"].is_array();
    let pins = value["sessions"].as_array().is_some_and(|sessions| sessions.iter().all(|s| s["pinned"].is_boolean()));
    let mut db: Database = serde_json::from_value(value).map_err(|e|e.to_string())?;
    apply_account_order(root, &mut db);
    Ok((db, workspaces, pins))
}
/// Applies the desktop's saved assistant order once per request; a broken file is loud and leaves host order.
fn apply_account_order(root: &Path, db: &mut Database) {
    match crate::thread_list_settings::load_account_order(root) {
        Ok(Some(order)) => db.accounts = crate::thread_list_settings::order_accounts(std::mem::take(&mut db.accounts), &order),
        Ok(None) => {}
        Err(e) => eprintln!("[account_order] unreadable account-order.json: {e}"),
    }
}
fn text<'a>(p: &'a Value, key: &str) -> Result<&'a str, String> {
    p[key].as_str().filter(|s| !s.trim().is_empty()).ok_or_else(||format!("Missing {key}"))
}
fn new_thread_options(provider: &str, worktree: bool, options: LaunchOptions) -> LaunchOptions {
    LaunchOptions { worktree, permission_mode: options.permission_mode.or_else(|| if matches!(provider, "codex" | "claude") { Some(freddai_core::runtime::PermissionMode::Bypass) } else { None }), ..options }
}
#[cfg(test)]
mod permission_tests {
    use super::*;
    #[test]
    fn phone_start_matches_desktop_full_access_for_supported_providers() {
        for provider in ["codex", "claude"] {
            assert_eq!(new_thread_options(provider, true, LaunchOptions::default()).permission_mode,
                Some(freddai_core::runtime::PermissionMode::Bypass));
        }
        assert_eq!(new_thread_options("grok", false, LaunchOptions::default()).permission_mode, None);
    }
}
// Copy only next-message controls. Remote callers cannot set scheduling, worktrees or host paths.
fn message_options(value: &Value, request_id: &str) -> Result<LaunchOptions, String> {
    let mut options = LaunchOptions { request_id: Some(format!("phone:{request_id}")), ..Default::default() };
    if !value.is_null() {
        let requested: LaunchOptions = serde_json::from_value(value.clone()).map_err(|_|"Invalid composer settings")?;
        if requested.model.as_ref().is_some_and(|s|s.len()>200) || requested.effort.as_ref().is_some_and(|s|s.len()>40) || requested.speed.as_ref().is_some_and(|s|s.len()>16) || requested.attachments.len()>20 { return Err("Composer settings exceed limits".into()); }
        options.agent = requested.agent;
        options.model = requested.model;
        options.effort = requested.effort;
        options.speed = requested.speed;
        options.permission_mode = requested.permission_mode;
        options.attachments = requested.attachments;
        options.update_agent_controls = requested.update_agent_controls;
    }
    Ok(options)
}
fn composer(root: &Path, db: &Database, p: &Value) -> Result<Value,String> {
    let input = &p["input"];
    if matches!(p["operation"].as_str(), Some("browse_folders" | "create_folder" | "add_project")) {
        let home = std::env::var("HOME").map_err(|_| "Mac home folder unavailable")?;
        return match p["operation"].as_str().unwrap() {
            "add_project" => host::call(root, "save_project", json!({"project":folders::project(Path::new(&home), input)?})).map(|p| json!({"id":p["id"]})),
            "create_folder" => { text(input, "name")?; folders::run(Path::new(&home), input) },
            _ => folders::run(Path::new(&home), &json!({"path":input["path"]})),
        };
    }
    let session = input["thread"].as_str().map(|id|db.sessions.iter().find(|s|s.id==id && !s.archived && s.deleted_at.is_none() && s.status!="archived").ok_or("Thread unavailable")).transpose()?;
    match text(p,"operation")? {
        "vscode_available" => Ok(json!(crate::project_editor::available())),
        "open_project_vscode" => crate::project_editor::open(db, text(input, "project")?).map(|_| json!(null)),
        "update_project_organization" => {
            let id = text(input, "project")?;
            if !db.projects.iter().any(|p| p.id == id) { return Err("Project unavailable".into()); }
            let name = text(input, "name")?.trim();
            let color = text(input, "color")?;
            if name.is_empty() || name.len() > 200 || color.len() != 7 || !color.starts_with('#') || !color[1..].bytes().all(|b| b.is_ascii_hexdigit()) {
                return Err("Invalid project name or color".into());
            }
            host::call(root, "update_project_organization", json!({"project":id,"name":name,"color":color})).map_err(|error| {
                if error.contains("Unknown host command") { "The background host needs an update before editing project names and colors. Let active work finish and reopen Freddai on your Mac.".into() } else { error }
            })
        }
        "move_project" => {
            let id = text(input, "project")?;
            let target = text(input, "target")?;
            if id == target || !db.projects.iter().any(|p| p.id == id) || !db.projects.iter().any(|p| p.id == target) {
                return Err("Project unavailable".into());
            }
            let mut order = crate::thread_list_settings::project_order(root)?.unwrap_or_else(|| {
                fs::read(root.join("companion/thread-list.json")).ok()
                    .and_then(|bytes| serde_json::from_slice::<ThreadListSettings>(&bytes).ok())
                    .map(|s| s.project_order).unwrap_or_default()
            });
            order.retain(|p| p != id && db.projects.iter().any(|project| &project.id == p));
            // Unsaved groups follow user-send recency, just like both navigation UIs.
            let mut sessions: Vec<_> = db.sessions.iter().filter(|s| !s.archived && s.deleted_at.is_none() && s.status != "archived").collect();
            sessions.sort_by(|a, b| b.last_user_message_at.unwrap_or(b.updated).cmp(&a.last_user_message_at.unwrap_or(a.updated)).then_with(|| a.id.cmp(&b.id)));
            for project in sessions.iter().map(|s| &s.project).chain(db.projects.iter().map(|p| &p.id)) {
                if project != id && !order.contains(project) && db.projects.iter().any(|p| &p.id == project) { order.push(project.clone()); }
            }
            let index = order.iter().position(|p| p == target).ok_or("Project unavailable")?;
            order.insert(index + usize::from(input["after"].as_bool().unwrap_or(false)), id.to_string());
            crate::thread_list_settings::save_project_order(root, &order)?;
            Ok(json!(order))
        }
        "save_model_configuration" => {
            let config: freddai_core::model_levels::Configuration = serde_json::from_value(input["configuration"].clone()).map_err(|_| "Invalid model configuration")?;
            freddai_core::model_levels::validate(&config)?;
            let hello = host::call(root,"hello",json!({}))?;
            if hello["model_configuration"] != 1 { return Err("The Mac background engine needs its update before saving model configuration. Let active work finish.".into()); }
            host::call(root,"save_preferences",json!({"patch":{"model_configuration":config}}))
        }
        "save_workspaces" => {
            let workspaces: Vec<freddai_core::runtime::Workspace> = serde_json::from_value(input["workspaces"].clone()).map_err(|_|"Invalid workspaces")?;
            if workspaces.len() > 200 || workspaces.iter().any(|w| w.id.trim().is_empty() || w.id.len() > 200 || w.name.trim().is_empty() || w.name.len() > 200 || w.color.len() != 7 || !w.color.starts_with('#') || !w.color[1..].bytes().all(|b| b.is_ascii_hexdigit()) || w.projects.len() > db.projects.len() || w.projects.iter().any(|id| !db.projects.iter().any(|p| &p.id == id))) {
                return Err("Invalid workspace name, color or projects".into());
            }
            let mut ids = std::collections::HashSet::new();
            if workspaces.iter().any(|w| !ids.insert(&w.id)) { return Err("Duplicate workspace id".into()); }
            host::call(root,"save_preferences",json!({"patch":{"workspaces":workspaces}}))
        }
        "generated_file" => freddai_core::generated_files::chunk(db, text(input,"thread")?, text(input,"href")?, input["offset"].as_u64().unwrap_or(0)),
        "models" => {
            let account = if let Some(s)=session { input["assistant"].as_str().unwrap_or(&s.account).to_string() } else {
                let project=db.projects.iter().find(|x|Some(x.id.as_str())==input["project"].as_str()).ok_or("Project not found")?;
                resolve(db,project,input["assistant"].as_str().map(str::to_owned))?
            };
            host::call(root,"account_models",json!({"account":account}))
        },
        "resume_thread" => {
            let session = session.ok_or("Thread unavailable")?;
            if session.status != "interrupted" || session.pending.is_some() || session.provider_id.is_none() {
                return Err("This thread cannot be resumed right now".into());
            }
            let request_id = text(input, "requestId")?;
            if request_id.len() > 200 { return Err("Invalid request id".into()); }
            if db.queues.iter().any(|q| q.session == session.id) {
                host::call(root,"queue_action",json!({"session":session.id,"action":"pause","message":null}))?;
            }
            host::call(root,"launch",json!({"project":session.project,"account":null,"existing":session.id,
                "prompt":"Continue where you left off.","options":{"request_id":format!("phone:{request_id}")}}))
        },
        "queue" => {
            let session=session.ok_or("Thread unavailable")?;
            let action=text(input,"action")?;
            if !["pause","resume","delete","clear","steer","edit"].contains(&action) {return Err("Unknown queue action".into());}
            host::call(root,"queue_action",json!({"session":session.id,"action":action,"message":input["message"],"prompt":input["prompt"]}))
        },
        _ => Err("Unknown composer operation".into())
    }
}
// Bounded chunks fit the existing encrypted relay envelope; only private upload files are accepted.
fn upload(root: &Path, p: &Value) -> Result<Value,String> {
    use std::{io::{Seek,SeekFrom,Write},os::unix::fs::DirBuilderExt};
    let base=root.join("companion/uploads");
    fs::DirBuilder::new().recursive(true).mode(0o700).create(&base).map_err(|e|e.to_string())?;
    for entry in fs::read_dir(&base).map_err(|e|e.to_string())?.flatten() {
        if entry.metadata().ok().and_then(|m|m.modified().ok()).and_then(|t|t.elapsed().ok()).is_some_and(|age|age.as_secs()>86400) {let _=fs::remove_dir_all(entry.path());}
    }
    if p["action"]=="begin" {
        let name=text(p,"name")?;
        if name.len()>255 || name.contains(['/', '\\', '\0']) || name=="." || name==".." {return Err("Invalid filename".into());}
        if fs::read_dir(&base).map_err(|e|e.to_string())?.flatten().filter(|entry| !entry.path().join("result").exists()).count()>=32 {return Err("Too many unfinished attachments. Try again later.".into());}
        let id=crate::companion_crypto::random();
        let dir=base.join(&id); fs::DirBuilder::new().mode(0o700).create(&dir).map_err(|e|e.to_string())?;
        fs::write(dir.join("name"),name).map_err(|e|e.to_string())?;
        fs::write(dir.join("bytes"),[]).map_err(|e|e.to_string())?;
        return Ok(json!(id));
    }
    let id=text(p,"id")?;
    if id.len()!=64 || hex::decode(id).is_err() {return Err("Invalid upload".into());}
    let dir=base.join(id);
    if p["action"]=="chunk" {
        let data=text(p,"data")?;
        if data.len()>48*1024 {return Err("Attachment chunk too large".into());}
        let bytes=hex::decode(data).map_err(|_|"Invalid attachment chunk")?;
        let offset=p["offset"].as_u64().ok_or("Missing attachment offset")?;
        if offset+bytes.len() as u64>25*1024*1024 {return Err("Each attachment must be 25 MB or smaller".into());}
        let mut file=fs::OpenOptions::new().read(true).write(true).open(dir.join("bytes")).map_err(|_|"Upload expired")?;
        let len=file.metadata().map_err(|e|e.to_string())?.len();
        if len!=offset {
            if len==offset+bytes.len() as u64 {file.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;let mut prior=Vec::new();file.read_to_end(&mut prior).map_err(|e|e.to_string())?;if prior==bytes {return Ok(Value::Null);}}
            return Err("Attachment upload out of order".into());
        }
        file.seek(SeekFrom::End(0)).map_err(|e|e.to_string())?;
        file.write_all(&bytes).map_err(|e|e.to_string())?;
        return Ok(Value::Null);
    }
    if p["action"]=="finish" {
        if let Ok(saved)=fs::read(dir.join("result")) {return serde_json::from_slice(&saved).map_err(|e|e.to_string());}
        let size=p["size"].as_u64().ok_or("Missing attachment size")?;
        if fs::metadata(dir.join("bytes")).map_err(|_|"Upload expired")?.len()!=size {return Err("Attachment is incomplete".into());}
        let name=fs::read_to_string(dir.join("name")).map_err(|e|e.to_string())?;
        let content=dir.join(&name);
        // A separate subdirectory avoids collisions with our bookkeeping filenames.
        let payload=dir.join("payload");fs::create_dir_all(&payload).map_err(|e|e.to_string())?;
        let content=payload.join(content.file_name().ok_or("Invalid filename")?);
        fs::copy(dir.join("bytes"),&content).map_err(|e|e.to_string())?;
        let result=freddai_core::attachments::import(root,&[content.to_string_lossy().into()])?.remove(0);
        let result=json!(result);
        fs::write(dir.join("result"),serde_json::to_vec(&result).unwrap()).map_err(|e|e.to_string())?;
        let _=fs::remove_file(dir.join("bytes"));let _=fs::remove_dir_all(payload);
        return Ok(result);
    }
    Err("Unknown upload operation".into())
}
// Phone push-to-talk dictation. The audio rides the normal upload chunks but is never imported as an attachment:
// `transcribe` consumes the unfinished upload, runs the local model and always deletes the audio.
const VOICE_MAX_BYTES: u64 = 10 * 1024 * 1024;
fn voice_upload_dir(root: &Path, input: &Value) -> Result<PathBuf,String> {
    let id=text(input,"id")?;
    if id.len()!=64 || hex::decode(id).is_err() {return Err("Invalid upload".into());}
    let dir=root.join("companion/uploads").join(id);
    if !dir.join("bytes").is_file() || dir.join("result").exists() {return Err("Upload expired".into());}
    Ok(dir)
}
/// Verifies the received bytes and moves them to a file whose extension (from the original name) lets the decoder probe the format.
fn voice_prepare_audio(dir: &Path, input: &Value) -> Result<PathBuf,String> {
    let len=fs::metadata(dir.join("bytes")).map_err(|_|"Upload expired")?.len();
    if len==0 {return Err("The recording is empty".into());}
    if len>VOICE_MAX_BYTES {return Err("The recording is too large (10 MB limit)".into());}
    if let Some(size)=input["size"].as_u64() { if size!=len {return Err("Recording upload is incomplete".into());} }
    let name=fs::read_to_string(dir.join("name")).unwrap_or_default();
    let ext=Path::new(&name).extension().and_then(|e|e.to_str()).filter(|e|!e.is_empty() && e.len()<=8 && e.chars().all(|c|c.is_ascii_alphanumeric())).unwrap_or("m4a").to_ascii_lowercase();
    let audio=dir.join(format!("audio.{ext}"));
    fs::rename(dir.join("bytes"),&audio).map_err(|e|e.to_string())?;
    Ok(audio)
}
fn voice_composer(root: &Path, p: &Value) -> Result<Value,String> {
    if p["operation"]=="voice" {
        let status=crate::voice::status(root);
        return Ok(json!({"enabled":status.enabled,"ready":status.ready}));
    }
    let input=&p["input"];
    let dir=voice_upload_dir(root,input)?;
    let started=std::time::Instant::now();
    let id=dir.file_name().and_then(|n|n.to_str()).unwrap_or("?").chars().take(8).collect::<String>();
    let bytes=fs::metadata(dir.join("bytes")).map(|m|m.len()).unwrap_or(0);
    let result=crate::voice::ready(root).and_then(|_|voice_prepare_audio(&dir,input)).and_then(|audio|crate::voice::transcribe_file(root,&audio));
    let _=fs::remove_dir_all(&dir);
    match result {
        Ok(t)=>{eprintln!("companion.transcribe id={id} bytes={bytes} result=ok model={} audio_ms={} elapsed_ms={} chars={}",t.model,t.duration_ms,started.elapsed().as_millis(),t.text.chars().count());
            Ok(json!({"text":t.text,"durationMs":t.duration_ms,"model":t.model}))},
        Err(e)=>{eprintln!("companion.transcribe id={id} bytes={bytes} result=err elapsed_ms={} error={e}",started.elapsed().as_millis());Err(e)}
    }
}
/// Preview tunnel RPC: needs the calling device's key and mailbox, so it is handled before generic dispatch.
fn preview_open(root: &Path, device: &crate::companion_pairing::Device, input: &Value) -> Result<Value,String> {
    crate::preview_host::import_shared(root);
    let port = input["port"].as_u64().ok_or("preview_invalid_request")?;
    let path = input["path"].as_str().unwrap_or("/");
    let thread = text(input,"threadId").map_err(|_|"preview_invalid_request".to_string())?;
    // Only granted ports may spawn a server: a share is the only thing that can carry a command, so
    // nothing else is ever started, and only when the phone sends `start: true` after the user confirmed.
    // The wait is 1 s because the direct LAN path times out at 8 s (mobile.rs) and the relay dial can take
    // 10 s. A server that is still starting returns `preview_server_starting` and the UI retries every 2 s.
    let start = input["start"].as_bool().unwrap_or(false);
    if let Ok(p) = u16::try_from(port) {
        if crate::preview_host::is_granted(p) && !freddai_core::preview_grants::is_listening(p) {
            crate::preview_host::server_status(root, p, start, std::time::Duration::from_secs(1))?;
        }
    }
    // Read the transcript only when no explicit share exists for the port.
    let transcript = if u16::try_from(port).is_ok_and(crate::preview_host::is_granted) { None } else {
        let (db,_,_) = snapshot(root,true,Some(thread))?;
        db.sessions.iter().find(|s|s.id==thread && !s.archived && s.deleted_at.is_none() && s.status!="archived").map(|s|json!(s.messages).to_string())
    };
    let relay = crate::companion_pairing::edit(root,|r|Ok(r.relay.clone()))?;
    crate::preview_host::open(&crate::preview_host::RelayAuth{relay:relay.as_deref(),token:&device.mailbox,key:&device.key},port,path,transcript.as_deref())
}
/// Devices may edit schedule content but never host-owned fields: launch options (permission mode,
/// model, attachments), run history and run-now. Old hosts must also not silently drop routine controls.
fn guard_schedule_save(root: &Path, mut input: Value) -> Result<Value,String> {
    let schedule = input["schedule"].clone();
    if !schedule.is_object() { return Ok(input); }
    if crate::companion_operations::schedule_needs_hello(&schedule) {
        let hello = host::call(root, "hello", json!({}))?;
        crate::companion_operations::require_schedule_support(&schedule, &hello)?;
    }
    let id = schedule["id"].as_str().unwrap_or("");
    let host_options = if id.is_empty() { serde_json::to_value(LaunchOptions::default()).map_err(|e| e.to_string())? } else {
        let db = host::call(root, "snapshot", json!({}))?;
        let existing = db["schedules"].as_array().and_then(|all| all.iter().find(|s| s["id"] == id))
            .ok_or("Schedule not found")?;
        existing["options"].clone()
    };
    if !schedule["options"].is_null() && schedule["options"] != host_options {
        eprintln!("companion.schedule.options_overridden id={id:?} reason=\"device sent options that differ from host-owned options\" sent={}", schedule["options"]);
    }
    let target = input["schedule"].as_object_mut().unwrap();
    target.insert("options".into(), host_options);
    target.remove("runs");
    target.remove("run_now");
    Ok(input)
}
pub(crate) fn dispatch_for_device(root: &Path, device: &crate::companion_pairing::Device, route: &str, p: Value) -> Result<Value,String> {
    if route == "/v1/composer" && p["operation"] == "preview_open" { return preview_open(root, device, &p["input"]); }
    dispatch(root, route, p)
}
pub(crate) fn dispatch(root: &Path, route: &str, p: Value) -> Result<Value,String> {
    if route == "/v1/composer" && matches!(p["operation"].as_str(), Some("commander_settings_get"|"commander_settings_save"|"generated_file"|"day_summary"|"summarize_day"|"save_schedule"|"schedule_action"|"google_capability"|"google_accounts"|"google_disconnect"|"google_triggers"|"google_trigger_save"|"google_trigger_delete"|"commander_state"|"commander_proposals"|"commander_proposal_respond"|"commander_todos"|"commander_todo_save"|"commander_notes"|"commander_note_read"|"commander_note_write"|"commander_profile"|"commander_profile_save"|"commander_revision_restore")) {
        let operation = text(&p,"operation")?;
        if operation == "google_capability" { return Ok(crate::companion_operations::google_capability(&host::call(root, "hello", json!({}))?)); }
        let mut input = p["input"].clone();
        if operation == "save_schedule" { input = guard_schedule_save(root, input)?; }
        let mut result = host::call(root, operation, input)?;
        // The companion snapshot never exposes filesystem paths.
        if operation == "commander_state" { if let Some(project) = result["project"].as_object_mut() { project.remove("path"); } }
        return Ok(result);
    }
    if route == "/v1/composer" && p["operation"] == "upload" { return upload(root, &p["input"]); }
    if route == "/v1/composer" && p["operation"] == "voice_connection" { return crate::voice::connections::call(root, p["input"]["operation"].as_str().unwrap_or(""), &p["input"]["input"]); }
    if route == "/v1/composer" && matches!(p["operation"].as_str(), Some("voice"|"transcribe")) { return voice_composer(root, &p); }
    // Network details only (hardware MACs, IPs, broadcast); no thread, account or project data.
    if route == "/v1/wake" { return crate::wake::mac::collect().map(|w| json!(w)); }
    let scoped = route != "/v1/snapshot" || p["scoped"].as_bool().unwrap_or(false);
    let thread = if route == "/v1/snapshot" {p["thread"].as_str()} else {None};
    let (db, supports_workspaces, supports_pins) = snapshot(root, scoped, thread)?;
    if route == "/v1/composer" {
        if p["operation"] == "save_workspaces" && !supports_workspaces { return Err("The background host needs an update before editing workspaces. Let active work finish and reopen Freddai on your Mac.".into()); }
        return composer(root, &db, &p);
    }
    if route == "/v1/snapshot" {
        let mut result = project_snapshot_selection(&db,p["thread"].as_str(),p["scoped"].as_bool().unwrap_or(false));
        if !supports_workspaces { result.as_object_mut().unwrap().remove("workspaces"); }
        if !supports_pins {
            for thread in result["threads"].as_array_mut().unwrap() { thread.as_object_mut().unwrap().remove("pinned"); }
        }
        if let Ok(bytes) = fs::read(root.join("companion/thread-list.json")) {
            if let Ok(settings) = serde_json::from_slice::<ThreadListSettings>(&bytes) {
                result["threadList"] = json!(settings);
            }
        }
        if let Some(order) = crate::thread_list_settings::project_order(root)? {
            if !result["threadList"].is_object() { result["threadList"] = json!({}); }
            result["threadList"]["projectOrder"] = json!(order);
        }
        result["productUsage"] = companion_product_usage(root, &db);
        result["canReorderProjects"] = json!(true);
        return Ok(result);
    }
    if route=="/v1/action" {
        let thread=text(&p,"thread")?;
        let session=db.sessions.iter().find(|s|s.id==thread && !s.archived && s.deleted_at.is_none() && s.status!="archived").ok_or("Thread unavailable")?;
        let action=text(&p,"action")?;
        if !["stop","archive","delete","pin","unpin"].contains(&action) {return Err("Unknown thread action".into());}
        if matches!(action, "pin" | "unpin") && !supports_pins { return Err("The background host needs an update before pinning threads. Let active work finish and reopen Freddai on your Mac.".into()); }
        let busy=matches!(session.status.as_str(),"starting"|"running"|"waiting");
        if action=="stop" && !busy {return Err("Thread is not running".into());}
        if action=="archive" && busy {return Err("Stop this thread before archiving it".into());}
        return if action=="stop" {host::call(root,"stop",json!({"session":thread}))}
            else {host::call(root,"thread_action",json!({"session":thread,"action":action,"project":null}))};
    }
    if route=="/v1/read" {
        // Read cursors only: no thread content, no status change. Same max-merge host ops as the desktop.
        if p["cursors"].is_object() {
            let cursors=p["cursors"].as_object().unwrap();
            if cursors.len()>5000 {return Err("Too many read cursors".into());}
            return host::call(root,"merge_read",json!({"cursors":p["cursors"]}));
        }
        let thread=text(&p,"thread")?;
        let at=p["at"].as_u64().ok_or("Missing read cursor")?;
        return host::call(root,"mark_read",json!({"thread":thread,"at":at}));
    }
    if route=="/v1/respond" {
        let thread=text(&p,"thread")?;
        if !db.sessions.iter().any(|s|s.id==thread && !s.archived && s.deleted_at.is_none()) {return Err("Thread unavailable".into());}
        let request_id=text(&p,"requestId")?;
        let allow=p["allow"].as_bool().ok_or("Missing decision")?;
        return host::call(root,"respond",json!({"session":thread,"requestId":request_id,"allow":allow,"answers":p["answers"]}));
    }
    let prompt = text(&p,"prompt")?;
    let request_id = text(&p,"requestId")?;
    if prompt.len()>64000 || request_id.len()>200 { return Err("Message is too long".into()); }
    let options = message_options(&p["options"], request_id)?;
    match route {
        "/v1/start" => {
            let project = db.projects.iter().find(|x|Some(x.id.as_str())==p["project"].as_str()).ok_or("Project not found")?;
            let account = resolve(&db,project,p["assistant"].as_str().map(str::to_owned))?;
            let provider = &db.accounts.iter().find(|a| a.id == account).ok_or("Account not found")?.provider;
            let options = new_thread_options(provider, db.preferences.use_worktree, options);
            host::call(root,"launch",json!({"project":project.id,"account":account,"prompt":prompt,"existing":null,"options":options}))
        }
        "/v1/reply" => {
            let s = db.sessions.iter().find(|s|Some(s.id.as_str())==p["thread"].as_str() && !s.archived && s.deleted_at.is_none() && s.status!="archived").ok_or("Thread unavailable")?;
            if s.pending.is_some() { return Err("This thread needs a decision on your Mac before continuing.".into()); }
            if !can_queue_reply(s.provider_id.is_some() || !s.agent_history.is_empty(), &s.status) { return Err("This conversation cannot be resumed. Start a new thread.".into()); }
            // Always use the existing persistent FIFO; the host owns execution and retries.
            host::call(root,"queue_message",json!({"session":s.id,"prompt":prompt,"options":options}))
        }
        _=>Err("Unknown companion operation".into())
    }
}
#[cfg(test)]
fn authorized(value: &[u8], token: &[u8]) -> bool {
    value.len()==token.len() && bool::from(value.ct_eq(token))
}
pub fn start(root: PathBuf) -> Result<bool,String> {
    let dir = root.join("companion");
    if !dir.join("server.crt").exists() { return Ok(false); } // Disabled until explicit provisioning.
    let lock=fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(dir.join("listener.lock")).map_err(|e|e.to_string())?;
    match lock.try_lock_exclusive() {
        Ok(())=>{},
        Err(e) if e.kind()==std::io::ErrorKind::WouldBlock=>return Ok(false),
        Err(e)=>return Err(e.to_string()),
    }
    let lock=Arc::new(lock);
    // Record build identity so a newer desktop can replace this process after an app update.
    let identity=std::env::current_exe().map(|e|build_identity(&e)).map_err(|e|e.to_string())?;
    fs::write(dir.join("server.identity"),json!({"pid":std::process::id(),"identity":identity}).to_string()).map_err(|e|e.to_string())?;
    eprintln!("companion_server.started pid={} identity={identity:?}",std::process::id());
    let server=Server::https(format!("0.0.0.0:{PORT}"),SslConfig {
        certificate:fs::read(dir.join("server.crt")).map_err(|e|e.to_string())?,
        private_key:fs::read(dir.join("server.key")).map_err(|e|e.to_string())?,
    }).map_err(|e|format!("Cannot start companion connection: {e}"))?;
    let server=Arc::new(server);
    // Serialize dispatch so concurrent retries cannot race across snapshot/launch.
    let gate=Arc::new(Mutex::new(()));
    crate::companion_relay::start(root.clone(),gate.clone());
    for _ in 0..4 {
        let server=server.clone(); let root=root.clone(); let gate=gate.clone();
        let lock=lock.clone();
        std::thread::spawn(move || { let _lock=lock; loop {
            let Some(mut req)=server.recv_timeout(Duration::from_secs(5)).ok().flatten() else {continue};
            let auth=req.headers().iter().find(|h|h.field.equiv("Authorization")).map(|h|h.value.as_str()).unwrap_or("");
            let auth=auth.to_string();
            let route=req.url().to_string();
            let started=Instant::now();
            let mut reason=String::new();
            let pairing=["/v1/pair/request","/v1/pair/claim"].contains(&route.as_str());
            let (mut status,result)=if req.method()!=&Method::Post || !(pairing || ["/v1/snapshot","/v1/start","/v1/reply","/v1/respond","/v1/action","/v1/composer","/v1/read","/v1/wake"].contains(&route.as_str())) {reason="unknown route or method".into();(404,Err("Unknown companion operation".into()))}
            else if !pairing && crate::companion_pairing::device(&root,&auth).ok().flatten().is_none() {reason="auth failure: no paired device matches the bearer token".into();(401,Err("Device is not authorized. Pair this iPhone in Mac settings.".into()))}
            else {
                let mut body=Vec::new();
                let result=req.as_reader().take(LIMIT+1).read_to_end(&mut body);
                if result.is_err() || body.len() as u64>LIMIT {reason="request body unreadable or over limit".into();(413,Err("Request is too large".into()))}
                else {
                    // preview_open may spend seconds dialing the relay, so it must not hold the global gate; it only reads state.
                    let preview=route=="/v1/composer" && serde_json::from_slice::<Value>(&body).is_ok_and(|p|p["operation"]=="preview_open");
                    let _lock=(!preview).then(||gate.lock().unwrap());
                    let caught=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||serde_json::from_slice(&body).map_err(|_|"Invalid request".to_string()).and_then(|p|match route.as_str() {
                        "/v1/pair/request"=>crate::companion_pairing::request(&root,&p),
                        "/v1/pair/claim"=>crate::companion_pairing::claim(&root,&p),
                        _=> { let Some(device)=crate::companion_pairing::device(&root,&auth)? else {return Err("Device revoked".into())}; dispatch_for_device(&root,&device,&route,p) },
                    })));
                    let mut panicked=false;
                    let result=caught.unwrap_or_else(|_|{panicked=true;reason="panic while handling request".into();Err("Companion server error. Check the Freddai log on your Mac.".into())});
                    match result {Ok(v)=>(200,Ok(v)), Err(e)=>{if reason.is_empty() {reason=e.clone();}(if panicked {500} else {400},Err(e))}}
                }
            };
            let payload=match result {Ok(v)=>json!({"result":v,"relay":crate::companion_pairing::edit(&root,|r|Ok(r.relay.clone())).ok().flatten()}),Err(e)=>json!({"error":e})};
            let text=match serde_json::to_string(&payload) {Ok(t)=>t,Err(e)=>{reason=format!("serialization failure: {e}");status=500;json!({"error":"Companion server could not encode the response."}).to_string()}};
            eprintln!("companion.server.request op={route} status={status} response_bytes={} duration_ms={} reason={reason:?}",text.len(),started.elapsed().as_millis());
            let response=Response::from_string(text).with_status_code(StatusCode(status))
                .with_header(Header::from_bytes("Content-Type","application/json").unwrap())
                .with_header(Header::from_bytes("Cache-Control","no-store").unwrap());
            let delivered=req.respond(response);
            eprintln!("companion.server.delivery op={route} scoped={} elapsed_ms={} delivered={} error={:?}",route=="/v1/snapshot" && payload["result"]["threads"].as_array().is_some_and(|threads|threads.iter().any(|t|t["messagesLoaded"]==false)),started.elapsed().as_millis(),delivered.is_ok(),delivered.err().map(|e|e.to_string()));
        }});
    }
    Ok(true)
}
/// Identity of one installed build: version plus the resolved binary path, size and mtime.
/// The desktop caches binaries under a content-hash name, so this changes on every new build.
pub fn build_identity(binary: &Path) -> String {
    let real=fs::canonicalize(binary).unwrap_or_else(|_|binary.to_path_buf());
    let meta=fs::metadata(&real).ok();
    let mtime=meta.as_ref().and_then(|m|m.modified().ok()).and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_secs()).unwrap_or(0);
    format!("{}|{}|{}|{}",env!("CARGO_PKG_VERSION"),real.display(),meta.map(|m|m.len()).unwrap_or(0),mtime)
}
#[derive(Debug, PartialEq)]
enum ServerState { Current, Stale { pid: Option<u32>, old: String } }
/// Decides whether a running server (lock held) must be replaced. `recorded` is (pid, identity)
/// from server.identity; None means a server that predates identity recording.
fn server_state(recorded: Option<(u32,String)>, own: &str) -> ServerState {
    match recorded {
        Some((_,id)) if id==own => ServerState::Current,
        Some((pid,id)) => ServerState::Stale { pid: Some(pid), old: id },
        None => ServerState::Stale { pid: None, old: "unrecorded (pre-identity build)".into() },
    }
}
fn lock_held(path: &Path) -> bool {
    let Ok(f)=fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(path) else {return false};
    match f.try_lock_exclusive() { Ok(())=>{let _=f.unlock();false}, Err(_)=>true }
}
fn lock_holders(path: &Path) -> Vec<u32> {
    let Ok(out)=std::process::Command::new("/usr/sbin/lsof").arg("-t").arg(path).output() else {return vec![]};
    String::from_utf8_lossy(&out.stdout).lines().filter_map(|l|l.trim().parse().ok()).filter(|p|*p!=std::process::id()).collect()
}
/// The companion server is a stateless HTTP front end over the host socket (agent work runs in the
/// separate `--host` process), so terminating it never interrupts agent turns.
fn replace_stale(dir: &Path, own: &str) {
    let lock=dir.join("listener.lock");
    if !lock_held(&lock) { return; }
    let recorded=fs::read_to_string(dir.join("server.identity")).ok().and_then(|t|serde_json::from_str::<Value>(&t).ok())
        .and_then(|v|Some((v["pid"].as_u64()? as u32,v["identity"].as_str()?.to_string())));
    let ServerState::Stale{pid,old}=server_state(recorded,own) else {return};
    let pids=match pid { Some(p)=>vec![p], None=>lock_holders(&lock) };
    if pids.is_empty() {
        eprintln!("companion_server.stale_replace_failed reason=\"lock held but holder pid not found\" old={old:?} new={own:?}");
        return;
    }
    eprintln!("companion_server.stale_replacing pids={pids:?} old={old:?} new={own:?}");
    for p in &pids { unsafe { libc::kill(*p as i32,libc::SIGTERM); } }
    let deadline=Instant::now()+Duration::from_secs(5);
    while Instant::now()<deadline {
        if !lock_held(&lock) {
            eprintln!("companion_server.stale_replaced pids={pids:?} old={old:?} new={own:?}");
            return;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    eprintln!("companion_server.stale_replace_failed reason=\"old server still holds lock after SIGTERM and 5s\" pids={pids:?} old={old:?} new={own:?}");
}
pub fn ensure(root: PathBuf, binary: PathBuf) -> Result<(), String> {
    if !root.join("companion/server.crt").exists() { return Ok(()); }
    replace_stale(&root.join("companion"),&build_identity(&binary));
    let mut child=std::process::Command::new(binary).arg("--companion-server").arg(root)
        .stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::inherit()).spawn().map_err(|e|e.to_string())?;
    std::thread::spawn(move || {let _=child.wait();});
    Ok(())
}

#[cfg(test)]
mod identity_tests {
    use super::*;
    #[test] fn server_replacement_decision() {
        assert_eq!(server_state(Some((1,"a".into())),"a"),ServerState::Current);
        assert_eq!(server_state(Some((7,"a".into())),"b"),ServerState::Stale{pid:Some(7),old:"a".into()});
        assert!(matches!(server_state(None,"b"),ServerState::Stale{pid:None,..}));
    }
    #[test] fn identity_changes_with_binary() {
        let d=std::env::temp_dir().join(format!("fr-id-{}",std::process::id()));fs::create_dir_all(&d).unwrap();
        let (a,b)=(d.join("a"),d.join("b"));fs::write(&a,"1").unwrap();fs::write(&b,"1").unwrap();
        assert_eq!(build_identity(&a),build_identity(&a));
        assert_ne!(build_identity(&a),build_identity(&b));
        fs::remove_dir_all(d).unwrap();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn next_message_controls_are_scoped_and_preserve_explicit_approval() {
        let options=message_options(&json!({"model":"chosen","effort":"high","permission_mode":"ask","attachments":["file-id"],"update_agent_controls":true,"worktree":true,"scheduled":true,"request_id":"forged"}),"retry-1").unwrap();
        assert_eq!(options.model.as_deref(),Some("chosen"));
        assert_eq!(options.request_id.as_deref(),Some("phone:retry-1"));
        assert!(!options.worktree && !options.scheduled);
        assert!(options.update_agent_controls);
        assert_eq!(new_thread_options("codex",false,options).permission_mode,Some(freddai_core::runtime::PermissionMode::Ask));
        assert!(message_options(&json!({"attachments":vec!["a";21]}),"r").is_err());
    }
    #[test] fn phone_attachment_chunks_are_bounded_ordered_and_immutable() {
        let root=std::env::temp_dir().join(format!("fr-upload-{}",crate::companion_crypto::random()));
        assert!(upload(&root,&json!({"action":"begin","name":"../escape"})).is_err());
        let id=upload(&root,&json!({"action":"begin","name":"name"})).unwrap();
        let chunk=json!({"action":"chunk","id":id,"offset":0,"data":"686579"});
        upload(&root,&chunk).unwrap(); upload(&root,&chunk).unwrap();
        assert!(upload(&root,&json!({"action":"chunk","id":id,"offset":1,"data":"61"})).is_err());
        assert!(upload(&root,&json!({"action":"chunk","id":id,"offset":25*1024*1024,"data":"61"})).is_err());
        assert!(upload(&root,&json!({"action":"finish","id":id,"size":4})).is_err());
        let done=json!({"action":"finish","id":id,"size":3});
        let file=upload(&root,&done).unwrap();assert_eq!(upload(&root,&done).unwrap(),file);
        assert_eq!(file["name"],"name");
        let (_,bytes,path)=freddai_core::attachments::load(&root,file["id"].as_str().unwrap()).unwrap();
        assert_eq!(bytes,b"hey");fs::write(path,"changed").unwrap();
        assert!(freddai_core::attachments::load(&root,file["id"].as_str().unwrap()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn phone_dictation_validates_upload_before_transcribing() {
        let root=std::env::temp_dir().join(format!("fr-voice-{}",crate::companion_crypto::random()));
        assert!(voice_upload_dir(&root,&json!({})).is_err());
        assert!(voice_upload_dir(&root,&json!({"id":"../escape"})).is_err());
        assert!(voice_upload_dir(&root,&json!({"id":"ab".repeat(32)})).is_err());
        let id=upload(&root,&json!({"action":"begin","name":"dictation.m4a"})).unwrap();
        let id=id.as_str().unwrap();
        let input=json!({"id":id});
        let dir=voice_upload_dir(&root,&input).unwrap();
        assert!(voice_prepare_audio(&dir,&input).is_err()); // empty
        upload(&root,&json!({"action":"chunk","id":id,"offset":0,"data":"686579"})).unwrap();
        assert!(voice_prepare_audio(&dir,&json!({"id":id,"size":4})).is_err()); // size mismatch
        let audio=voice_prepare_audio(&dir,&json!({"id":id,"size":3})).unwrap();
        assert_eq!(audio.file_name().unwrap(),"audio.m4a");
        assert_eq!(fs::read(&audio).unwrap(),b"hey");
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn device_auth_rejects_missing_and_wrong_credentials() {
        assert!(!authorized(b"",b"Bearer secret"));
        assert!(!authorized(b"Bearer wrong!",b"Bearer secret"));
        assert!(authorized(b"Bearer secret",b"Bearer secret"));
    }
    #[test] fn assistant_projection_exposes_only_display_metadata() {
        let mut db=Database::default();
        db.accounts.push(serde_json::from_value(json!({"id":"synthetic","name":"Test assistant","provider":"codex","color":"#aaa","config_home":"/private/test-credentials"})).unwrap());
        db.projects.push(serde_json::from_value(json!({"id":"p","name":"Project","path":std::env::temp_dir(),"color":"#aaa","policy":"inherit","account":null,"last":null})).unwrap());
        let v=project_snapshot(&db);
        assert_eq!(v["projects"][0]["assistants"],json!([{"id":"synthetic","name":"Test assistant","provider":"codex","color":"#aaa"}]));
        assert_eq!(v["projects"][0]["canStart"],true);
        assert!(resolve(&db,&db.projects[0],Some("synthetic".into())).is_ok());
        assert!(resolve(&db,&db.projects[0],Some("removed".into())).is_err());
        assert!(!v.to_string().contains("test-credentials"));
    }
    #[test] fn companion_follows_saved_account_order() {
        let root=std::env::temp_dir().join(format!("fr-acct-order-{}",crate::companion_crypto::random()));
        crate::thread_list_settings::save_account_order(&root,&["b".to_string(),"a".to_string()]).unwrap();
        let mut db=Database::default();
        for id in ["a","b"] { db.accounts.push(serde_json::from_value(json!({"id":id,"name":id,"provider":"codex","color":"#aaa"})).unwrap()); }
        apply_account_order(&root,&mut db);
        let ids=|v:&Value|v.as_array().unwrap().iter().map(|a|a["id"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        assert_eq!(ids(&companion_product_usage(&root,&db)),["b","a"]);
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn projection_excludes_configuration_and_archived_work() {
        let db=Database::default();
        let v=project_snapshot(&db);
        assert_eq!(v,json!({"projects":[],"threads":[],"schedules":[],"workspaces":[],"modelConfiguration":{}}));
        assert!(v.get("accounts").is_none()); assert!(v.get("preferences").is_none());
        let session=json!({"id":"s1","project":"p1","account":"missing","title":"Synthetic thread","status":"waiting","updated":1,"last_user_message_at":7,"provider_id":null,"messages":[],"pending":{"id":7,"method":"item/tool/requestUserInput"},"error":null});
        let mut archived=session.clone(); archived["id"]=json!("archived"); archived["archived"]=json!(true);
        let mut deleted=session.clone(); deleted["id"]=json!("deleted"); deleted["deleted_at"]=json!(1);
        let db:Database=serde_json::from_value(json!({
            "accounts":[],"preferences":{"prefer_last":false,"fallback":null,"last":null},
            "projects":[{"id":"p1","name":"Synthetic project","path":"/private/not-a-real-project","color":"#aaa","policy":"inherit","account":null,"last":null}],
            "sessions":[session,archived,deleted]
        })).unwrap();
        let v=project_snapshot(&db);
        assert_eq!(v["threads"].as_array().unwrap().len(),1);
        assert_eq!(v["threads"][0]["canReply"],false);
        assert_eq!(v["threads"][0]["pending"]["id"],7);
        assert_eq!(v["threads"][0]["last_user_message_at"],7);
        assert_eq!(v["projects"][0]["canStart"],false);
        assert!(v["projects"][0].get("path").is_none());
        assert!(v["threads"][0].get("account").is_none());
        assert!(v["threads"][0].get("provider_id").is_none());
    }
}

#[cfg(test)] mod snapshot_scale_tests {
    use super::*;
    #[test] fn unopened_threads_carry_only_list_metadata_but_opened_threads_keep_every_detail() {
        let mut db=Database::default();
        db.sessions.push(serde_json::from_value(json!({"id":"thread","project":"p","account":"none","title":"Waiting task","status":"running","updated":9,"read_at":4,"last_user_message_at":7,"provider_id":null,
            "messages":[{"id":"m","role":"assistant","text":"TRANSCRIPT_DETAIL"}],
            "pending":{"id":3,"params":{"command":"APPROVAL_DETAIL"}},"error":"ERROR_DETAIL",
            "options":{"model":"MODEL_DETAIL"},"usage":{"context_tokens":42,"context_window":100}})).unwrap());
        db.queues.push(serde_json::from_value(json!({"session":"thread","paused":true,"error":"QUEUE_ERROR_DETAIL","messages":[{"id":"q","prompt":"QUEUE_PROMPT_DETAIL","options":{}},{"id":"commander-heartbeat-1","prompt":"Heartbeat","options":{}},{"id":"commander-wake-1","prompt":"Delegated notice","options":{}}]})).unwrap());
        let overview=project_snapshot_selection(&db,None,true);
        let row=&overview["threads"][0];
        assert_eq!(row["title"],"Waiting task");
        assert_eq!(row["pending"],json!({}),"only an attention marker belongs in the title index");
        assert_eq!(row["queued"],1);
        assert_eq!(row["read_at"],4);
        assert_eq!(row["last_user_message_at"],7);
        assert_eq!(row["messagesLoaded"],false);
        assert_eq!(row["canReply"],false);
        for field in ["usage","options","queue","queueError","tasks"] { assert!(row.get(field).is_none(),"{field} belongs to the opened conversation"); }
        assert!(!overview.to_string().contains("_DETAIL"));
        let full=project_snapshot_selection(&db,Some("thread"),true);
        let full=&full["threads"][0];
        assert_eq!(full["messages"],json!(db.sessions[0].messages));
        assert_eq!(full["pending"],json!(db.sessions[0].pending));
        assert_eq!(full["usage"]["context_tokens"],42);
        assert_eq!(full["options"]["model"],"MODEL_DETAIL");
        assert_eq!(full["queue"][0]["prompt"],"QUEUE_PROMPT_DETAIL");
        assert_eq!(full["queueError"],"QUEUE_ERROR_DETAIL");
        assert_eq!(full["messagesLoaded"],true);
    }
    #[test] fn home_snapshot_does_not_download_every_conversation() {
        let mut db=Database::default();
        for n in 0..124 {
            db.sessions.push(serde_json::from_value(json!({"id":format!("thread-{n}"),"project":"p","account":"none","title":"Synthetic thread","status":"done","updated":1,"provider_id":null,"messages":[{"id":"m","role":"assistant","text":"synthetic history ".repeat(20_000)}],"pending":null,"error":null})).unwrap());
        }
        let result=project_snapshot_selection(&db,None,true);
        let bytes=serde_json::to_vec(&result).unwrap().len();
        assert!(bytes<256*1024,"Home loaded all transcripts: {bytes} bytes");
        assert_eq!(result["threads"].as_array().unwrap().len(),124);
        assert_eq!(result["threads"][0]["messagesLoaded"],false);
        let selected=project_snapshot_selection(&db,Some("thread-73"),true);
        assert!(serde_json::to_vec(&selected).unwrap().len()<1024*1024);
        assert_eq!(selected["threads"][73]["messages"],json!(db.sessions[73].messages));
        assert_eq!(selected["threads"][73]["messagesLoaded"],true);
        assert_eq!(selected["threads"][0]["messages"],json!([]));
        // Older clients continue to receive every transcript, with no silent history loss.
        assert_eq!(project_snapshot(&db)["threads"][0]["messages"],json!(db.sessions[0].messages));
        eprintln!("Scoped home snapshot: {bytes} bytes for 124 threads");
    }
}

#[cfg(test)]
mod summary_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};

    #[test]
    fn mobile_summary_commands_pass_the_guard_and_reach_the_host() {
        let root = std::env::temp_dir().join(format!("fr-sum-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let cached = json!({"date":"2026-11-04","summary":{"date":"2026-11-04","markdown":"Cached summary","generated_at":1,"provider":"","account":"","model":"","threads":2},"running":false,"threads":2,"error":null});
        let expected = cached.clone();
        let host = std::thread::spawn(move || {
            for operation in ["day_summary", "summarize_day"] {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], operation);
                assert_eq!(request["params"]["date"], "2026-11-04");
                if operation == "summarize_day" { assert_eq!(request["params"]["force"], false); }
                writeln!(connection, "{}", json!({"result":cached})).unwrap();
            }
        });
        for operation in ["day_summary", "summarize_day"] {
            crate::companion_operations::validate(operation).unwrap();
            let result = dispatch(&root, "/v1/composer", json!({"operation":operation,"input":{"date":"2026-11-04","force":false}})).unwrap();
            assert_eq!(result, expected);
        }
        host.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod schedule_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};
    #[test]
    fn schedule_commands_reach_host_without_arbitrary_rpc_access() {
        let root = std::env::temp_dir().join(format!("fr-sched-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let host = std::thread::spawn(move || {
            for operation in ["save_schedule", "schedule_action"] {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], operation);
                assert_eq!(request["params"]["schedule"], "schedule-id");
                writeln!(connection, "{}", json!({"result":null})).unwrap();
            }
        });
        for operation in ["save_schedule", "schedule_action"] {
            crate::companion_operations::validate(operation).unwrap();
            dispatch(&root, "/v1/composer", json!({"operation":operation,"input":{"schedule":"schedule-id","action":"delete"}})).unwrap();
        }
        assert!(crate::companion_operations::validate("shell").is_err());
        host.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod schedule_guard_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener, sync::mpsc};
    /// Fake host answering `expected` calls in order; returns (root, requests received, join handle).
    fn fake_host(tag: &str, replies: Vec<(&'static str, Value)>) -> (PathBuf, mpsc::Receiver<Value>, std::thread::JoinHandle<()>) {
        let root = std::env::temp_dir().join(format!("fr-{tag}-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let (tx, rx) = mpsc::channel();
        let handle = std::thread::spawn(move || {
            for (method, reply) in replies {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], method);
                tx.send(request).unwrap();
                writeln!(connection, "{}", json!({"result":reply})).unwrap();
            }
        });
        (root, rx, handle)
    }
    #[test]
    fn companion_model_configuration_only_forwards_validated_mapping() {
        let config = json!({"claude":{"smart":{"family":"opus","effort":"high"}}});
        let (root,rx,worker) = fake_host("model-config", vec![("hello",json!({"model_configuration":1})),("save_preferences",Value::Null)]);
        composer(&root,&Database::default(),&json!({"operation":"save_model_configuration","input":{"configuration":config,"patch":{"fallback":"must-not-forward"}}})).unwrap();
        assert_eq!(rx.recv().unwrap()["method"],"hello");
        assert_eq!(rx.recv().unwrap()["params"],json!({"patch":{"model_configuration":config}}));
        worker.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn companion_model_configuration_rejects_older_host() {
        let (root,_rx,worker) = fake_host("old-model-config",vec![("hello",json!({"version":"2"}))]);
        assert!(composer(&root,&Database::default(),&json!({"operation":"save_model_configuration","input":{"configuration":{}}})).unwrap_err().contains("background engine"));
        worker.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn device_cannot_set_schedule_options_or_run_history() {
        let existing = json!({"permission_mode":"default","worktree":true,"scheduled":true});
        let (root, rx, host) = fake_host("sched-opts", vec![
            ("snapshot", json!({"schedules":[{"id":"s1","options":existing}]})),
            ("save_schedule", json!(null)),
            ("save_schedule", json!(null)),
        ]);
        let forged = json!({"permission_mode":"bypass"});
        dispatch(&root, "/v1/composer", json!({"operation":"save_schedule","input":{"schedule":{"id":"s1","name":"n","options":forged,"runs":[{"x":1}],"run_now":5}}})).unwrap();
        assert_eq!(rx.recv().unwrap()["method"], "snapshot");
        let saved = rx.recv().unwrap();
        assert_eq!(saved["params"]["schedule"]["options"], existing);
        assert_eq!(saved["params"]["schedule"]["name"], "n");
        assert!(saved["params"]["schedule"].get("runs").is_none());
        assert!(saved["params"]["schedule"].get("run_now").is_none());
        dispatch(&root, "/v1/composer", json!({"operation":"save_schedule","input":{"schedule":{"id":"","name":"new","options":forged}}})).unwrap();
        let created = rx.recv().unwrap();
        assert_eq!(created["params"]["schedule"]["options"], serde_json::to_value(LaunchOptions::default()).unwrap());
        assert_ne!(created["params"]["schedule"]["options"]["permission_mode"], "bypass");
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn older_host_rejects_end_date_without_reaching_save() {
        let (root, rx, host) = fake_host("sched-old", vec![("hello", json!({"version":"2"}))]);
        let error = dispatch(&root, "/v1/composer", json!({"operation":"save_schedule","input":{"schedule":{"id":"","name":"n","end_date":"2027-01-01"}}})).unwrap_err();
        assert!(error.contains("enforce end dates"), "{error}");
        host.join().unwrap();
        assert_eq!(rx.recv().unwrap()["method"], "hello");
        assert!(rx.try_recv().is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn schedule_action_passes_through_unchanged() {
        let (root, rx, host) = fake_host("sched-act", vec![("schedule_action", json!(null))]);
        dispatch(&root, "/v1/composer", json!({"operation":"schedule_action","input":{"schedule":"s1","action":"pause"}})).unwrap();
        host.join().unwrap();
        assert_eq!(rx.recv().unwrap()["params"], json!({"schedule":"s1","action":"pause"}));
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod google_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};
    #[test]
    fn google_accounts_and_triggers_reach_host_and_credentials_do_not() {
        let root = std::env::temp_dir().join(format!("fr-google-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let operations = ["google_accounts", "google_disconnect", "google_triggers", "google_trigger_save", "google_trigger_delete"];
        let host = std::thread::spawn(move || {
            for operation in operations {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], operation);
                assert_eq!(request["params"]["marker"], "kept");
                writeln!(connection, "{}", json!({"result":null})).unwrap();
            }
        });
        for operation in operations {
            crate::companion_operations::validate(operation).unwrap();
            dispatch(&root, "/v1/composer", json!({"operation":operation,"input":{"marker":"kept"}})).unwrap();
        }
        for operation in ["google_config_get", "google_config_set", "google_connect_start", "google_connect_status"] {
            assert!(crate::companion_operations::validate(operation).is_err());
        }
        host.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod thread_list_settings_tests {
    use super::*;

    #[test]
    fn unread_experiment_is_backward_compatible_and_crosses_snapshot_boundary() {
        let legacy = json!({"projectOrder":[],"grouped":true,"hideRead":true,"recentFinished":5});
        let settings: ThreadListSettings = serde_json::from_value(legacy.clone()).unwrap();
        assert!(!settings.ignore_unread);
        let mut enabled = legacy;
        enabled["ignoreUnread"] = json!(true);
        let settings: ThreadListSettings = serde_json::from_value(enabled).unwrap();
        assert!(settings.ignore_unread);
        assert_eq!(serde_json::to_value(settings).unwrap()["ignoreUnread"], true);
    }

    #[test]
    fn project_name_uppercase_defaults_false_and_round_trips() {
        let legacy = json!({"projectOrder":[],"grouped":true,"hideRead":true,"recentFinished":5});
        let settings: ThreadListSettings = serde_json::from_value(legacy.clone()).unwrap();
        assert!(!settings.project_name_uppercase);
        let mut enabled = legacy;
        enabled["projectNameUppercase"] = json!(true);
        let settings: ThreadListSettings = serde_json::from_value(enabled).unwrap();
        assert!(settings.project_name_uppercase);
        assert_eq!(serde_json::to_value(settings).unwrap()["projectNameUppercase"], true);
    }
}

#[cfg(test)]
mod workspace_pin_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};

    fn database() -> Database {
        serde_json::from_value(json!({"accounts":[],"projects":[{"id":"p","name":"Project","path":"/not-a-real-folder","color":"#112233","policy":"inherit"}],
            "preferences":{"prefer_last":false,"fallback":null,"last":null,"workspaces":[{"id":"w","name":"Work","color":"#112233","projects":["p"]}]},
            "sessions":[{"id":"t","project":"p","account":"","title":"Pinned task","status":"running","updated":1,"pinned":true,"messages":[]}]})).unwrap()
    }
    #[test]
    fn interrupted_resume_reaches_launch_without_draining_paused_queue() {
        use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};
        let root = std::env::temp_dir().join(format!("fr-resume-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let mut value = serde_json::to_value(database()).unwrap();
        value["sessions"][0]["status"] = json!("interrupted");
        value["sessions"][0]["provider_id"] = json!("synthetic-provider-thread");
        value["queues"] = json!([{"session":"t","paused":true,"messages":[]}]);
        let db: Database = serde_json::from_value(value).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let host = std::thread::spawn(move || {
            for method in ["queue_action", "launch"] {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], method);
                if method == "queue_action" { assert_eq!(request["params"]["action"], "pause"); }
                else {
                    assert_eq!(request["params"]["existing"], "t");
                    assert_eq!(request["params"]["prompt"], "Continue where you left off.");
                    assert_eq!(request["params"]["options"]["request_id"], "phone:resume-test");
                }
                writeln!(connection, "{}", json!({"result":null})).unwrap();
            }
        });
        crate::companion_operations::validate("resume_thread").unwrap();
        composer(&root, &db, &json!({"operation":"resume_thread","input":{"thread":"t","requestId":"resume-test"}})).unwrap();
        host.join().unwrap();
        let mut invalid = db;
        invalid.sessions[0].status = "running".into();
        assert!(composer(&root, &invalid, &json!({"operation":"resume_thread","input":{"thread":"t","requestId":"rejected"}})).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn remote_project_presentation_rejects_invalid_input_and_filters_host_payload() {
        let root = std::env::temp_dir().join(format!("fr-pe-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let db = database();
        for input in [json!({"project":"missing","name":"Name","color":"#123456"}), json!({"project":"p","name":" ","color":"#123456"}), json!({"project":"p","name":"Name","color":"red"})] {
            assert!(composer(&root, &db, &json!({"operation":"update_project_organization","input":input})).is_err());
        }
        let listener = UnixListener::bind(root.join("host.sock")).unwrap();
        let host = std::thread::spawn(move || {
            let (mut connection, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
            let request: Value = serde_json::from_str(&line).unwrap();
            assert_eq!(request["method"], "update_project_organization");
            assert_eq!(request["params"], json!({"project":"p","name":"Renamed","color":"#123456"}));
            writeln!(connection, "{}", json!({"result":null})).unwrap();
        });
        crate::companion_operations::validate("update_project_organization").unwrap();
        composer(&root, &db, &json!({"operation":"update_project_organization","input":{"project":"p","name":" Renamed ","color":"#123456","path":"/must-not-forward","account":"must-not-forward"}})).unwrap();
        host.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn remote_project_moves_preserve_hidden_projects_and_sidebar_settings() {
        let root = std::env::temp_dir().join(format!("fr-order-{}", crate::companion_crypto::random()));
        fs::create_dir_all(root.join("companion")).unwrap();
        let mut value = serde_json::to_value(database()).unwrap();
        let mut second = value["projects"][0].clone(); second["id"] = json!("q");
        let mut hidden = second.clone(); hidden["id"] = json!("hidden");
        value["projects"].as_array_mut().unwrap().extend([second, hidden]);
        let db: Database = serde_json::from_value(value).unwrap();
        let settings = json!({"projectOrder":["p","hidden","q"],"grouped":true,"hideRead":false,"recentFinished":10});
        fs::write(root.join("companion/thread-list.json"), settings.to_string()).unwrap();
        crate::companion_operations::validate("move_project").unwrap();
        let result = composer(&root, &db, &json!({"operation":"move_project","input":{"project":"q","target":"p","after":false}})).unwrap();
        assert_eq!(result, json!(["q","p","hidden"]));
        assert_eq!(crate::thread_list_settings::project_order(&root).unwrap().unwrap(), vec!["q", "p", "hidden"]);
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(root.join("companion/thread-list.json")).unwrap()).unwrap(), settings);
        assert!(composer(&root, &db, &json!({"operation":"move_project","input":{"project":"q","target":"missing"}})).is_err());
        assert_eq!(composer(&root, &db, &json!({"operation":"move_project","input":{"project":"q","target":"hidden","after":true}})).unwrap(), json!(["p","hidden","q"]));
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn full_and_scoped_projection_share_workspaces_and_pins_without_preferences() {
        let db = database();
        for scoped in [false, true] {
            let value = project_snapshot_selection(&db, None, scoped);
            assert_eq!(value["workspaces"], json!(db.preferences.workspaces));
            assert_eq!(value["threads"][0]["pinned"], true);
            assert!(value.get("preferences").is_none());
            assert!(value.get("accounts").is_none());
        }
    }
    #[test]
    fn rejects_invalid_remote_membership_and_duplicate_workspace_ids() {
        let db = database();
        let root = Path::new("/not-used-invalid-workspace");
        for workspaces in [json!([{"id":"w","name":"Work","color":"#112233","projects":["missing"]}]),
            json!([{"id":"w","name":"Work","color":"#112233","projects":[]},{"id":"w","name":"Duplicate","color":"#112233","projects":[]}]),
            json!([{"id":"w","name":" ","color":"#112233","projects":[]}]),
            json!([{"id":"w","name":"Work","color":"invalid","projects":[]}])] {
            assert!(composer(root, &db, &json!({"operation":"save_workspaces","input":{"workspaces":workspaces}})).is_err());
        }
    }
    #[test]
    fn remote_pins_leave_running_threads_alone_and_workspace_saves_patch_only_workspaces() {
        let root = std::env::temp_dir().join(format!("fr-ws-pin-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let db = serde_json::to_value(database()).unwrap();
        let host = std::thread::spawn(move || {
            for action in ["pin", "unpin", "save_workspaces"] {
                for step in 0..2 {
                    let (mut connection, _) = socket.accept().unwrap();
                    let mut line = String::new();
                    BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                    let request: Value = serde_json::from_str(&line).unwrap();
                    let result = if step == 0 {
                        assert_eq!(request["method"], "snapshot_since"); db.clone()
                    } else if action == "save_workspaces" {
                        assert_eq!(request["method"], "save_preferences");
                        assert_eq!(request["params"], json!({"patch":{"workspaces":[]}})); Value::Null
                    } else {
                        assert_eq!(request["method"], "thread_action");
                        assert_eq!(request["params"]["action"], action);
                        assert_eq!(request["params"]["session"], "t"); Value::Null
                    };
                    writeln!(connection, "{}", json!({"result":result})).unwrap();
                }
            }
        });
        for action in ["pin", "unpin"] { dispatch(&root,"/v1/action",json!({"thread":"t","action":action})).unwrap(); }
        crate::companion_operations::validate("save_workspaces").unwrap();
        dispatch(&root,"/v1/composer",json!({"operation":"save_workspaces","input":{"workspaces":[],"patch":{"fallback":"must-not-forward"}}})).unwrap();
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod old_workspace_host_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};
    #[test]
    fn older_host_cannot_silently_accept_workspace_edits() {
        let root = std::env::temp_dir().join(format!("fr-old-ws-{}", &crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket = UnixListener::bind(root.join("host.sock")).unwrap();
        let mut db = serde_json::to_value(Database::default()).unwrap();
        db["preferences"].as_object_mut().unwrap().remove("workspaces");
        let host = std::thread::spawn(move || {
            for step in 0..2 {
                let (mut connection, _) = socket.accept().unwrap();
                let mut line = String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request: Value = serde_json::from_str(&line).unwrap();
                assert_eq!(request["method"], if step == 0 {"snapshot"} else {"snapshot_since"});
                writeln!(connection, "{}", json!({"result":db})).unwrap();
            }
        });
        let snapshot = dispatch(&root,"/v1/snapshot",json!({})).unwrap();
        assert!(snapshot.get("workspaces").is_none());
        assert!(dispatch(&root,"/v1/composer",json!({"operation":"save_workspaces","input":{"workspaces":[]}})).unwrap_err().contains("background host needs an update"));
        host.join().unwrap(); fs::remove_dir_all(root).unwrap();
    }
}

#[cfg(test)]
mod scoped_host_transport_tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, os::unix::net::UnixListener};
    #[test]
    fn scoped_connection_restores_open_tool_history_without_loading_closed_history() {
        let root=std::env::temp_dir().join(format!("fr-tool-{}",&crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket=UnixListener::bind(root.join("host.sock")).unwrap();
        let original="🦀 tool output ".repeat(12_000);
        let expected=original.clone();
        let hash=freddai_core::desktop_snapshot::text_hash(&original);
        let worker=std::thread::spawn(move || {
            let mut restored=0;
            loop {
                let (mut connection,_)=socket.accept().unwrap();
                let mut line=String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                let request:Value=serde_json::from_str(&line).unwrap();
                let result=if request["method"]=="snapshot_since" {
                    assert_eq!(request["params"]["openThreads"],json!(["open"]));
                    let mut db=serde_json::to_value(Database::default()).unwrap();
                    db["sessions"]=json!([
                        {"id":"open","project":"p","account":"none","title":"Open","status":"done","updated":1,"messages":[{"id":"tool","role":"tool","text":"{}","toolTextBytes":original.len(),"toolTextHash":hash}]},
                        {"id":"closed","project":"p","account":"none","title":"Closed","status":"done","updated":1,"messages":[{"id":"user","role":"user","text":"Unrelated history"}]}]);
                    db
                } else {
                    assert_eq!(request["method"],"tool_text");
                    assert_eq!(request["params"]["hash"],hash);
                    assert_eq!(request["params"]["offset"],restored);
                    let page=freddai_core::desktop_snapshot::text_chunk(&original,restored,Some(&hash)).unwrap();
                    restored+=page["text"].as_str().unwrap().len();page
                };
                writeln!(connection,"{}",json!({"result":result})).unwrap();
                if restored==original.len() {break;}
            }
        });
        let result=dispatch(&root,"/v1/snapshot",json!({"scoped":true,"thread":"open"})).unwrap();
        worker.join().unwrap();fs::remove_dir_all(root).unwrap();
        assert_eq!(result["threads"][0]["messages"][0]["text"],expected);
        assert_eq!(result["threads"][1]["messages"],json!([]));
        assert_eq!(result["threads"][0]["messagesLoaded"],true);
    }
    #[test]
    fn companion_connects_without_requesting_the_entire_workspace() {
        let root=std::env::temp_dir().join(format!("fr-connect-{}",&crate::companion_crypto::random()[..12]));
        fs::create_dir_all(&root).unwrap();
        let socket=UnixListener::bind(root.join("host.sock")).unwrap();
        let worker=std::thread::spawn(move || {
            let (mut connection,_)=socket.accept().unwrap();
            let mut line=String::new();
            BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
            let request:Value=serde_json::from_str(&line).unwrap();
            // Model the live failure at its actual RPC boundary, without a 512 MB fixture.
            let reply=if request["method"]=="snapshot_since" && request["params"]["openThreads"]==json!([]) {
                json!({"result":Database::default()})
            } else {json!({"error":"Host reply for `snapshot` exceeded 536870912 bytes and was truncated"})};
            writeln!(connection,"{reply}").unwrap();
        });
        let result=dispatch(&root,"/v1/snapshot",json!({"scoped":true}));
        worker.join().unwrap();fs::remove_dir_all(root).unwrap();
        assert!(result.is_ok(),"Initial companion connection must use the bounded host projection: {result:?}");
    }
}

#[cfg(test)]
mod scheduled_indicator_tests {
    use super::*;
    #[test]
    fn scheduled_flag_survives_summary_and_full_snapshots() {
        for (schedule_id, scheduled, expected) in [(Some("schedule"), false, true), (None, true, true), (None, false, false)] {
            let mut db = Database::default();
            db.sessions.push(serde_json::from_value(json!({"id":"t","project":"p","account":"","title":"Task","status":"done","updated":1,"messages":[],"schedule_id":schedule_id,"options":{"scheduled":scheduled}})).unwrap());
            for scoped in [false, true] {
                assert_eq!(project_snapshot_selection(&db, None, scoped)["threads"][0]["scheduled"], expected);
            }
        }
    }
}
