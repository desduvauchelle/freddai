use crate::companion_crypto::{self as crypto, Envelope};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{sync::{Mutex,atomic::{AtomicBool,Ordering}},time::Duration};
use tauri::State;
#[derive(Deserialize)]
struct Provision { endpoint:String,certificate:String }
#[derive(Clone,Serialize,Deserialize)]
struct Device {id:String,key:String,mailbox:String}
#[derive(Clone,Serialize,Deserialize)]
struct Credential {device:Device,relay:Option<String>}
struct Pending {id:String,claim:String}
struct Companion {local:reqwest::Client,internet:reqwest::Client,provision:Provision,credential:Mutex<Option<Credential>>,pending:Mutex<Option<Pending>>,storage_error:Option<String>,relay_active:AtomicBool}
const SERVICE:&str="com.freddai.companion.pairing.v1";
fn save(h:&Companion,c:Credential)->Result<(),String> {
    let data=serde_json::to_vec(&c).map_err(|e|e.to_string())?;
    security_framework::passwords::set_generic_password(SERVICE,"device",&data).map_err(|_|"Cannot save paired device in Keychain")?;
    *h.credential.lock().map_err(|_|"Device storage busy")?=Some(c);Ok(())
}
fn credential(h:&Companion)->Result<Credential,String> {
    if let Some(error)=&h.storage_error{return Err(error.clone());}
    h.credential.lock().map_err(|_|"Device storage busy")?.clone().ok_or_else(||"Pair this iPhone in Freddai settings on your Mac.".into())
}
#[tauri::command] fn platform()->&'static str {"ios"}
#[tauri::command] fn companion_pairing_status(h:State<'_,Companion>)->Result<bool,String> {
    if let Some(error)=&h.storage_error{return Err(error.clone());}
    Ok(h.credential.lock().map_err(|_|"Device storage busy")?.is_some())
}
async fn pairing_call(h:&Companion,route:&str,body:Value)->Result<Value,String> {
    let response=h.local.post(format!("{}{route}",h.provision.endpoint)).json(&body).send().await
        .map_err(|_|"Cannot reach your Mac. Pair while both devices are on the same local network with Freddai open.")?;
    decode(response.json().await.map_err(|_|"Invalid pairing response")?)
}
#[tauri::command]
async fn companion_pair(h:State<'_,Companion>,code:String,name:String)->Result<(),String> {
    if code.len()!=6 || !code.bytes().all(|b|b.is_ascii_digit()){return Err("Enter the six-digit code displayed on your Mac".into());}
    let claim=crypto::random();
    let response=pairing_call(&h,"/v1/pair/request",json!({"code":code,"claim":claim,"name":name})).await?;
    let id=response["id"].as_str().ok_or("Invalid pairing request")?.to_string();
    *h.pending.lock().map_err(|_|"Pairing busy")?=Some(Pending{id,claim});Ok(())
}
#[tauri::command]
async fn companion_pair_claim(h:State<'_,Companion>)->Result<bool,String> {
    let body={let p=h.pending.lock().map_err(|_|"Pairing busy")?;let p=p.as_ref().ok_or("Enter a new code from your Mac")?;json!({"id":p.id,"claim":p.claim})};
    let result=pairing_call(&h,"/v1/pair/claim",body).await?;
    if result["waiting"]==true{return Ok(false);}
    let c:Credential=serde_json::from_value(result).map_err(|_|"Invalid pairing credentials")?;
    if c.device.key.len()!=64 || c.device.mailbox.len()!=64 || c.device.id.len()!=64 {return Err("Invalid pairing credentials".into());}
    if let Some(url)=&c.relay {crypto::relay_url(url)?;}
    save(&h,c)?;*h.pending.lock().map_err(|_|"Pairing busy")?=None;Ok(true)
}
fn decode(value:Value)->Result<Value,String> {
    if let Some(error)=value["error"].as_str(){return Err(error.into());}
    value.get("result").cloned().ok_or_else(||"Invalid response from your Mac".into())
}
async fn remember_relay(h:&Companion,mut c:Credential,value:&Value)->Result<Value,String> {
    if value.get("relay").is_some() {
        let relay=value["relay"].as_str().map(crypto::relay_url).transpose()?;
        if c.relay!=relay {c.relay=relay;save(h,c)?;}
    }
    decode(value.clone())
}
async fn remote(h:&Companion,c:&Credential,route:&str,body:Value)->Result<Value,String> {
    use sha2::{Digest,Sha256};
    let url=crypto::relay_url(c.relay.as_deref().ok_or("Mac unreachable. Configure a relay in Mac settings for access outside your local network.")?)?;
    let id=crypto::random();let mailbox=hex::encode(Sha256::digest(c.device.mailbox.as_bytes()));
    let base=format!("{url}/v1/mailboxes/{mailbox}");
    let request=json!({"id":id,"route":route,"body":body,"expires":crypto::now()+90});
    let envelope=crypto::seal(&c.device.key,&format!("request:{}:{id}",c.device.id),&request)?;
    h.internet.post(format!("{base}/requests/{id}")).bearer_auth(&c.device.mailbox).json(&json!({"id":id,"envelope":envelope})).send().await
        .and_then(|r|r.error_for_status()).map_err(|_|"Relay unavailable. Check your internet connection.")?;
    for _ in 0..40 {
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
    Err("Your Mac is offline or the device was revoked. Keep the Mac awake with Freddai running. Check the conversation before retrying a message.".into())
}
async fn call(h:&Companion,route:&str,body:Value)->Result<Value,String> {
    let c=credential(h)?;
    if route!="/v1/snapshot" && h.relay_active.load(Ordering::Relaxed) {return remote(h,&c,route,body).await;}
    let response=h.local.post(format!("{}{route}",h.provision.endpoint)).bearer_auth(&c.device.key).json(&body).send().await;
    match response {
        Ok(response)=> { h.relay_active.store(false,Ordering::Relaxed); remember_relay(h,c,&response.json::<Value>().await.map_err(|_|"Invalid response from your Mac")?).await },
        Err(error) if error.is_connect() || route=="/v1/snapshot"=> { h.relay_active.store(true,Ordering::Relaxed); remote(h,&c,route,body).await },
        Err(_)=>Err("Connection interrupted. Check the conversation before retrying your message.".into()),
    }
}
#[tauri::command]
async fn companion_snapshot(h:State<'_,Companion>)->Result<Value,String> {call(&h,"/v1/snapshot",json!({})).await}
#[tauri::command]
async fn companion_start(h:State<'_,Companion>,project:String,prompt:String,request_id:String,options:Option<Value>,assistant:Option<String>)->Result<Value,String> {call(&h,"/v1/start",json!({"project":project,"assistant":assistant,"prompt":prompt,"requestId":request_id,"options":options})).await}
#[tauri::command]
async fn companion_reply(h:State<'_,Companion>,thread:String,prompt:String,request_id:String,options:Option<Value>)->Result<Value,String> {call(&h,"/v1/reply",json!({"thread":thread,"prompt":prompt,"requestId":request_id,"options":options})).await}
#[tauri::command]
async fn companion_composer(h:State<'_,Companion>,operation:String,input:Value)->Result<Value,String> {
    if !["models","queue","upload"].contains(&operation.as_str()) { return Err("Unknown composer operation".into()); }
    call(&h,"/v1/composer",json!({"operation":operation,"input":input})).await
}
#[tauri::command]
async fn companion_action(h:State<'_,Companion>,thread:String,action:String)->Result<Value,String> {call(&h,"/v1/action",json!({"thread":thread,"action":action})).await}
#[tauri::command]
async fn companion_mark_read(h:State<'_,Companion>,thread:String,at:u64)->Result<Value,String> {call(&h,"/v1/read",json!({"thread":thread,"at":at})).await}
#[tauri::command]
async fn companion_merge_read(h:State<'_,Companion>,cursors:Value)->Result<Value,String> {call(&h,"/v1/read",json!({"cursors":cursors})).await}
#[tauri::command]
async fn companion_respond(h:State<'_,Companion>,thread:String,request_id:String,allow:bool,answers:Value)->Result<Value,String> {call(&h,"/v1/respond",json!({"thread":thread,"requestId":request_id,"allow":allow,"answers":answers})).await}
pub fn run() {
    let provision:Provision=serde_json::from_str(include_str!(concat!(env!("OUT_DIR"),"/companion-provision.json"))).expect("Missing Mac trust configuration");
    let cert=reqwest::Certificate::from_pem(provision.certificate.as_bytes()).expect("Invalid Mac certificate");
    let local=reqwest::Client::builder().tls_built_in_root_certs(false).add_root_certificate(cert).connect_timeout(Duration::from_secs(3)).timeout(Duration::from_secs(8)).redirect(reqwest::redirect::Policy::none()).build().expect("Cannot create local client");
    let internet=reqwest::Client::builder().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build().expect("Cannot create relay client");
    let (credential,storage_error)=match security_framework::passwords::get_generic_password(SERVICE,"device") {
        Ok(data)=>match serde_json::from_slice(&data){Ok(c)=>(Some(c),None),Err(_)=>(None,Some("Cannot read saved pairing credentials".into()))},
        Err(e) if e.code()==-25300=>(None,None),
        Err(_)=>(None,Some("Unlock your iPhone to read its pairing credentials".into())),
    };
    tauri::Builder::default().plugin(tauri_plugin_native_shell::init()).manage(Companion{local,internet,provision,credential:Mutex::new(credential),pending:Mutex::new(None),storage_error,relay_active:AtomicBool::new(false)})
        .invoke_handler(tauri::generate_handler![platform,companion_pairing_status,companion_pair,companion_pair_claim,companion_snapshot,companion_start,companion_reply,companion_composer,companion_respond,companion_action,companion_mark_read,companion_merge_read])
        .run(tauri::generate_context!()).expect("Cannot run iPhone companion");
}
