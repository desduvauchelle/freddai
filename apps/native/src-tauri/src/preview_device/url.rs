//! Preview URL validation (no Tauri dependency).
/// Parses `http(s)://localhost|127.0.0.1:<port>[path][?query]` into `(port, path)`.
pub fn parse_url(url: &str) -> Result<(u16, String), &'static str> {
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

#[cfg(test)]
mod tests {
    use super::parse_url;
    #[test]
    fn accepts_loopback_urls() {
        assert_eq!(parse_url("http://localhost:3000"), Ok((3000, "/".into())));
        assert_eq!(parse_url("http://127.0.0.1:5173/app/x?a=1&b=2"), Ok((5173, "/app/x?a=1&b=2".into())));
        assert_eq!(parse_url("https://localhost:8443/p#frag"), Ok((8443, "/p".into())));
        assert_eq!(parse_url("  HTTP://LOCALHOST:3000/A "), Ok((3000, "/A".into())));
        assert_eq!(parse_url("http://localhost:3000?x=1"), Ok((3000, "/?x=1".into())));
    }
    #[test]
    fn rejects_everything_else() {
        for bad in ["", "localhost:3000", "ftp://localhost:3000", "http://localhost", "http://localhost:0", "http://example.com:3000", "http://192.168.1.2:3000",
            "http://user@localhost:3000", "http://localhost:3000@evil.com", "http://mylocalhost:3000", "http://localhost:99999", "http://[::1]:3000", "http://localhost:3000/a b", "javascript:alert(1)", "http://0.0.0.0:3000"] {
            assert_eq!(parse_url(bad), Err("preview_invalid_url"), "{bad:?}");
        }
    }
}
