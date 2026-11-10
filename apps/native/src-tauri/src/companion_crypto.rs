//! Versioned authenticated envelopes. Keys are exchanged only over pinned local TLS.
use aes_gcm::{aead::{Aead, AeadCore, KeyInit, OsRng, Payload}, Aes256Gcm, Nonce};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{Read,Write};
use std::time::{SystemTime, UNIX_EPOCH};
pub const RESPONSE_ENCODING:&str="deflate-v1";
const COMPRESSED_MAGIC:&[u8]=b"FREDDAI-DEFLATE-1\0";
const MAX_PLAINTEXT:usize=64*1024*1024;
// Leave space for the JSON envelope, request ID and authentication tag.
pub const MAX_CIPHERTEXT:usize=16*1024*1024-1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Envelope { pub nonce: String, pub ciphertext: String }
pub fn random() -> String { let mut bytes=[0u8;32]; rand::rngs::OsRng.fill_bytes(&mut bytes); hex::encode(bytes) }
pub fn now() -> u64 {SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()}
pub(crate) fn cipher(key: &str) -> Result<Aes256Gcm,String> {
    Aes256Gcm::new_from_slice(&hex::decode(key).map_err(|_|"Invalid device key")?).map_err(|_|"Invalid device key".into())
}
pub fn seal(key:&str, context:&str, value:&Value) -> Result<Envelope,String> {
    let data=serde_json::to_vec(value).map_err(|e|e.to_string())?;
    seal_bytes(key,context,&data)
}
fn seal_bytes(key:&str,context:&str,data:&[u8])->Result<Envelope,String> {
    let c=cipher(key)?; let nonce=Aes256Gcm::generate_nonce(&mut OsRng);
    let encrypted=c.encrypt(&nonce,Payload {msg:&data,aad:context.as_bytes()}).map_err(|_|"Cannot encrypt message")?;
    Ok(Envelope {nonce:hex::encode(nonce),ciphertext:hex::encode(encrypted)})
}
/// Negotiated by the authenticated requester. Compression occurs before encryption;
/// the relay retains exactly the same opaque envelope and learns no plaintext.
pub fn seal_response(key:&str,context:&str,value:&Value,compressed:bool)->Result<Envelope,String> {
    let data=serde_json::to_vec(value).map_err(|e|e.to_string())?;
    if data.len()>MAX_PLAINTEXT {return Err("Response too large".into());}
    let mut encoded=Vec::new();
    if compressed && data.len()>64*1024 {
        encoded.extend_from_slice(COMPRESSED_MAGIC);
        let mut encoder=flate2::write::DeflateEncoder::new(encoded,flate2::Compression::fast());
        encoder.write_all(&data).map_err(|_|"Cannot compress response")?;
        encoded=encoder.finish().map_err(|_|"Cannot compress response")?;
    }
    let bytes=if !encoded.is_empty() && encoded.len()<data.len() {&encoded[..]} else {&data[..]};
    if (bytes.len()+16)*2>MAX_CIPHERTEXT {return Err("Response too large".into());}
    seal_bytes(key,context,bytes)
}
fn decode_plaintext(data:&[u8],limit:usize)->Result<Value,String> {
    if let Some(compressed)=data.strip_prefix(COMPRESSED_MAGIC) {
        let mut decoder=flate2::read::DeflateDecoder::new(compressed);
        let mut plain=Vec::new();
        decoder.by_ref().take(limit as u64+1).read_to_end(&mut plain).map_err(|_|"Invalid compressed message")?;
        if plain.len()>limit {return Err("Message too large".into());}
        if decoder.total_in()!=compressed.len() as u64 {return Err("Invalid compressed message".into());}
        return serde_json::from_slice(&plain).map_err(|_|"Invalid message".into());
    }
    if data.len()>limit {return Err("Message too large".into());}
    serde_json::from_slice(data).map_err(|_|"Invalid message".into())
}
pub fn open(key:&str, context:&str, envelope:&Envelope)->Result<Value,String> {
    if envelope.ciphertext.len()>16*1024*1024 {return Err("Message too large".into());}
    let nonce=hex::decode(&envelope.nonce).map_err(|_|"Invalid envelope")?;
    if nonce.len()!=12 {return Err("Invalid nonce".into());}
    let data=hex::decode(&envelope.ciphertext).map_err(|_|"Invalid envelope")?;
    let data=cipher(key)?.decrypt(Nonce::from_slice(&nonce),Payload{msg:&data,aad:context.as_bytes()}).map_err(|_|"Message authentication failed")?;
    decode_plaintext(&data,MAX_PLAINTEXT)
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
    #[test] fn compressed_responses_are_negotiated_authenticated_and_bounded() {
        let key=random();let context="response:synthetic:1";
        let value=json!({"result":"synthetic history ".repeat(20_000)});
        let compressed=seal_response(&key,context,&value,true).unwrap();
        let legacy=seal_response(&key,context,&value,false).unwrap();
        assert!(compressed.ciphertext.len()<legacy.ciphertext.len()/10);
        assert_eq!(open(&key,context,&compressed).unwrap(),value);
        assert_eq!(open(&key,context,&legacy).unwrap(),value);
        assert!(open(&key,"response:other:1",&compressed).is_err());
        assert!(open(&random(),context,&compressed).is_err());
        // Legacy readers can still parse an unnegotiated response as plain JSON.
        let nonce=hex::decode(&legacy.nonce).unwrap();
        let plain=cipher(&key).unwrap().decrypt(Nonce::from_slice(&nonce),Payload{msg:&hex::decode(&legacy.ciphertext).unwrap(),aad:context.as_bytes()}).unwrap();
        assert_eq!(serde_json::from_slice::<Value>(&plain).unwrap(),value);
        let mut encoded=COMPRESSED_MAGIC.to_vec();
        let mut writer=flate2::write::DeflateEncoder::new(Vec::new(),flate2::Compression::fast());
        writer.write_all(&serde_json::to_vec(&value).unwrap()).unwrap();
        encoded.extend(writer.finish().unwrap());
        assert_eq!(decode_plaintext(&encoded,1024).unwrap_err(),"Message too large");
        encoded.extend_from_slice(b"trailing garbage");
        assert!(decode_plaintext(&encoded,MAX_PLAINTEXT).is_err());
        assert!(decode_plaintext(COMPRESSED_MAGIC,1024).is_err());
    }
    #[test] fn oversized_legacy_response_fails_before_encrypting_for_transport() {
        let value=json!({"result":"x".repeat(9*1024*1024)});
        assert_eq!(seal_response(&random(),"response:test:1",&value,false).err().unwrap(),"Response too large");
    }
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
