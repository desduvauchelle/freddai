//! Versioned authenticated envelopes. Keys are exchanged only over pinned local TLS.
use aes_gcm::{aead::{Aead, AeadCore, KeyInit, OsRng, Payload}, Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};
#[derive(Clone, Serialize, Deserialize)]
pub struct Envelope { pub nonce: String, pub ciphertext: String }
pub fn random() -> String { let mut bytes=[0u8;32]; rand::rngs::OsRng.fill_bytes(&mut bytes); hex::encode(bytes) }
pub fn now() -> u64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
fn cipher(key: &str) -> Result<Aes256Gcm,String> {
    Aes256Gcm::new_from_slice(&hex::decode(key).map_err(|_|"Invalid device key")?).map_err(|_|"Invalid device key".into())
}
pub fn seal(key:&str, context:&str, value:&Value) -> Result<Envelope,String> {
    let c=cipher(key)?; let nonce=Aes256Gcm::generate_nonce(&mut OsRng);
    let data=serde_json::to_vec(value).map_err(|e|e.to_string())?;
    let encrypted=c.encrypt(&nonce,Payload {msg:&data,aad:context.as_bytes()}).map_err(|_|"Cannot encrypt message")?;
    Ok(Envelope {nonce:hex::encode(nonce),ciphertext:hex::encode(encrypted)})
}
pub fn open(key:&str, context:&str, envelope:&Envelope)->Result<Value,String> {
    if envelope.ciphertext.len()>16*1024*1024 {return Err("Message too large".into());}
    let nonce=hex::decode(&envelope.nonce).map_err(|_|"Invalid envelope")?;
    if nonce.len()!=12 {return Err("Invalid nonce".into());}
    let data=hex::decode(&envelope.ciphertext).map_err(|_|"Invalid envelope")?;
    let data=cipher(key)?.decrypt(Nonce::from_slice(&nonce),Payload{msg:&data,aad:context.as_bytes()}).map_err(|_|"Message authentication failed")?;
    serde_json::from_slice(&data).map_err(|_|"Invalid message".into())
}
pub fn relay_url(value:&str)->Result<String,String> {
    let url=reqwest::Url::parse(value.trim()).map_err(|_|"Enter an HTTPS relay address")?;
    if url.scheme()!="https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() || url.query().is_some() || url.fragment().is_some() || url.path()!="/" {
        return Err("Relay must be an HTTPS origin without a path, credentials, query or fragment".into());
    }
    Ok(url.as_str().trim_end_matches('/').into())
}
#[cfg(test)] mod tests {
    use super::*; use serde_json::json;
    #[test] fn envelopes_authenticate_direction_device_and_content() {
        let k=random();let v=json!({"prompt":"synthetic"});let e=seal(&k,"request:device:1",&v).unwrap();
        assert_eq!(open(&k,"request:device:1",&e).unwrap(),v);
        assert_ne!(e.nonce,seal(&k,"request:device:1",&v).unwrap().nonce);
        assert!(open(&k,"response:device:1",&e).is_err());assert!(open(&random(),"request:device:1",&e).is_err());
        let mut broken=e.clone();broken.ciphertext.replace_range(..2,"ff");
        if broken.ciphertext==e.ciphertext {broken.ciphertext.replace_range(..2,"00");}
        assert!(open(&k,"request:device:1",&broken).is_err());
        assert!(open(&k,"request:device:1",&Envelope{nonce:"00".into(),ciphertext:e.ciphertext}).is_err());
    }
    #[test] fn relay_configuration_requires_https_origin() {
        assert_eq!(relay_url("https://relay.example.com/").unwrap(),"https://relay.example.com");
        for url in ["http://example.com","https://user:pass@example.com","https://example.com/path","https://example.com/?secret=x"] {assert!(relay_url(url).is_err());}
    }
}
