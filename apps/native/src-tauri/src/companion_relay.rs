//! Outgoing HTTPS mailbox polling; relay sees only authenticated ciphertext.
use crate::{companion_crypto::{self as crypto, Envelope},companion_pairing as pairing,companion_server};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::HashMap,fs,io::Write,os::unix::fs::OpenOptionsExt,path::{Path,PathBuf},sync::{Arc,Mutex},time::Duration};
fn mailbox(secret:&str)->String {hex::encode(Sha256::digest(secret.as_bytes()))}
fn response_envelope(key:&str,context:&str,value:&Value,compressed:bool)->Result<Envelope,String> {
    crypto::seal_response(key,context,value,compressed).or_else(|_| {
        // Deliver a small authenticated error instead of retrying an impossible upload
        // until the phone times out. A mutation may already have executed.
        crypto::seal(key,context,&json!({"error":"This response is too large for remote access. Update Freddai on both devices, or open this conversation on your Mac. Check the conversation before retrying any action."}))
    })
}
fn accepts_compression(device:&pairing::Device,id:&str,request:&Value)->bool {
    serde_json::from_value::<Envelope>(request["envelope"].clone()).ok()
        .and_then(|e|crypto::open(&device.key,&format!("request:{}:{id}",device.id),&e).ok())
        .is_some_and(|v|v["acceptEncoding"]==crypto::RESPONSE_ENCODING)
}
pub fn start(root:PathBuf,gate:Arc<Mutex<()>>) {
    std::thread::spawn(move || {
        let client=match reqwest::blocking::Client::builder().connect_timeout(Duration::from_secs(5)).timeout(Duration::from_secs(15)).redirect(reqwest::redirect::Policy::none()).build(){Ok(c)=>c,Err(_)=>return};
        let mut cache:HashMap<String,(u64,Value)>=HashMap::new();
        loop {
            cache.retain(|_,(expiry,_)|*expiry>crypto::now());
            let config=pairing::edit(&root,|r|Ok((r.relay.clone(),r.devices.clone())));
            if let Ok((Some(url),devices))=config {
                if crypto::relay_url(&url).is_ok() {for device in devices {
                    let base=format!("{url}/v1/mailboxes/{}",mailbox(&device.mailbox));
                    let batch=client.get(format!("{base}/requests")).bearer_auth(&device.mailbox).send()
                        .and_then(|r|r.error_for_status()).and_then(|r|r.json::<Vec<Value>>());
                    if let Ok(requests)=batch {for request in requests.into_iter().take(16) {
                        let Some(id)=request["id"].as_str().filter(|s|s.len()==64 && hex::decode(s).is_ok()) else {continue};
                        let cache_key=format!("{}:{id}",device.id);
                        let response=if let Some((_,value))=cache.get(&cache_key) {value.clone()} else {
                            let result=process(&root,&gate,&device,id,&request);
                            let plain=match result {Ok(v)=>json!({"result":v,"relay":url}),Err(e)=>json!({"error":e})};
                            let Ok(envelope)=response_envelope(&device.key,&format!("response:{}:{id}",device.id),&plain,accepts_compression(&device,id,&request)) else {continue};
                            let value=json!({"id":id,"envelope":envelope});
                            cache.insert(cache_key,(crypto::now()+120,value.clone()));value
                        };
                        let bytes=response.to_string().len();
                        let delivery=client.post(format!("{base}/responses/{id}")).bearer_auth(&device.mailbox).json(&response).send().and_then(|r|r.error_for_status());
                        if let Err(error)=delivery { eprintln!("companion.relay.delivery_failed response_bytes={bytes} status={:?} timeout={}",error.status().map(|s|s.as_u16()),error.is_timeout()); }
                    }}
                }}
            }
            std::thread::sleep(Duration::from_secs(1));
        }
    });
}
fn process(root:&Path,gate:&Mutex<()>,device:&pairing::Device,id:&str,request:&Value)->Result<Value,String> {
    let envelope:Envelope=serde_json::from_value(request["envelope"].clone()).map_err(|_|"Invalid envelope")?;
    let value=crypto::open(&device.key,&format!("request:{}:{id}",device.id),&envelope)?;
    let expires=value["expires"].as_u64().ok_or("Missing expiry")?;
    if expires<crypto::now() || expires>crypto::now()+120 || value["id"].as_str()!=Some(id) {return Err("Request expired".into());}
    let route=value["route"].as_str().ok_or("Missing route")?;
    if !["/v1/snapshot","/v1/start","/v1/reply","/v1/respond","/v1/action","/v1/composer","/v1/read","/v1/wake"].contains(&route) {return Err("Unknown companion operation".into());}
    let guard=gate.lock().map_err(|_|"Companion busy")?;
    let preview=route=="/v1/composer" && value["body"]["operation"]=="preview_open";
    // Recheck revocation immediately before dispatch, including queued messages.
    if !pairing::edit(root,|r|Ok(r.devices.iter().any(|d|d.id==device.id && d.key==device.key)))? {return Err("Device revoked".into());}
    if route!="/v1/snapshot" {
        // Claim before dispatch: after a crash, never replay a mutation with an uncertain outcome.
        let dir=root.join("companion/relay-receipts");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
        for entry in fs::read_dir(&dir).map_err(|e|e.to_string())?.flatten() {
            if entry.metadata().ok().and_then(|m|m.modified().ok()).and_then(|t|t.elapsed().ok()).is_some_and(|age|age.as_secs()>180) {let _=fs::remove_file(entry.path());}
        }
        let mut receipt=fs::OpenOptions::new().create_new(true).write(true).mode(0o600).open(dir.join(format!("{}-{id}",device.id))).map_err(|_|"Request already received. Check the conversation before retrying.")?;
        receipt.write_all(b"claimed").map_err(|e|e.to_string())?;receipt.sync_all().map_err(|e|e.to_string())?;
    }
    // preview_open dials the relay for up to 10 s: release the global gate first (revocation and receipt are already done).
    if preview {drop(guard);}
    companion_server::dispatch_for_device(root,device,route,value["body"].clone())
}

