//! Public Mac connection information. Never contains device credentials or private keys.
use serde::{Deserialize, Serialize};
#[derive(Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Provision { pub endpoint: String, pub certificate: String }
impl Provision {
    pub fn parse(text: &str) -> Result<Self, String> {
        if text.len() > 16384 { return Err("Mac setup is too long".into()); }
        let value: Self = serde_json::from_str(text.trim()).map_err(|_| "Paste the complete Mac setup from Freddai settings")?;
        let url = reqwest::Url::parse(&value.endpoint).map_err(|_| "Invalid Mac address")?;
        if url.scheme() != "https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
            || url.path() != "/" || url.query().is_some() || url.fragment().is_some() {
            return Err("Mac setup requires an HTTPS address without credentials or a path".into());
        }
        if !value.certificate.starts_with("-----BEGIN CERTIFICATE-----") || value.certificate.contains("PRIVATE KEY") {
            return Err("Mac setup must contain only a public certificate".into());
        }
        reqwest::Certificate::from_pem(value.certificate.as_bytes()).map_err(|_| "Invalid Mac certificate")?;
        Ok(Self { endpoint: value.endpoint.trim_end_matches('/').to_owned(), ..value })
    }
    #[cfg(any(target_os="ios", target_os="android", test))]
    pub fn client(&self) -> Result<reqwest::Client, String> {
        let cert = reqwest::Certificate::from_pem(self.certificate.as_bytes()).map_err(|_| "Invalid Mac certificate")?;
        reqwest::Client::builder().tls_built_in_root_certs(false).add_root_certificate(cert)
            .connect_timeout(std::time::Duration::from_secs(3)).timeout(std::time::Duration::from_secs(8))
            .redirect(reqwest::redirect::Policy::none()).build().map_err(|_| "Cannot create Mac connection".into())
    }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn enrollment_rejects_insecure_or_malformed_setup() {
        for endpoint in ["http://mac.local:49744", "https://user:pass@mac.local", "https://mac.local/path", "https://mac.local?x=1", "https://mac.local/#x"] {
            assert!(Provision::parse(&serde_json::json!({"endpoint":endpoint,"certificate":"-----BEGIN CERTIFICATE-----"}).to_string()).is_err());
        }
        assert!(Provision::parse("{}").is_err());
        assert!(Provision::parse(&"x".repeat(16385)).is_err());
    }
}
