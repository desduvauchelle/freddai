//! Diagnostics for the iPhone companion's HTTP client: pure body classification, redaction and the `companion.client.error` log line.
//! Compiled on every target so the logic is unit-tested on the host.
use serde_json::Value;
use std::time::Instant;
/// Stable prefix of every "the Mac answered but we cannot use it" message; the UI matches on it.
pub const INVALID:&str="Invalid response from your Mac";
pub fn decode(value:Value)->Result<Value,String> {
    if let Some(error)=value["error"].as_str(){return Err(error.into());}
    value.get("result").cloned().ok_or_else(||format!("{INVALID}: missing result"))
}
pub fn host_of(url:&str)->String {
    reqwest::Url::parse(url).ok().and_then(|u|u.host_str().map(|h|match u.port(){Some(p)=>format!("{h}:{p}"),None=>h.to_string()})).unwrap_or_else(||"unknown".into())
}
pub fn error_chain(e:&dyn std::error::Error)->String {
    let mut text=e.to_string();let mut source=e.source();
    while let Some(s)=source {text.push_str(": ");text.push_str(&s.to_string());source=s.source();}
    text
}
/// First 300 characters of a body for diagnostics, with token-like runs (32+ key characters, e.g. device keys) masked.
pub fn redact(body:&str)->String {
    let head:String=body.chars().take(400).collect();
    let mut out=String::new();let mut run=String::new();
    let flush=|run:&mut String,out:&mut String|{if run.chars().count()>=32 {out.push_str("[redacted]");} else {out.push_str(run);} run.clear();};
    for ch in head.chars() {
        if ch.is_ascii_alphanumeric()||"_-+/=.".contains(ch) {run.push(ch);} else {flush(&mut run,&mut out);out.push(ch);}
    }
    flush(&mut run,&mut out);
    out.chars().take(300).collect()
}
#[allow(clippy::too_many_arguments)]
pub fn log_client_error(op:&str,transport:&str,host:&str,status:Option<u16>,content_type:&str,content_length:Option<u64>,bytes:Option<usize>,started:Instant,error:&str,body:&str) {
    eprintln!("companion.client.error op={op} transport={transport} host={host} status={status:?} content_type={content_type:?} content_length={content_length:?} bytes={bytes:?} elapsed_ms={} error={error:?} body={:?}",started.elapsed().as_millis(),redact(body));
}
/// Classifies a fully read response body. Err = (user-facing message, underlying detail). Pure so it can be tested.
pub fn parse_body(status:u16,content_type:&str,declared:Option<u64>,bytes:&[u8])->Result<Value,(String,String)> {
    let ok=(200..300).contains(&status);
    let ct=if content_type.is_empty() {"no content-type"} else {content_type};
    match serde_json::from_slice::<Value>(bytes) {
        Ok(v) if ok || v.get("error").is_some() || v.get("result").is_some() => Ok(v),
        Ok(_)=>Err((format!("{INVALID}: HTTP {status} ({ct})"),"JSON body has neither result nor error".into())),
        Err(e)=>{
            let short=if let Some(d)=declared.filter(|d|*d>bytes.len() as u64) {format!("body cut off ({} of {d} bytes)",bytes.len())}
                else if bytes.is_empty() {if ok {"empty body".to_string()} else {format!("HTTP {status} (empty body)")}}
                else if e.is_eof() {format!("body cut off ({} bytes)",bytes.len())}
                else if !ok {format!("HTTP {status} ({ct})")}
                else {format!("not JSON ({ct})")};
            Err((format!("{INVALID}: {short}"),e.to_string()))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn non_json_body_reports_status_and_content_type() {
        let (msg,_)=parse_body(502,"text/html",Some(15),b"<html>bad gw</html").unwrap_err();
        assert_eq!(msg,"Invalid response from your Mac: HTTP 502 (text/html)");
        let (msg,_)=parse_body(200,"text/html",None,b"<html>").unwrap_err();
        assert_eq!(msg,"Invalid response from your Mac: not JSON (text/html)");
        let (msg,_)=parse_body(200,"",None,b"").unwrap_err();
        assert_eq!(msg,"Invalid response from your Mac: empty body");
    }
    #[test] fn truncated_body_is_reported_as_cut_off() {
        let (msg,_)=parse_body(200,"application/json",Some(100),br#"{"result":{"a""#).unwrap_err();
        assert_eq!(msg,"Invalid response from your Mac: body cut off (14 of 100 bytes)");
        let (msg,_)=parse_body(200,"application/json",None,br#"{"result":{"a":"#).unwrap_err();
        assert!(msg.starts_with("Invalid response from your Mac: body cut off"));
    }
    #[test] fn non_2xx_json_without_result_or_error_reports_status() {
        let (msg,_)=parse_body(503,"application/json",None,br#"{"detail":"x"}"#).unwrap_err();
        assert_eq!(msg,"Invalid response from your Mac: HTTP 503 (application/json)");
        // Server-style error payloads on non-2xx pass through so decode surfaces the server's message.
        let v=parse_body(401,"application/json",None,br#"{"error":"Device is not authorized."}"#).unwrap();
        assert_eq!(decode(v).unwrap_err(),"Device is not authorized.");
    }
    #[test] fn missing_result_is_specific_and_ok_result_decodes() {
        let v=parse_body(200,"application/json",None,br#"{"relay":null}"#).unwrap();
        assert_eq!(decode(v).unwrap_err(),"Invalid response from your Mac: missing result");
        let v=parse_body(200,"application/json",None,br#"{"result":{"x":1}}"#).unwrap();
        assert_eq!(decode(v).unwrap(),json!({"x":1}));
    }
    #[test] fn invalid_response_messages_keep_network_classification_shape() {
        // classifyError (connection-status.ts) treats only these words as auth; none may appear in our new texts.
        let auth=["device revoked","pair this iphone","pairing credentials","no longer paired","certificate","unauthorized","unauthorised","forbidden"];
        for m in ["HTTP 502 (text/html)","response timed out after 8s","body cut off (14 of 100 bytes)","not JSON (text/html)","missing result","empty body"] {
            let m=format!("{INVALID}: {m}").to_lowercase();
            assert!(!auth.iter().any(|a|m.contains(a)),"{m}");
        }
    }
    #[test] fn redact_masks_tokens_and_truncates() {
        let key="a".repeat(64);
        let out=redact(&format!(r#"{{"key":"{key}","n":1}}"#));
        assert!(!out.contains(&key));assert!(out.contains("[redacted]"));
        assert_eq!(redact(&"x y ".repeat(200)).chars().count(),300);
    }
    #[test] fn host_of_drops_path_and_credentials_keeps_port() {
        assert_eq!(host_of("https://192.168.1.5:49744/v1"),"192.168.1.5:49744");
        assert_eq!(host_of("nonsense"),"unknown");
    }
}
