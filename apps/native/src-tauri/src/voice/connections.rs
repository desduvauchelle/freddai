//! Speech provider routing. Secrets never leave the Mac Keychain; companions receive only readiness.
use std::{path::Path, time::Duration};
use serde::{Serialize, Deserialize};
use serde_json::{json, Value};
use base64::{Engine, engine::general_purpose::STANDARD};
const SERVICE: &str = "com.freddai.voice";
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all="camelCase")]
pub struct Connections { pub transcription: String, pub speech: String, pub transcription_model: String, pub speech_model: String, pub voice: String }
impl Default for Connections { fn default() -> Self { Self { transcription:"local".into(), speech:"local".into(), transcription_model:"openai/whisper-1".into(), speech_model:"elevenlabs/eleven-flash-v2.5".into(), voice:"21m00Tcm4TlvDq8ikWAM".into() } } }
pub fn load(root: &Path) -> Result<Connections,String> {
    match std::fs::read(root.join("voice/connections.json")) {
        Ok(b) => serde_json::from_slice(&b).map_err(|e| format!("Cannot read voice connections: {e}")),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => Ok(Connections::default()),
        Err(e) => Err(e.to_string()),
    }
}
fn key(provider: &str) -> Result<Vec<u8>,String> {
    security_framework::passwords::get_generic_password(SERVICE,provider).map_err(|_| format!("Add your {provider} API key in Commander Settings"))
}
fn validate(c: &Connections) -> Result<(),String> {
    for p in [&c.transcription,&c.speech] { if !["local","openrouter","vercel"].contains(&p.as_str()) { return Err("Unknown speech provider".into()); } }
    if c.transcription_model.trim().is_empty() || c.speech_model.trim().is_empty() { return Err("Enter a model ID for transcription and speech".into()); }
    Ok(())
}
pub fn call(root: &Path, operation: &str, input: &Value) -> Result<Value,String> {
    match operation {
        "get" => { let c=load(root)?; Ok(json!({"settings":c,"keys":{"openrouter":key("openrouter").is_ok(),"vercel":key("vercel").is_ok()}})) },
        "save" => {
            let c: Connections=serde_json::from_value(input["settings"].clone()).map_err(|e|e.to_string())?; validate(&c)?;
            if let Some(keys)=input["keys"].as_object() { for (provider,value) in keys {
                if !["openrouter","vercel"].contains(&provider.as_str()) { return Err("Unknown key provider".into()); }
                let value=value.as_str().ok_or("API key must be text")?.trim();
                if !value.is_empty() { security_framework::passwords::set_generic_password(SERVICE,provider,value.as_bytes()).map_err(|_|"Cannot save voice API key in Keychain")?; }
            } }
            std::fs::create_dir_all(root.join("voice")).map_err(|e|e.to_string())?;
            freddai_core::commander::write_atomic(&root.join("voice/connections.json"), &serde_json::to_vec_pretty(&c).map_err(|e|e.to_string())?)?;
            call(root,"get",&json!({}))
        },
        "speak" => {
            let c=load(root)?;
            if c.speech=="local" { return Ok(json!({"local":true})); }
            let text=input["text"].as_str().filter(|s| !s.trim().is_empty()).ok_or("Nothing to speak")?;
            if text.len()>20000 { return Err("Spoken reply is too long".into()); }
            let body=if c.speech=="vercel" {json!({"text":text,"voice":c.voice,"outputFormat":"mp3"})} else {json!({"model":c.speech_model,"input":text,"voice":c.voice,"response_format":"mp3"})};
            let response=request(&c.speech,&c.speech_model,"speech",body)?;
            let audio=if c.speech=="vercel" { response.json::<Value>().map_err(|_|"Invalid speech response")?["audio"].as_str().ok_or("Missing speech audio")?.to_owned() }
            else { STANDARD.encode(response.bytes().map_err(|_|"Cannot read speech audio")?) };
            if audio.len()>16_000_000 { return Err("Speech audio is too large".into()); }
            Ok(json!({"dataUrl":format!("data:audio/mpeg;base64,{audio}")}))
        },
        _=>Err("Unknown voice connection operation".into())
    }
}
fn request(provider: &str, model: &str, modality: &str, body: Value) -> Result<reqwest::blocking::Response,String> {
    let key=String::from_utf8(key(provider)?).map_err(|_|"Invalid API key")?;
    let url=match (provider,modality) {
        ("openrouter","speech")=>"https://openrouter.ai/api/v1/audio/speech",
        ("openrouter",_)=>"https://openrouter.ai/api/v1/audio/transcriptions",
        ("vercel","speech")=>"https://ai-gateway.vercel.sh/v4/ai/speech-model",
        ("vercel",_)=>"https://ai-gateway.vercel.sh/v4/ai/transcription-model",
        _=>return Err("Unknown speech provider".into()),
    };
    let client=reqwest::blocking::Client::builder().timeout(Duration::from_secs(60)).redirect(reqwest::redirect::Policy::none()).build().map_err(|e|e.to_string())?;
    let mut req=client.post(url).bearer_auth(key).json(&body);
    if provider=="vercel" { req=req.header("ai-gateway-auth-method","api-key").header("ai-gateway-protocol-version","0.0.1").header("ai-model-id",model).header(format!("ai-{modality}-model-specification-version"),"4"); }
    let response=req.send().map_err(|_|format!("Cannot reach {provider}. Check your connection and try again."))?;
    if !response.status().is_success() { return Err(format!("{provider} returned HTTP {}. Check your key, model access and credits in Settings.", response.status().as_u16())); }
    Ok(response)
}
pub fn remote_ready(root: &Path) -> Result<Option<String>,String> {
    let c=load(root)?;
    if c.transcription=="local" { return Ok(None); }
    key(&c.transcription)?;
    Ok(Some(c.transcription_model))
}
pub fn transcribe(root: &Path, samples: &[f32]) -> Result<super::Transcript,String> {
    let c=load(root)?;
    let data=STANDARD.encode(wav(samples));
    let body=if c.transcription=="vercel" {json!({"audio":data,"mediaType":"audio/wav"})} else {json!({"model":c.transcription_model,"input_audio":{"data":data,"format":"wav"}})};
    let response=request(&c.transcription,&c.transcription_model,"transcription",body)?.json::<Value>().map_err(|_|"Invalid transcription response")?;
    let text=response["text"].as_str().ok_or("Transcription response has no text")?.trim().to_owned();
    Ok(super::Transcript { text, duration_ms:samples.len() as u64*1000/16000, model:c.transcription_model, segments:vec![] })
}
fn wav(samples: &[f32]) -> Vec<u8> {
    let size=(samples.len()*2) as u32;
    let mut b=Vec::with_capacity(size as usize+44);
    b.extend(b"RIFF"); b.extend((size+36).to_le_bytes()); b.extend(b"WAVEfmt "); b.extend(16u32.to_le_bytes()); b.extend(1u16.to_le_bytes()); b.extend(1u16.to_le_bytes()); b.extend(16000u32.to_le_bytes()); b.extend(32000u32.to_le_bytes()); b.extend(2u16.to_le_bytes()); b.extend(16u16.to_le_bytes()); b.extend(b"data"); b.extend(size.to_le_bytes());
    for s in samples { b.extend(((s.clamp(-1.,1.)*32767.) as i16).to_le_bytes()); } b
}
#[cfg(test)] mod tests { use super::*;
    #[test] fn pcm_wav_has_correct_header_and_clipping() { let b=wav(&[-2.,0.,2.]); assert_eq!(&b[..4],b"RIFF"); assert_eq!(b.len(),50); assert_eq!(i16::from_le_bytes([b[48],b[49]]),32767); }
    #[test] fn defaults_are_local_and_unknown_providers_fail() { let mut c=Connections::default(); assert_eq!(c.transcription,"local"); assert!(validate(&c).is_ok()); c.speech="unknown".into(); assert!(validate(&c).is_err()); }
}
