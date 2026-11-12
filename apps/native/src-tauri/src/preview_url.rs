//! Platform-independent loopback preview URL validation.
pub fn parse_localhost_url(url: &str) -> Result<(u16, String), &'static str> {
    const INVALID: &str = "preview_invalid_url";
    let url = url.trim();
    if url.bytes().any(|b| b < 0x21 || b == 0x7f) { return Err(INVALID); }
    let parsed = reqwest::Url::parse(url).map_err(|_| INVALID)?;
    if !matches!(parsed.scheme(), "http" | "https") || !parsed.username().is_empty() || parsed.password().is_some() { return Err(INVALID); }
    if !matches!(parsed.host_str(), Some("localhost" | "127.0.0.1")) { return Err(INVALID); }
    let port = parsed.port().filter(|p| *p != 0).ok_or(INVALID)?;
    let mut path = parsed.path().to_owned();
    if let Some(q) = parsed.query() { path.push('?'); path.push_str(q); }
    Ok((port, path))
}
