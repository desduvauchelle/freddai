//! Outgoing HTTPS mailbox polling; relay sees only authenticated ciphertext.
use crate::{companion_crypto::{self as crypto, Envelope},companion_pairing as pairing,companion_server};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{collections::HashMap,fs,io::Write,os::unix::fs::OpenOptionsExt,path::{Path,PathBuf},sync::{Arc,Mutex},time::Duration};
fn mailbox(secret:&str)->String {hex::encode(Sha256::digest(secret.as_bytes()))}
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
                            let Ok(envelope)=crypto::seal(&device.key,&format!("response:{}:{id}",device.id),&plain) else {continue};
                            let value=json!({"id":id,"envelope":envelope});
                            cache.insert(cache_key,(crypto::now()+120,value.clone()));value
                        };
                        let _=client.post(format!("{base}/responses/{id}")).bearer_auth(&device.mailbox).json(&response).send();
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
    let _guard=gate.lock().map_err(|_|"Companion busy")?;
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
    companion_server::dispatch(root,route,value["body"].clone())
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
    #[test] fn native_transport_projects_a_synthetic_host_snapshot() {
        let (root,d)=fixture();let socket=UnixListener::bind(root.join("host.sock")).unwrap();
        let host=std::thread::spawn(move || {
            let (mut connection,_)=socket.accept().unwrap();let mut line=String::new();
            BufReader::new(connection.try_clone().unwrap()).read_line(&mut line).unwrap();
            assert_eq!(serde_json::from_str::<Value>(&line).unwrap()["method"],"snapshot");
            writeln!(connection,"{}",json!({"result":freddai_core::runtime::Database::default()})).unwrap();
        });
        let id=crypto::random();let v=process(&root,&Mutex::new(()),&d,&id,&request(&d,&id,"/v1/snapshot",crypto::now()+90)).unwrap();
        assert_eq!(v,json!({"projects":[],"threads":[]}));host.join().unwrap();fs::remove_dir_all(root).unwrap();
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
