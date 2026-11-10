use crate::companion_crypto::{self as crypto, Envelope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::{Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use tauri::State;
use crate::client_diag::{decode,error_chain,host_of,log_client_error,parse_body,INVALID};
use crate::companion_enrollment::Provision;
#[derive(Clone)]
struct Connection { provision:Provision, local:reqwest::Client }
#[derive(Clone,Serialize,Deserialize)]
struct Device {id:String,key:String,mailbox:String}
#[derive(Clone,Serialize,Deserialize)]
struct Credential {#[serde(default)] provision:Option<Provision>,device:Device,relay:Option<String>,#[serde(default)] wake:Option<crate::wake::WakeInfo>}
struct Pending {id:String,claim:String,connection:Connection}
struct Companion {#[cfg(target_os = "android")] app:tauri::AppHandle,internet:reqwest::Client,connection:Mutex<Option<Connection>>,credential:Mutex<Option<Credential>>,pending:Mutex<Option<Pending>>,storage_error:Option<String>,relay_active:AtomicBool}
#[cfg(any(target_os = "ios", target_os = "macos"))]
#[cfg(target_os = "ios")]
const SERVICE:&str="com.freddai.companion.pairing.v1";
#[cfg(target_os = "macos")]
const SERVICE:&str="com.freddai.desktop.satellite.pairing.v1";
fn save(h:&Companion,c:Credential)->Result<(),String> {
    let data=serde_json::to_vec(&c).map_err(|e|e.to_string())?;
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    security_framework::passwords::set_generic_password(SERVICE,"device",&data).map_err(|_|"Cannot save paired device in Keychain")?;
    #[cfg(target_os = "android")]
    tauri_plugin_native_shell::write_credential(&h.app, std::str::from_utf8(&data).map_err(|_|"Invalid credential encoding")?)?;
    *h.credential.lock().map_err(|_|"Device storage busy")?=Some(c);Ok(())
}
fn credential(h:&Companion)->Result<Credential,String> {
    if let Some(error)=&h.storage_error{return Err(error.clone());}
    h.credential.lock().map_err(|_|"Device storage busy")?.clone().ok_or_else(||"Pair this phone in Freddai settings on your Mac.".into())
}
#[tauri::command] fn platform()->&'static str { std::env::consts::OS }
#[tauri::command] fn companion_pairing_status(h:State<'_,Companion>)->Result<bool,String> {
    if let Some(error)=&h.storage_error{return Err(error.clone());}
    Ok(h.credential.lock().map_err(|_|"Device storage busy")?.is_some())
}
async fn pairing_call(connection:&Connection,route:&str,body:Value)->Result<Value,String> {
    let started=Instant::now();
    let response=connection.local.post(format!("{}{route}",connection.provision.endpoint)).json(&body).send().await
        .map_err(|e|{log_client_error(route,"direct",&host_of(&connection.provision.endpoint),None,"",None,None,started,&error_chain(&e),"");"Cannot reach your Mac. Pair while both devices are on the same local network with Freddai open."})?;
    decode(read_json(response,route,&host_of(&connection.provision.endpoint),started,8).await?)
}
#[tauri::command]
async fn companion_pair(h:State<'_,Companion>,code:String,name:String,setup:Option<String>)->Result<(),String> {
    let provision=match setup.filter(|s|!s.trim().is_empty()) {
        Some(text)=>Provision::parse(&text)?,
        None=>saved_provision(&h)?.ok_or("Paste the Mac setup from Freddai settings")?,
    };
    let connection=Connection{local:provision.client()?,provision};
    if code.len()!=6 || !code.bytes().all(|b|b.is_ascii_digit()){return Err("Enter the six-digit code displayed on your Mac".into());}
    let claim=crypto::random();
    let response=pairing_call(&connection,"/v1/pair/request",json!({"code":code,"claim":claim,"name":name})).await?;
    let id=response["id"].as_str().ok_or("Invalid pairing request")?.to_string();
    *h.pending.lock().map_err(|_|"Pairing busy")?=Some(Pending{id,claim,connection});Ok(())
}
#[tauri::command]
async fn companion_pair_claim(h:State<'_,Companion>)->Result<bool,String> {
    let (body,connection)={let p=h.pending.lock().map_err(|_|"Pairing busy")?;let p=p.as_ref().ok_or("Enter a new code from your Mac")?;(json!({"id":p.id,"claim":p.claim}),p.connection.clone())};
    let result=pairing_call(&connection,"/v1/pair/claim",body).await?;
    if result["waiting"]==true{return Ok(false);}
    let mut c:Credential=serde_json::from_value(result).map_err(|_|"Invalid pairing credentials")?;
    if c.device.key.len()!=64 || c.device.mailbox.len()!=64 || c.device.id.len()!=64 {return Err("Invalid pairing credentials".into());}
    if let Some(url)=&c.relay {crypto::relay_url(url)?;}
    c.provision=Some(connection.provision);
    save(&h,c)?;*h.pending.lock().map_err(|_|"Pairing busy")?=None;Ok(true)
}
/// Reads the whole body first (so it can be reported), then parses it. Every failure is logged as `companion.client.error`.
async fn read_json(response:reqwest::Response,op:&str,host:&str,started:Instant,limit_secs:u64)->Result<Value,String> {
    let status=response.status().as_u16();
    let ct=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
    let declared=response.content_length();
    let bytes=match response.bytes().await {
        Ok(b)=>b,
        Err(e)=>{
            let message=if e.is_timeout() {format!("{INVALID}: response timed out after {limit_secs}s")} else {format!("{INVALID}: body cut off (read failed)")};
            log_client_error(op,"direct",host,Some(status),&ct,declared,None,started,&error_chain(&e),"");
            return Err(message);
        }
    };
    parse_body(status,&ct,declared,&bytes).map_err(|(message,detail)|{
        log_client_error(op,"direct",host,Some(status),&ct,declared,Some(bytes.len()),started,&format!("{message}; {detail}"),&String::from_utf8_lossy(&bytes));
        message
    })
}
async fn remember_relay(h:&Companion,mut c:Credential,value:&Value)->Result<Value,String> {
    if value.get("relay").is_some() {
        let relay=value["relay"].as_str().map(crypto::relay_url).transpose()?;
        if c.relay!=relay {c.relay=relay;save(h,c)?;}
    }
    decode(value.clone())
}
async fn remote(h:&Companion,c:&Credential,route:&str,body:Value,polls:u32)->Result<Value,String> {
    let started=Instant::now();
    let result=remote_inner(h,c,route,body,polls).await;
    if let Err(e)=&result {log_client_error(route,"relay",&c.relay.as_deref().map(host_of).unwrap_or_else(||"none".into()),None,"",None,None,started,e,"");}
    result
}
async fn remote_inner(h:&Companion,c:&Credential,route:&str,body:Value,polls:u32)->Result<Value,String> {
    use sha2::{Digest,Sha256};
    let url=crypto::relay_url(c.relay.as_deref().ok_or("Mac unreachable. Configure a relay in Mac settings for access outside your local network.")?)?;
    let id=crypto::random();let mailbox=hex::encode(Sha256::digest(c.device.mailbox.as_bytes()));
    let base=format!("{url}/v1/mailboxes/{mailbox}");
    let request=json!({"id":id,"route":route,"body":body,"expires":crypto::now()+90,"acceptEncoding":crypto::RESPONSE_ENCODING});
    let envelope=crypto::seal(&c.device.key,&format!("request:{}:{id}",c.device.id),&request)?;
    h.internet.post(format!("{base}/requests/{id}")).bearer_auth(&c.device.mailbox).json(&json!({"id":id,"envelope":envelope})).send().await
        .and_then(|r|r.error_for_status()).map_err(|_|"Relay unavailable. Check your internet connection.")?;
    for _ in 0..polls {
        let response=h.internet.get(format!("{base}/responses/{id}")).bearer_auth(&c.device.mailbox).send().await.map_err(|_|"Connection interrupted. Check the conversation before retrying.")?;
        if response.status()==reqwest::StatusCode::OK {
            let value:Value=response.json().await.map_err(|_|"Invalid relay response")?;
            if value["id"].as_str()!=Some(&id){return Err("Invalid relay response".into());}
            let envelope:Envelope=serde_json::from_value(value["envelope"].clone()).map_err(|_|"Invalid relay response")?;
            let plain=crypto::open(&c.device.key,&format!("response:{}:{id}",c.device.id),&envelope)?;
            return remember_relay(h,c.clone(),&plain).await;
        }
        if response.status()!=reqwest::StatusCode::ACCEPTED {return Err("Relay unavailable".into());}
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err("Your Mac did not respond through the relay in time. The connection may be interrupted. Keep Freddai running on your Mac; reconnection is automatic.".into())
}
async fn call(h:&Companion,route:&str,body:Value)->Result<Value,String> {call_slow(h,route,body,None,40).await}
/// Like `call`, with a longer local-network timeout and more relay polls for operations the Mac takes seconds to answer (dictation).
async fn call_slow(h:&Companion,route:&str,body:Value,local_timeout:Option<Duration>,polls:u32)->Result<Value,String> {
    let c=credential(h)?;
    if route!="/v1/snapshot" && h.relay_active.load(Ordering::Relaxed) {return remote(h,&c,route,body,polls).await;}
    let provision=c.provision.clone().or(legacy_provision()).ok_or("Pair this phone again using Mac setup")?;
    let connection={
        let mut cached=h.connection.lock().map_err(|_|"Mac connection busy")?;
        if cached.as_ref().is_none_or(|c|c.provision!=provision) { *cached=Some(Connection{local:provision.client()?,provision}); }
        cached.as_ref().ok_or("Mac connection unavailable")?.clone()
    };
    let mut request=connection.local.post(format!("{}{route}",connection.provision.endpoint)).bearer_auth(&c.device.key).json(&body);
    if let Some(t)=local_timeout {request=request.timeout(t);}
    let started=Instant::now();
    let host=host_of(&connection.provision.endpoint);
    let limit=local_timeout.map(|t|t.as_secs()).unwrap_or(8);
    let response=request.send().await;
    match response {
        Ok(response)=> {
            let status=response.status().as_u16();
            let ct=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v|v.to_str().ok()).unwrap_or("").to_string();
            let result=match read_json(response,route,&host,started,limit).await {
                Ok(value)=>remember_relay(h,c.clone(),&value).await,
                Err(error)=>Err(error),
            };
            if let Err(error)=&result {
                if crate::client_diag::retry_snapshot_via_relay(route,c.relay.is_some(),error) {
                    log_client_error(route,"direct",&host,Some(status),&ct,None,None,started,&format!("snapshot recovery via relay: {error}"),"");
                    let recovered=remote(h,&c,route,body,polls).await;
                    if recovered.is_ok() {
                        h.relay_active.store(true,Ordering::Relaxed);
                        eprintln!("companion.client.recovered transport=relay op={route} elapsed_ms={}",started.elapsed().as_millis());
                    }
                    return recovered;
                }
            } else {
                h.relay_active.store(false,Ordering::Relaxed);
            }
            result
        },
        Err(error) if error.is_connect() || route=="/v1/snapshot"=> {
            log_client_error(route,"direct",&host,None,"",None,None,started,&format!("falling back to relay: {}",error_chain(&error)),"");
            h.relay_active.store(true,Ordering::Relaxed); remote(h,&c,route,body,polls).await
        },
        Err(error)=>{
            log_client_error(route,"direct",&host,None,"",None,None,started,&error_chain(&error),"");
            Err("Connection interrupted. Check the conversation before retrying your message.".into())
        },
    }
}
#[tauri::command]
async fn companion_snapshot(h:State<'_,Companion>,thread:Option<String>)->Result<Value,String> {
    // A bounded read-only refresh: relay polling must not leave initial sync spinning for minutes.
    tokio::time::timeout(Duration::from_secs(20),call(&h,"/v1/snapshot",json!({"scoped":true,"thread":thread})))
        .await.map_err(|_|"Connection check timed out. Retrying your Mac connection.".to_string())?
}
#[tauri::command]
async fn companion_start(h:State<'_,Companion>,project:String,prompt:String,request_id:String,options:Option<Value>,assistant:Option<String>)->Result<Value,String> {call(&h,"/v1/start",json!({"project":project,"assistant":assistant,"prompt":prompt,"requestId":request_id,"options":options})).await}
#[tauri::command]
async fn companion_reply(h:State<'_,Companion>,thread:String,prompt:String,request_id:String,options:Option<Value>)->Result<Value,String> {call(&h,"/v1/reply",json!({"thread":thread,"prompt":prompt,"requestId":request_id,"options":options})).await}
#[tauri::command]
async fn companion_composer(h:State<'_,Companion>,operation:String,input:Value)->Result<Value,String> {
    crate::companion_operations::validate(&operation)?;
    if operation=="transcribe" {return call_slow(&h,"/v1/composer",json!({"operation":operation,"input":input}),Some(Duration::from_secs(150)),150).await;}
    call(&h,"/v1/composer",json!({"operation":operation,"input":input})).await
}
const UPLOAD_LIMIT:u64=25*1024*1024;
/// Uploads a file the native composer copied into `<tmp>/freddai-attachments`, using the same begin/chunk/finish flow as the web picker.
/// Only the path crosses the WebView bridge; the bytes are read here so large photos never pass through JS.
#[tauri::command]
async fn companion_upload_path(h:State<'_,Companion>,path:String,name:String,mime:Option<String>)->Result<Value,String> {
    let _=mime; // The Mac derives the MIME type from the finished upload.
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    let cache=std::env::temp_dir();
    #[cfg(target_os = "android")]
    let cache={use tauri::Manager; h.app.path().app_cache_dir().map_err(|_|"Cannot locate attachment folder")?};
    let root=std::fs::canonicalize(cache.join("freddai-attachments")).map_err(|_|"Attachment is no longer available. Remove it and attach it again.")?;
    let file=std::fs::canonicalize(&path).map_err(|_|"Attachment is no longer available. Remove it and attach it again.")?;
    if !file.starts_with(&root){return Err("Attachment must come from the Freddai attachment folder.".into());}
    let size=std::fs::metadata(&file).map_err(|_|"Cannot read attachment")?.len();
    if size>UPLOAD_LIMIT{return Err("Each attachment must be 25 MB or smaller".into());}
    let bytes=tokio::fs::read(&file).await.map_err(|_|"Cannot read attachment")?;
    let upload=|input:Value|call(&h,"/v1/composer",json!({"operation":"upload","input":input}));
    let id=upload(json!({"action":"begin","name":name})).await?;
    for (index,chunk) in bytes.chunks(24*1024).enumerate() {
        upload(json!({"action":"chunk","id":id,"offset":index*24*1024,"data":hex::encode(chunk)})).await?;
    }
    upload(json!({"action":"finish","id":id,"size":bytes.len()})).await
}
const DICTATION_LIMIT:u64=10*1024*1024;
/// Uploads a dictation recording from `<tmp>/freddai-attachments` and has the Mac transcribe it. The recording is always deleted afterwards.
/// Same chunk flow as `companion_upload_path`, but ends with `transcribe` instead of `finish`.
#[tauri::command]
async fn companion_transcribe_path(h:State<'_,Companion>,path:String)->Result<Value,String> {
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    let cache=std::env::temp_dir();
    #[cfg(target_os = "android")]
    let cache={use tauri::Manager; h.app.path().app_cache_dir().map_err(|_|"Cannot locate recording folder")?};
    let root=std::fs::canonicalize(cache.join("freddai-attachments")).map_err(|_|"The recording is no longer available.")?;
    let file=std::fs::canonicalize(&path).map_err(|_|"The recording is no longer available.")?;
    if !file.starts_with(&root) || file==root {return Err("Recording must come from the Freddai attachment folder.".into());}
    let result=transcribe_file_upload(&h,&file).await;
    // Remove the recording's own folder (it is created per recording), never the shared root.
    if let Some(dir)=file.parent().filter(|d|*d!=root.as_path()) {let _=std::fs::remove_dir_all(dir);} else {let _=std::fs::remove_file(&file);}
    result
}
async fn transcribe_file_upload(h:&Companion,file:&std::path::Path)->Result<Value,String> {
    let size=std::fs::metadata(file).map_err(|_|"Cannot read the recording")?.len();
    if size==0 {return Err("The recording is empty".into());}
    if size>DICTATION_LIMIT {return Err("The recording is too large (10 MB limit)".into());}
    let bytes=tokio::fs::read(file).await.map_err(|_|"Cannot read the recording")?;
    let name=file.file_name().and_then(|n|n.to_str()).unwrap_or("dictation.m4a");
    let upload=|input:Value|call(h,"/v1/composer",json!({"operation":"upload","input":input}));
    let id=upload(json!({"action":"begin","name":name})).await?;
    for (index,chunk) in bytes.chunks(24*1024).enumerate() {
        upload(json!({"action":"chunk","id":id,"offset":index*24*1024,"data":hex::encode(chunk)})).await?;
    }
    call_slow(h,"/v1/composer",json!({"operation":"transcribe","input":{"id":id,"size":bytes.len()}}),Some(Duration::from_secs(150)),150).await
}
/// Opens a Mac `localhost:<port>` page through the preview tunnel (docs/preview-tunnel.md). Errors are named `preview_*` strings.
#[tauri::command]
async fn preview_open(app:tauri::AppHandle,h:State<'_,Companion>,thread_id:String,url:String)->Result<Value,String> {
    let auth=||{let c=credential(&h)?;Ok(crate::preview_device::TunnelAuth{relay:c.relay.clone(),token:c.device.mailbox.clone(),key:c.device.key.clone()})};
    let rpc=|input:Value|call(&h,"/v1/composer",json!({"operation":"preview_open","input":input}));
    crate::preview_device::open(app,thread_id,url,auth,rpc).await
}
#[tauri::command]
async fn companion_action(h:State<'_,Companion>,thread:String,action:String)->Result<Value,String> {call(&h,"/v1/action",json!({"thread":thread,"action":action})).await}
#[tauri::command]
async fn companion_mark_read(h:State<'_,Companion>,thread:String,at:u64)->Result<Value,String> {call(&h,"/v1/read",json!({"thread":thread,"at":at})).await}
#[tauri::command]
async fn companion_merge_read(h:State<'_,Companion>,cursors:Value)->Result<Value,String> {call(&h,"/v1/read",json!({"cursors":cursors})).await}
#[tauri::command]
async fn companion_respond(h:State<'_,Companion>,thread:String,request_id:String,allow:bool,answers:Value)->Result<Value,String> {call(&h,"/v1/respond",json!({"thread":thread,"requestId":request_id,"allow":allow,"answers":answers})).await}
/// Asks the Mac for its hardware MAC/broadcast details and keeps them (with the credential) for Wake Mac.
#[tauri::command]
async fn companion_wake_refresh(h:State<'_,Companion>)->Result<crate::wake::WakeInfo,String> {
    let info=crate::wake::parse_wake_info(&call(&h,"/v1/wake",json!({})).await?)?;
    let mut c=credential(&h)?;
    if c.wake.as_ref()!=Some(&info){c.wake=Some(info.clone());save(&h,c)?;}
    Ok(info)
}
#[tauri::command]
fn companion_wake_info(h:State<'_,Companion>)->Result<Option<crate::wake::WakeInfo>,String> {Ok(credential(&h)?.wake)}
/// Sends Wake-on-LAN magic packets on the local network. Returns how many datagrams were sent.
#[tauri::command]
fn companion_wake(h:State<'_,Companion>)->Result<usize,String> {
    let info=credential(&h)?.wake.ok_or("No wake details saved for your Mac yet. Connect to it once on its Wi-Fi or Ethernet network.")?;
    crate::wake::send(&info)
}
fn legacy_provision()->Option<Provision> {
    #[cfg(target_os = "ios")]
    { serde_json::from_str(include_str!(concat!(env!("OUT_DIR"),"/companion-provision.json"))).ok() }
    #[cfg(any(target_os = "android", target_os = "macos"))]
    { None }
}
fn saved_provision(h:&Companion)->Result<Option<Provision>,String> {
    Ok(h.credential.lock().map_err(|_|"Device storage busy")?.as_ref().and_then(|c|c.provision.clone()).or(legacy_provision()))
}
pub fn run(context: tauri::Context<tauri::Wry>) {
    let internet=reqwest::Client::builder().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().expect("Cannot create relay client");
    #[cfg(any(target_os = "ios", target_os = "macos"))]
    let (credential,storage_error)=match security_framework::passwords::get_generic_password(SERVICE,"device") {
        Ok(data)=>match serde_json::from_slice(&data){Ok(c)=>(Some(c),None),Err(_)=>(None,Some("Cannot read saved pairing credentials".into()))},
        Err(e) if e.code()==-25300=>(None,None),
        Err(_)=>(None,Some("Unlock your iPhone to read its pairing credentials".into())),
    };
    let builder=tauri::Builder::default().plugin(tauri_plugin_opener::init());
    #[cfg(any(target_os = "ios", target_os = "android"))]
    let builder=builder.plugin(tauri_plugin_native_shell::init());
    #[cfg(target_os = "macos")]
    let builder=builder.plugin(tauri_plugin_updater::Builder::new().build()).plugin(tauri_plugin_notification::init());
    builder.setup(move |app| {
        use tauri::Manager;
        #[cfg(target_os = "android")]
        let (credential,storage_error)=match tauri_plugin_native_shell::read_credential(app.handle()) {
            Ok(Some(data)) => match serde_json::from_str(&data) { Ok(c)=>(Some(c),None), Err(_)=>(None,Some("Cannot read saved pairing credentials".into())) },
            Ok(None)=>(None,None), Err(error)=>(None,Some(error)),
        };
        app.manage(Companion{#[cfg(target_os = "android")] app:app.handle().clone(),internet,connection:Mutex::new(None),credential:Mutex::new(credential),pending:Mutex::new(None),storage_error,relay_active:AtomicBool::new(false)});
        #[cfg(target_os = "macos")]
        {
            let config=app.config().app.windows.first().cloned().ok_or("Missing window configuration")?;
            let window=tauri::WebviewWindowBuilder::from_config(app.handle(), &config)?.build()?;
            window.show()?;
            crate::updater::start(app.handle());
            crate::updater::install_menu(app)?;
        }
        Ok(())
    })
        .invoke_handler(tauri::generate_handler![
            #[cfg(target_os = "macos")] crate::satellite::satellite_mode,
            #[cfg(target_os = "macos")] crate::satellite::satellite_set_mode,
            #[cfg(target_os = "macos")] crate::updater::updater_state,
            #[cfg(target_os = "macos")] crate::updater::check_for_updates,
            #[cfg(target_os = "macos")] crate::updater::install_update,
            #[cfg(target_os = "macos")] crate::updater::restart_app,
            #[cfg(target_os = "macos")] crate::updater::open_release_page,
            platform,companion_wake_refresh,companion_wake_info,companion_wake,companion_pairing_status,companion_pair,companion_pair_claim,companion_snapshot,companion_start,companion_reply,companion_composer,companion_upload_path,companion_transcribe_path,companion_respond,preview_open,companion_action,companion_mark_read,companion_merge_read])
        .run(context).expect("Cannot run mobile companion");
}