#[cfg(test)] mod tests {
    use super::*;
    use std::{io::{BufRead,BufReader},os::unix::net::UnixListener};
    fn fixture()->(PathBuf,pairing::Device) {
        let root=std::env::temp_dir().join(format!("fr-relay-{}",&crypto::random()[..8]));
        let device=pairing::Device{id:crypto::random(),name:"Synthetic phone".into(),key:crypto::random(),mailbox:crypto::random(),paired_at:crypto::now()};
        pairing::edit(&root,|r|{r.devices.push(device.clone());Ok(())}).unwrap();(root,device)
    }
    fn request(device:&pairing::Device,id:&str,route:&str,expires:u64)->Value {
        json!({"envelope":crypto::seal(&device.key,&format!("request:{}:{id}",device.id),&json!({"id":id,"route":route,"expires":expires,"body":{}})).unwrap()})
    }
    #[test] fn large_open_conversation_crosses_relay_without_losing_history() {
        let (root,d)=fixture();
        let socket=UnixListener::bind(root.join("host.sock")).unwrap();
        let mut db=freddai_core::runtime::Database::default();
        let messages=json!([{"id":"m","role":"assistant","text":"Synthetic tool output and conversation history. ".repeat(650_000)}]);
        db.sessions.push(serde_json::from_value(json!({"id":"large","project":"p","account":"none","title":"Large thread","status":"done","updated":1,"provider_id":null,"messages":messages})).unwrap());
        let messages=json!(db.sessions[0].messages);
        let host=std::thread::spawn(move || {
            let (mut connection,_)=socket.accept().unwrap();let mut line=String::new();
            BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["method"],"snapshot_since");
            writeln!(connection,"{}",json!({"result":db})).unwrap();
        });
        let id=crypto::random();let context=format!("response:{}:{id}",d.id);
        let plain=json!({"id":id,"route":"/v1/snapshot","expires":crypto::now()+90,"acceptEncoding":"deflate-v1","body":{"scoped":true,"thread":"large"}});
        let request=json!({"envelope":crypto::seal(&d.key,&format!("request:{}:{id}",d.id),&plain).unwrap()});
        let response=json!({"result":process(&root,&Mutex::new(()),&d,&id,&request).unwrap()});
        assert!(accepts_compression(&d,&id,&request));
        let envelope=response_envelope(&d.key,&context,&response,accepts_compression(&d,&id,&request)).unwrap();
        let wire=serde_json::to_vec(&json!({"id":id,"envelope":envelope})).unwrap();
        host.join().unwrap();fs::remove_dir_all(root).unwrap();
        assert!(wire.len()<16*1024*1024,"Relay rejects the {} byte response with HTTP 413",wire.len());
        assert!(crypto::open(&d.key,&context,&envelope).unwrap()["result"]["threads"][0]["messages"]==messages,"Complete normalized conversation must survive transport");
        // Explicit opt-in: all identifiers/keys and payloads above are synthetic.
        // Exercise the deployed mailbox, including its real HTTP body-size limits.
        if let Ok(origin)=std::env::var("FREDDAI_SYNTHETIC_RELAY_URL") {
            let origin=crypto::relay_url(&origin).unwrap();
            let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(20)).build().unwrap();
            let base=format!("{origin}/v1/mailboxes/{}",mailbox(&d.mailbox));
            client.post(format!("{base}/requests/{id}")).bearer_auth(&d.mailbox).json(&json!({"id":id,"envelope":request["envelope"]})).send().unwrap().error_for_status().unwrap();
            client.post(format!("{base}/responses/{id}")).bearer_auth(&d.mailbox).json(&json!({"id":id,"envelope":envelope})).send().unwrap().error_for_status().unwrap();
            let received:Value=client.get(format!("{base}/responses/{id}")).bearer_auth(&d.mailbox).send().unwrap().error_for_status().unwrap().json().unwrap();
            assert_eq!(received["id"],id);
            assert!(crypto::open(&d.key,&context,&serde_json::from_value(received["envelope"].clone()).unwrap()).unwrap()==response,"Public relay must preserve the entire response");
            eprintln!("Public encrypted relay round trip: {} plaintext bytes, {} wire bytes; complete history preserved",response.to_string().len(),wire.len());
        }
    }
    #[test] fn oversized_legacy_result_delivers_an_error_and_capability_cannot_be_forged() {
        let (root,d)=fixture();let id=crypto::random();let context=format!("response:{}:{id}",d.id);
        let mut request=request(&d,&id,"/v1/snapshot",crypto::now()+90);
        request["acceptEncoding"]=json!(crypto::RESPONSE_ENCODING);
        assert!(!accepts_compression(&d,&id,&request),"capability must be inside the authenticated request");
        let value=json!({"result":"x".repeat(9*1024*1024)});
        let envelope=response_envelope(&d.key,&context,&value,false).unwrap();
        assert!(envelope.ciphertext.len()<2048);
        assert!(crypto::open(&d.key,&context,&envelope).unwrap()["error"].as_str().unwrap().contains("Check the conversation"));
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn native_transport_projects_a_synthetic_host_snapshot() {
        let (root,d)=fixture();let socket=UnixListener::bind(root.join("host.sock")).unwrap();
        let host=std::thread::spawn(move || {
            let (mut connection,_)=socket.accept().unwrap();let mut line=String::new();
            BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["method"],"snapshot");
            writeln!(connection,"{}",json!({"result":freddai_core::runtime::Database::default()})).unwrap();
        });
        let id=crypto::random();let v=process(&root,&Mutex::new(()),&d,&id,&request(&d,&id,"/v1/snapshot",crypto::now()+90)).unwrap();
        assert_eq!(v,json!({"projects":[],"threads":[],"schedules":[],"workspaces":[],"productUsage":[],"canReorderProjects":true}));host.join().unwrap();fs::remove_dir_all(root).unwrap();
    }
    #[test] fn scoped_refresh_crosses_host_dispatch_and_encrypted_relay_without_all_histories() {
        let (root,d)=fixture();
        let socket=UnixListener::bind(root.join("host.sock")).unwrap();
        let mut db=freddai_core::runtime::Database::default();
        for n in 0..124 {
            db.sessions.push(serde_json::from_value(json!({"id":format!("s{n}"),"project":"p","account":"none","title":"Synthetic","status":"done","updated":1,"provider_id":null,"messages":[{"id":"m","role":"assistant","text":"history ".repeat(45_000)}],"pending":null,"error":null})).unwrap());
        }
        let expected=json!(db.sessions[73].messages);
        let host=std::thread::spawn(move || {
            for _ in 0..2 {
                let (mut connection,_)=socket.accept().unwrap();let mut line=String::new();
                BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
                assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["method"],"snapshot_since");
                writeln!(connection,"{}",json!({"result":db})).unwrap();
            }
        });
        for selected in [None,Some("s73")] {
            let id=crypto::random();
            let plain=json!({"id":id,"route":"/v1/snapshot","expires":crypto::now()+90,"body":{"scoped":true,"thread":selected}});
            let request=json!({"envelope":crypto::seal(&d.key,&format!("request:{}:{id}",d.id),&plain).unwrap()});
            let result=process(&root,&Mutex::new(()),&d,&id,&request).unwrap();
            let response=json!({"result":result});
            let context=format!("response:{}:{id}",d.id);
            let envelope=crypto::seal(&d.key,&context,&response).unwrap();
            assert!(serde_json::to_vec(&envelope).unwrap().len()<1024*1024);
            let decoded=crypto::open(&d.key,&context,&envelope).unwrap();
            assert_eq!(decoded["result"]["threads"].as_array().unwrap().len(),124);
            assert_eq!(decoded["result"]["threads"][73]["messages"],if selected.is_some(){expected.clone()}else{json!([])});
        }
        host.join().unwrap();fs::remove_dir_all(root).unwrap();
    }
    #[test] fn stale_unknown_revoked_and_replayed_requests_fail_closed() {
        let (root,d)=fixture();let id=crypto::random();let gate=Mutex::new(());
        assert_eq!(process(&root,&gate,&d,&id,&request(&d,&id,"/v1/snapshot",0)).unwrap_err(),"Request expired");
        assert_eq!(process(&root,&gate,&d,&id,&request(&d,&id,"/desktop/shell",crypto::now()+90)).unwrap_err(),"Unknown companion operation");
        let req=request(&d,&id,"/v1/reply",crypto::now()+90);
        // No host exists in this fixture; after an uncertain dispatch, the durable receipt blocks retries.
        assert!(process(&root,&gate,&d,&id,&req).unwrap_err().contains("host is unavailable"));
        assert!(process(&root,&gate,&d,&id,&req).unwrap_err().contains("already received"));
        pairing::control(&root,"revoke",&d.id).unwrap();
        assert_eq!(process(&root,&gate,&d,&id,&request(&d,&id,"/v1/snapshot",crypto::now()+90)).unwrap_err(),"Device revoked");
        fs::remove_dir_all(root).unwrap();
    }
}
