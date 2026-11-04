//! Private, locked device registry shared by the GUI and detached listener.
use crate::companion_crypto::{random, now, relay_url};
use fs2::FileExt;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{fs, io::Write, os::unix::fs::{OpenOptionsExt, PermissionsExt}, path::Path};
use subtle::ConstantTimeEq;
#[derive(Clone, Serialize, Deserialize)]
pub struct Device {pub id:String,pub name:String,pub key:String,pub mailbox:String,pub paired_at:u64}
#[derive(Default, Serialize, Deserialize)]
struct Pairing {code:String,expires:u64,attempts:u8,pending:Option<Pending>}
#[derive(Serialize, Deserialize)]
struct Pending {id:String,name:String,claim:String,approved:Option<Device>}
#[derive(Default, Serialize, Deserialize)]
pub struct Registry {pub devices:Vec<Device>,pub relay:Option<String>,pairing:Option<Pairing>}
pub fn edit<T>(root:&Path,f:impl FnOnce(&mut Registry)->Result<T,String>)->Result<T,String> {
    let dir=root.join("companion");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    fs::set_permissions(&dir,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;
    let lock=fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).mode(0o600).open(dir.join("devices.lock")).map_err(|e|e.to_string())?;
    lock.lock_exclusive().map_err(|e|e.to_string())?;
    let path=dir.join("devices.json");
    let mut registry:Registry=match fs::read(&path) {Ok(v)=>serde_json::from_slice(&v).map_err(|_|"Cannot read paired devices")?,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>Registry::default(),Err(e)=>return Err(e.to_string())};
    // Persist failed-attempt counts even when the operation returns an error.
    let result=f(&mut registry);
    let temp=dir.join(format!("devices-{}.tmp",random()));
    let mut file=fs::OpenOptions::new().create_new(true).write(true).mode(0o600).open(&temp).map_err(|e|e.to_string())?;
    file.write_all(&serde_json::to_vec(&registry).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
    file.sync_all().map_err(|e|e.to_string())?;fs::rename(temp,path).map_err(|e|e.to_string())?;
    result
}
/// Provision on explicit Pair phone action, keeping existing Mac identities intact.
pub fn provision(root:&Path)->Result<(),String> {
    use std::process::Command;
    let dir=root.join("companion");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
    fs::set_permissions(&dir,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;
    let lock=fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).mode(0o600).open(dir.join("provision.lock")).map_err(|e|e.to_string())?;
    lock.lock_exclusive().map_err(|e|e.to_string())?;
    let host=Command::new("/usr/sbin/scutil").args(["--get","LocalHostName"]).output().map_err(|_|"Cannot read Mac network name")?;
    if !host.status.success(){return Err("Set your Mac’s local hostname in System Settings → Sharing".into());}
    let host=String::from_utf8_lossy(&host.stdout).trim().to_owned();
    if host.is_empty() || !host.bytes().all(|b|b.is_ascii_alphanumeric() || b==b'-') {return Err("Invalid Mac network name".into());}
    let host=format!("{host}.local");
    if !dir.join("server.crt").exists() {
        if dir.join("ca.key").exists() || dir.join("server.key").exists() {return Err("Incomplete Mac identity. Restore your companion identity before pairing.".into());}
        let stage=dir.join(format!("identity-{}",random()));fs::create_dir(&stage).map_err(|e|e.to_string())?;
        fs::set_permissions(&stage,fs::Permissions::from_mode(0o700)).map_err(|e|e.to_string())?;
        let result=(||->Result<(),String>{
            fs::write(stage.join("ca.cnf"),"[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=Freddai Companion Private CA\n[ext]\nbasicConstraints=critical,CA:TRUE\nkeyUsage=critical,keyCertSign,cRLSign\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid:always\n").map_err(|e|e.to_string())?;
            fs::write(stage.join("openssl.cnf"),format!("[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN={host}\n[ext]\nsubjectAltName=DNS:{host}\nbasicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectKeyIdentifier=hash\nauthorityKeyIdentifier=keyid,issuer\n")).map_err(|e|e.to_string())?;
            for args in [
                vec!["req","-x509","-newkey","rsa:2048","-nodes","-days","3650","-config","ca.cnf","-keyout","ca.key","-out","ca.crt"],
                vec!["req","-new","-newkey","rsa:2048","-nodes","-config","openssl.cnf","-keyout","server.key","-out","server.csr"],
                vec!["x509","-req","-in","server.csr","-CA","ca.crt","-CAkey","ca.key","-CAcreateserial","-days","365","-extfile","openssl.cnf","-extensions","ext","-out","server.crt"],
            ] {
                let out=Command::new("/usr/bin/openssl").args(args).current_dir(&stage).output().map_err(|_|"Cannot generate Mac connection certificate")?;
                if !out.status.success(){return Err("Cannot generate Mac connection certificate".into());}
            }
            let ca=fs::read(stage.join("ca.crt")).map_err(|e|e.to_string())?;
            fs::OpenOptions::new().append(true).open(stage.join("server.crt")).and_then(|mut f|f.write_all(&ca)).map_err(|e|e.to_string())?;
            for name in ["ca.key","server.key"] {fs::set_permissions(stage.join(name),fs::Permissions::from_mode(0o600)).map_err(|e|e.to_string())?;}
            for name in ["ca.cnf","openssl.cnf","ca.key","ca.crt","server.key","server.crt"] {fs::rename(stage.join(name),dir.join(name)).map_err(|e|e.to_string())?;}
            Ok(())
        })();
        let _=fs::remove_dir_all(stage);result?;
    }
    let certificate=fs::read_to_string(dir.join("ca.crt")).map_err(|_|"Cannot read Mac public certificate")?;
    // Reuse the original endpoint for existing identities; a renamed Mac needs certificate renewal.
    let path=dir.join("iphone-provision.json");
    if !path.exists() {
        let value=json!({"endpoint":format!("https://{host}:49744"),"certificate":certificate});
        let mut file=fs::OpenOptions::new().create_new(true).write(true).mode(0o600).open(path).map_err(|e|e.to_string())?;
        file.write_all(value.to_string().as_bytes()).map_err(|e|e.to_string())?;
    }
    Ok(())
}
pub fn status(root:&Path)->Result<Value,String> {edit(root,|r| {
    let pairing=r.pairing.as_ref().filter(|p|p.expires>now());
    Ok(json!({"setup":if pairing.is_some(){fs::read_to_string(root.join("companion/iphone-provision.json")).ok().and_then(|text|crate::companion_enrollment::Provision::parse(&text).ok()).and_then(|p|serde_json::to_string(&p).ok())}else{None},"code":pairing.map(|p|p.code.as_str()),"expires":pairing.map(|p|p.expires),
        "pending":pairing.and_then(|p|p.pending.as_ref()).filter(|p|p.approved.is_none()).map(|p|json!({"id":p.id,"name":p.name})),
        "devices":r.devices.iter().map(|d|json!({"id":d.id,"name":d.name,"pairedAt":d.paired_at})).collect::<Vec<_>>(),"relay":r.relay}))
})}
pub fn control(root:&Path,action:&str,id:&str)->Result<Value,String> {
    edit(root,|r| {
        match action {
            "begin"=>r.pairing=Some(Pairing {code:format!("{:06}",rand::rngs::OsRng.gen_range(0..1_000_000)),expires:now()+180,attempts:0,pending:None}),
            "cancel"=>r.pairing=None,
            "approve"=> {
                let p=r.pairing.as_mut().filter(|p|p.expires>now()).ok_or("Pairing expired")?;
                let pending=p.pending.as_mut().filter(|p|p.id==id && p.approved.is_none()).ok_or("Pairing request unavailable")?;
                if r.devices.len()>=16 {return Err("Revoke a device before adding another".into());}
                let device=Device {id:pending.id.clone(),name:pending.name.clone(),key:random(),mailbox:random(),paired_at:now()};
                r.devices.push(device.clone());pending.approved=Some(device);
                p.expires=now()+60;
            },
            "revoke"=> {r.devices.retain(|d|d.id!=id);if r.pairing.as_ref().and_then(|p|p.pending.as_ref()).is_some_and(|p|p.id==id){r.pairing=None;}},
            "relay"=> {r.relay=if id.trim().is_empty(){None}else{Some(relay_url(id)?)};},
            _=>return Err("Unknown device action".into()),
        }
        Ok(())
    })?;
    status(root)
}
pub fn request(root:&Path,value:&Value)->Result<Value,String> {edit(root,|r| {
    let p=r.pairing.as_mut().filter(|p|p.expires>now() && p.attempts<5 && p.pending.is_none()).ok_or("Pairing unavailable. Display a new code on your Mac.")?;
    let code=value["code"].as_str().unwrap_or("");
    p.attempts+=1;
    if code.len()!=6 || !bool::from(code.as_bytes().ct_eq(p.code.as_bytes())) {return Err("Incorrect or expired code".into());}
    let claim=value["claim"].as_str().filter(|s|s.len()==64 && hex::decode(s).is_ok()).ok_or("Invalid pairing request")?;
    let name=value["name"].as_str().unwrap_or("iPhone").trim();
    if name.is_empty() || name.len()>80 || name.chars().any(char::is_control) {return Err("Invalid device name".into());}
    let id=random();p.pending=Some(Pending{id:id.clone(),name:name.into(),claim:claim.into(),approved:None});
    Ok(json!({"id":id,"waiting":true}))
})}
pub fn claim(root:&Path,value:&Value)->Result<Value,String> {edit(root,|r| {
    let p=r.pairing.as_ref().filter(|p|p.expires>now()).ok_or("Pairing expired")?;
    let pending=p.pending.as_ref().ok_or("Pairing unavailable")?;
    let claim=value["claim"].as_str().unwrap_or("");
    if value["id"].as_str()!=Some(&pending.id) || claim.len()!=pending.claim.len() || !bool::from(claim.as_bytes().ct_eq(pending.claim.as_bytes())) {return Err("Pairing unavailable".into());}
    let Some(device)=pending.approved.as_ref() else {return Ok(json!({"waiting":true}));};
    let result=json!({"device":device,"relay":r.relay});r.pairing=None;
    Ok(result)
})}
pub fn device(root:&Path,authorization:&str)->Result<Option<Device>,String> {edit(root,|r|Ok(r.devices.iter().find(|d|{
    let expected=format!("Bearer {}",d.key);authorization.len()==expected.len() && bool::from(authorization.as_bytes().ct_eq(expected.as_bytes()))
}).cloned()))}
#[cfg(test)] mod tests {
    use super::*;
    fn root()->std::path::PathBuf { std::env::temp_dir().join(format!("freddai-pair-test-{}",random())) }
    #[test] fn pairing_requires_code_approval_and_private_claim_and_can_be_revoked() {
        let root=root();let s=control(&root,"begin","").unwrap();let secret=random();
        let req=request(&root,&json!({"code":s["code"],"claim":secret,"name":"Test phone"})).unwrap();
        let claim_body=json!({"id":req["id"],"claim":secret});
        assert_eq!(claim(&root,&claim_body).unwrap()["waiting"],true);
        assert!(claim(&root,&json!({"id":req["id"],"claim":random()})).is_err());
        control(&root,"approve",req["id"].as_str().unwrap()).unwrap();
        assert!(request(&root,&json!({"code":s["code"],"claim":random()})).is_err());
        let grant=claim(&root,&claim_body).unwrap();assert!(claim(&root,&claim_body).is_err());
        let key=grant["device"]["key"].as_str().unwrap();assert!(device(&root,&format!("Bearer {key}")).unwrap().is_some());
        let status=status(&root).unwrap().to_string();assert!(!status.contains(key));
        control(&root,"revoke",req["id"].as_str().unwrap()).unwrap();assert!(device(&root,&format!("Bearer {key}")).unwrap().is_none());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn fresh_mac_setup_contains_only_public_trust_and_preserves_identity() {
        let root=root();provision(&root).unwrap();
        let dir=root.join("companion");
        let key=fs::read(dir.join("server.key")).unwrap();
        provision(&root).unwrap();assert_eq!(key,fs::read(dir.join("server.key")).unwrap());
        assert!(status(&root).unwrap()["setup"].is_null());
        let value=control(&root,"begin","").unwrap();
        let setup=value["setup"].as_str().unwrap();
        assert!(!setup.contains("PRIVATE KEY"));assert!(!setup.contains("mailbox"));
        let parsed=crate::companion_enrollment::Provision::parse(setup).unwrap();
        assert!(parsed.endpoint.starts_with("https://"));parsed.client().unwrap();
        let mut invalid:Value=serde_json::from_str(setup).unwrap();invalid["device"]=json!({"key":"unexpected"});
        assert!(crate::companion_enrollment::Provision::parse(&invalid.to_string()).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test] fn wrong_codes_expiry_and_cancellation_fail_closed() {
        let root=root();control(&root,"begin","").unwrap();
        for _ in 0..5 {assert!(request(&root,&json!({"code":"wrong","claim":random()})).is_err());}
        let code=status(&root).unwrap()["code"].clone();assert!(request(&root,&json!({"code":code,"claim":random()})).is_err());
        control(&root,"begin","").unwrap();edit(&root,|r|{r.pairing.as_mut().unwrap().expires=0;Ok(())}).unwrap();
        assert!(request(&root,&json!({"code":"000000","claim":random()})).is_err());
        control(&root,"cancel","").unwrap();assert!(status(&root).unwrap()["code"].is_null());fs::remove_dir_all(root).unwrap();
    }
}
