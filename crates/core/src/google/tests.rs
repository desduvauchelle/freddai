use super::oauth::{self, build_auth_url, pkce_challenge, Callback};
use super::store::{self, SecretStore};
use super::test_support::{Response, TestEnv};
use super::*;
use serde_json::json;
use std::{
    collections::HashMap,
    time::Instant,
};

fn token_ok(scope: &str, refresh: bool) -> Response {
    let mut v = json!({"access_token":"access-1","expires_in":3600,"scope":scope,"token_type":"Bearer"});
    if refresh {
        v["refresh_token"] = json!("refresh-1");
    }
    Response::json(200, v)
}

const ALL_SCOPES: &str = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive";

/// Mock that behaves like Google for a sign-in: token + userinfo + revoke.
fn signin_env(scope: &'static str, refresh: bool) -> TestEnv {
    TestEnv::new(move |r| match r.path() {
        "/token" => token_ok(scope, refresh),
        "/userinfo" => Response::json(200, json!({"email":"Dana@Example.com","name":"Dana D"})),
        "/revoke" => Response::text(200, ""),
        _ => Response::text(404, "nope"),
    })
}

fn query_of(url: &str) -> HashMap<String, String> {
    reqwest::Url::parse(url).unwrap().query_pairs().map(|(k, v)| (k.into_owned(), v.into_owned())).collect()
}

/// Play the browser: hit the loopback redirect with `params`.
fn browse(auth_url: &str, params: &[(&str, &str)]) -> (u16, String) {
    let q = query_of(auth_url);
    let mut url = reqwest::Url::parse(&q["redirect_uri"]).unwrap();
    url.query_pairs_mut().extend_pairs(params.iter().copied());
    let resp = reqwest::blocking::get(url).unwrap();
    (resp.status().as_u16(), resp.text().unwrap())
}

fn wait_done(flow: &str) -> FlowState {
    let start = Instant::now();
    loop {
        match oauth::flow_status(flow).unwrap() {
            FlowState::Pending if start.elapsed().as_secs() < 10 => std::thread::sleep(std::time::Duration::from_millis(20)),
            other => return other,
        }
    }
}

fn start(env: &TestEnv, services: Option<Value>) -> (String, String) {
    let p = services.map(|s| json!({"services": s})).unwrap_or(json!({}));
    let v = host_call_with(&env.ctx, "google_connect_start", &p).unwrap();
    (v["authUrl"].as_str().unwrap().to_owned(), v["flowId"].as_str().unwrap().to_owned())
}

// ---------------------------------------------------------------- OAuth

#[test]
fn pkce_challenge_matches_rfc7636_vector() {
    assert_eq!(
        pkce_challenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk"),
        "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"
    );
}

#[test]
fn auth_url_has_expected_params_and_scopes() {
    let url = build_auth_url(&Endpoints::default(), "cid", "http://127.0.0.1:5555", &Service::ALL, "st", "chal").unwrap();
    assert!(url.starts_with("https://accounts.google.com/o/oauth2/v2/auth?"));
    let q = query_of(&url);
    assert_eq!(q["client_id"], "cid");
    assert_eq!(q["redirect_uri"], "http://127.0.0.1:5555");
    assert_eq!(q["response_type"], "code");
    assert_eq!(q["state"], "st");
    assert_eq!(q["code_challenge"], "chal");
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["access_type"], "offline");
    assert_eq!(q["prompt"], "consent");
    assert_eq!(q["include_granted_scopes"], "false");
    assert_eq!(
        q["scope"],
        "openid email profile https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/drive"
    );
    let only = build_auth_url(&Endpoints::default(), "cid", "r", &[Service::Drive], "s", "c").unwrap();
    assert_eq!(query_of(&only)["scope"], "openid email profile https://www.googleapis.com/auth/drive");
}

#[test]
fn callback_classification() {
    assert_eq!(oauth::classify_callback("/?code=abc&state=bad", "good"), Callback::BadState);
    assert_eq!(oauth::classify_callback("/?code=abc", "good"), Callback::BadState);
    assert_eq!(oauth::classify_callback("/favicon.ico", "good"), Callback::Ignore);
    assert_eq!(oauth::classify_callback("/?code=abc&state=good", "good"), Callback::Code("abc".into()));
    match oauth::classify_callback("/?error=access_denied&state=good", "good") {
        Callback::Denied(m) => assert!(m.contains("access_denied")),
        other => panic!("{other:?}"),
    }
}

#[test]
fn connect_requires_client_id() {
    let env = signin_env(ALL_SCOPES, true);
    let err = host_call_with(&env.ctx, "google_connect_start", &json!({})).unwrap_err();
    assert!(err.contains("client ID"), "{err}");
}

#[test]
fn successful_flow_stores_tokens_and_only_granted_services() {
    // User unticked Drive.
    let env = signin_env(
        "openid email https://www.googleapis.com/auth/gmail.modify https://www.googleapis.com/auth/calendar",
        true,
    );
    env.configure();
    let (auth_url, flow) = start(&env, None);
    assert_eq!(host_call_with(&env.ctx, "google_connect_status", &json!({"flowId":flow})).unwrap()["state"], "pending");

    // A request with the wrong state is rejected and does not end the flow.
    let state = query_of(&auth_url)["state"].clone();
    let (status, page) = browse(&auth_url, &[("code", "evil"), ("state", "wrong")]);
    assert_eq!(status, 400, "{page}");
    assert_eq!(oauth::flow_status(&flow), Some(FlowState::Pending));
    assert_eq!(env.server.count("/token"), 0);

    let (status, page) = browse(&auth_url, &[("code", "the-code"), ("state", &state)]);
    assert_eq!(status, 200);
    assert!(page.contains("dana@example.com") && page.contains("close this tab"), "{page}");
    assert_eq!(wait_done(&flow), FlowState::Connected { email: "dana@example.com".into() });

    let token_req = env.server.requests().into_iter().find(|r| r.path() == "/token").unwrap();
    let q = query_of(&auth_url);
    assert_eq!(token_req.form("grant_type").as_deref(), Some("authorization_code"));
    assert_eq!(token_req.form("code").as_deref(), Some("the-code"));
    assert_eq!(token_req.form("client_id").as_deref(), Some("test-client-id"));
    assert_eq!(token_req.form("client_secret").as_deref(), Some("test-client-secret"));
    assert_eq!(token_req.form("redirect_uri").as_deref(), Some(q["redirect_uri"].as_str()));
    assert_eq!(pkce_challenge(&token_req.form("code_verifier").unwrap()), q["code_challenge"]);

    let accounts = host_call_with(&env.ctx, "google_accounts", &json!({})).unwrap();
    let a = &accounts["accounts"][0];
    assert_eq!(a["email"], "dana@example.com");
    assert_eq!(a["name"], "Dana D");
    assert_eq!(a["services"], json!(["gmail", "calendar"]));
    assert_eq!(a["status"], "ok");
    assert!(a["lastError"].is_null());
    assert!(chrono::DateTime::parse_from_rfc3339(a["connectedAt"].as_str().unwrap()).is_ok());
    let tokens = store::load_tokens(env.secrets.as_ref(), "dana@example.com").unwrap().unwrap();
    assert_eq!(tokens.refresh_token, "refresh-1");
    assert_eq!(tokens.access_token.as_deref(), Some("access-1"));
    // Metadata file holds no secrets.
    let raw = std::fs::read_to_string(env.root.0.join("google/accounts.json")).unwrap();
    assert!(!raw.contains("refresh-1") && !raw.contains("access-1"));

    // Connecting the same email again replaces it and resets status.
    store::set_status(&env.root.0, "dana@example.com", AccountStatus::NeedsReauth, Some("x")).unwrap();
    let (auth_url, flow) = start(&env, Some(json!(["gmail"])));
    let state = query_of(&auth_url)["state"].clone();
    browse(&auth_url, &[("code", "c2"), ("state", &state)]);
    assert!(matches!(wait_done(&flow), FlowState::Connected { .. }));
    let accounts = list_accounts(&env.root.0).unwrap();
    assert_eq!(accounts.len(), 1);
    assert_eq!(accounts[0].status, AccountStatus::Ok);
}

#[test]
fn denied_consent_surfaces_error() {
    let env = signin_env(ALL_SCOPES, true);
    env.configure();
    let (auth_url, flow) = start(&env, None);
    let state = query_of(&auth_url)["state"].clone();
    let (status, page) = browse(&auth_url, &[("error", "access_denied"), ("state", &state)]);
    assert_eq!(status, 400);
    assert!(page.contains("denied"), "{page}");
    match wait_done(&flow) {
        FlowState::Failed { error } => assert!(error.contains("denied") && error.contains("access_denied"), "{error}"),
        other => panic!("{other:?}"),
    }
    assert_eq!(env.server.count("/token"), 0);
    let status = host_call_with(&env.ctx, "google_connect_status", &json!({"flowId":flow})).unwrap();
    assert_eq!(status["state"], "failed");
    assert!(status["error"].as_str().unwrap().contains("denied"));
}

#[test]
fn no_refresh_token_or_no_granted_service_fails_clearly() {
    for (scope, refresh, needle) in [
        (ALL_SCOPES, false, "refresh token"),
        ("openid email", true, "No Gmail, Calendar or Drive access"),
    ] {
        let env = signin_env(scope, refresh);
        env.configure();
        let (auth_url, flow) = start(&env, None);
        let state = query_of(&auth_url)["state"].clone();
        let (status, page) = browse(&auth_url, &[("code", "c"), ("state", &state)]);
        assert_eq!(status, 400);
        assert!(page.contains(needle), "{page}");
        match wait_done(&flow) {
            FlowState::Failed { error } => assert!(error.contains(needle), "{error}"),
            other => panic!("{other:?}"),
        }
        assert!(list_accounts(&env.root.0).unwrap().is_empty());
    }
}

#[test]
fn flow_expires_and_releases_port() {
    let mut env = signin_env(ALL_SCOPES, true);
    env.configure();
    env.ctx.flow_timeout = std::time::Duration::from_millis(150);
    let (auth_url, flow) = start(&env, None);
    assert_eq!(wait_done(&flow), FlowState::Expired);
    let port: u16 = query_of(&auth_url)["redirect_uri"].rsplit(':').next().unwrap().parse().unwrap();
    // Do not re-bind the port: other tests allocate ephemeral ports concurrently and may grab the
    // freed one, which made this assertion flaky. Instead prove the flow's listener is gone by
    // probing it: refused = released; if some other test's listener already reuses the port, it
    // must not be the sign-in listener (which answers unknown paths with "Nothing to see here.").
    use std::io::{Read, Write};
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    match std::net::TcpStream::connect_timeout(&addr, std::time::Duration::from_secs(2)) {
        Err(e) if e.kind() == std::io::ErrorKind::ConnectionRefused => {}
        Err(e) => panic!("sign-in port {port} should refuse connections once expired, got: {e}"),
        Ok(mut s) => {
            let _ = s.set_read_timeout(Some(std::time::Duration::from_secs(2)));
            let _ = s.write_all(b"GET /probe HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            let mut reply = String::new();
            let _ = s.read_to_string(&mut reply);
            assert!(
                !reply.contains("Nothing to see here"),
                "expired sign-in flow still has its listener open on port {port}: {reply}"
            );
        }
    }
}

// ---------------------------------------------------------------- client

const API: &str = "/api/thing";

fn api_url(env: &TestEnv) -> String {
    format!("{}{API}", env.server.base)
}

#[test]
fn valid_token_is_used_without_refresh_and_expiring_token_is_refreshed() {
    let env = TestEnv::new(|r| match r.path() {
        "/token" => Response::json(200, json!({"access_token":"new","expires_in":3600})),
        API => Response::json(200, json!({"auth": r.header("authorization")})),
        _ => Response::text(404, ""),
    });
    env.connect("a@x.com", Some("old"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    assert_eq!(c.get_json(&api_url(&env), &[]).unwrap()["auth"], "Bearer old");
    assert_eq!(env.server.count("/token"), 0);

    // Within 60 s of expiry => refresh first.
    env.connect("a@x.com", Some("old"), 30);
    assert_eq!(c.get_json(&api_url(&env), &[]).unwrap()["auth"], "Bearer new");
    assert_eq!(env.server.count("/token"), 1);
    let t = env.server.requests().into_iter().find(|r| r.path() == "/token").unwrap();
    assert_eq!(t.form("grant_type").as_deref(), Some("refresh_token"));
    assert_eq!(t.form("refresh_token").as_deref(), Some("refresh-1"));
    let stored = store::load_tokens(env.secrets.as_ref(), "a@x.com").unwrap().unwrap();
    assert_eq!(stored.access_token.as_deref(), Some("new"));
}

#[test]
fn unauthorized_triggers_exactly_one_refresh_and_retry() {
    let env = TestEnv::new(|r| match r.path() {
        "/token" => Response::json(200, json!({"access_token":"fresh","expires_in":3600})),
        API if r.header("authorization") == Some("Bearer fresh") => Response::json(200, json!({"ok":true})),
        API => Response::json(401, json!({"error":{"code":401,"message":"Invalid Credentials"}})),
        _ => Response::text(404, ""),
    });
    env.connect("a@x.com", Some("stale"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    assert_eq!(c.get_json(&api_url(&env), &[]).unwrap()["ok"], true);
    assert_eq!(env.server.count("/token"), 1);
    assert_eq!(env.server.count(API), 2);

    // A token that stays rejected: one refresh, one retry, then a loud error (no loop).
    let env = TestEnv::new(|r| match r.path() {
        "/token" => Response::json(200, json!({"access_token":"fresh","expires_in":3600})),
        _ => Response::json(401, json!({"error":{"code":401,"message":"Invalid Credentials"}})),
    });
    env.connect("a@x.com", Some("stale"), 3600);
    let err = GoogleClient::with_context(env.ctx.clone(), "a@x.com").get_json(&api_url(&env), &[]).unwrap_err();
    assert!(err.contains("401") && err.contains("Invalid Credentials"), "{err}");
    assert_eq!(env.server.count("/token"), 1);
    assert_eq!(env.server.count(API), 2);
}

#[test]
fn concurrent_requests_refresh_once() {
    let env = TestEnv::new(|r| match r.path() {
        "/token" => Response::json(200, json!({"access_token":"new","expires_in":3600})),
        _ => Response::json(200, json!({})),
    });
    env.connect("a@x.com", Some("old"), 10);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    let url = api_url(&env);
    std::thread::scope(|s| {
        for _ in 0..4 {
            s.spawn(|| c.get_json(&url, &[]).unwrap());
        }
    });
    assert_eq!(env.server.count("/token"), 1);
}

#[test]
fn invalid_grant_marks_needs_reauth() {
    let env = TestEnv::new(|r| match r.path() {
        "/token" => Response::json(400, json!({"error":"invalid_grant","error_description":"Token has been expired or revoked."})),
        _ => Response::json(200, json!({})),
    });
    env.connect("a@x.com", Some("old"), 10);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    let err = c.get_json(&api_url(&env), &[]).unwrap_err();
    assert!(err.contains("a@x.com") && err.contains("Settings → Connected accounts"), "{err}");
    assert!(err.contains("invalid_grant"), "{err}");
    let a = &list_accounts(&env.root.0).unwrap()[0];
    assert_eq!(a.status, AccountStatus::NeedsReauth);
    assert!(a.last_error.as_deref().unwrap().contains("invalid_grant"));
    // Subsequent calls fail fast without hitting the network again.
    let before = env.server.requests().len();
    assert!(c.get_json(&api_url(&env), &[]).unwrap_err().contains("reconnected"));
    assert_eq!(env.server.requests().len(), before);
}

#[test]
fn non_2xx_error_names_status_message_account_and_path() {
    let env = TestEnv::new(|_| {
        Response::json(403, json!({"error":{"code":403,"message":"Rate Limit Exceeded","errors":[{"reason":"rateLimitExceeded"}]}}))
    });
    env.connect("a@x.com", Some("tok"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    let err = c.post_json(&format!("{}{API}?secret=1", env.server.base), &[], json!({"a":1})).unwrap_err();
    for needle in ["403", "Rate Limit Exceeded", "rateLimitExceeded", "a@x.com", API, "POST"] {
        assert!(err.contains(needle), "missing {needle} in {err}");
    }
    assert!(!err.contains("secret=1"), "query strings must not leak into errors: {err}");
}

#[test]
fn bytes_in_and_out() {
    let env = TestEnv::new(|r| {
        if r.method == "GET" {
            Response { status: 200, content_type: "application/octet-stream", body: vec![0, 1, 2, 255], headers: Vec::new() }
        } else {
            Response::json(200, json!({"ct": r.header("content-type"), "len": r.body.len()}))
        }
    });
    env.connect("a@x.com", Some("tok"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    assert_eq!(c.get_bytes(&api_url(&env), &[("alt", "media")]).unwrap(), vec![0, 1, 2, 255]);
    let v = c.send_bytes(HttpMethod::Put, &api_url(&env), &[], "message/rfc822", b"Subject: hi".to_vec()).unwrap();
    assert_eq!(v["ct"], "message/rfc822");
    assert_eq!(v["len"], 11);
    assert_eq!(env.server.requests().last().unwrap().method, "PUT");
}

#[test]
fn request_full_returns_headers_and_status() {
    let env = TestEnv::new(|_| Response::json(200, json!({"ok":1})).with_header("Location", "http://x/session"));
    env.connect("a@x.com", Some("tok"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    let r = c.request_full(HttpMethod::Get, &api_url(&env), &[], Body::None).unwrap();
    assert_eq!(r.status, 200);
    assert_eq!(r.header("LOCATION"), Some("http://x/session"));
    assert_eq!(r.body, br#"{"ok":1}"#);
}

#[test]
fn retry_after_is_carried_on_429_and_503_but_message_is_unchanged() {
    for (status, header, expected) in [(429u16, "17", Some(17u64)), (503, "5", Some(5)), (500, "9", None), (429, "garbage", None)] {
        let env = TestEnv::new(move |_| {
            Response::json(status, json!({"error":{"message":"slow down"}})).with_header("Retry-After", header)
        });
        env.connect("a@x.com", Some("tok"), 3600);
        let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
        let url = api_url(&env);
        let full = c.request_full(HttpMethod::Get, &url, &[], Body::None).unwrap_err();
        assert_eq!((full.status, full.retry_after_secs), (Some(status), expected), "{status} {header}");
        let plain = c.get_json(&url, &[]).unwrap_err();
        assert_eq!(plain, full.message, "plain methods keep the identical message");
        assert!(plain.contains(&format!("HTTP {status} slow down")));
    }
}

#[test]
fn retry_after_parses_seconds_and_http_dates() {
    use crate::google::client::parse_retry_after;
    assert_eq!(parse_retry_after(" 30 "), Some(30));
    assert_eq!(parse_retry_after("Wed, 21 Oct 2015 07:28:00 GMT"), Some(0));
    let future = (chrono::Utc::now() + chrono::Duration::seconds(120)).to_rfc2822();
    let secs = parse_retry_after(&future).unwrap();
    assert!((115..=121).contains(&secs), "{secs}");
    assert_eq!(parse_retry_after("soon"), None);
}

#[test]
fn request_with_accepts_extra_statuses_and_sends_headers() {
    let env = TestEnv::new(|_| Response::text(308, "").with_header("Range", "bytes=0-9"));
    env.connect("a@x.com", Some("tok"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    let url = api_url(&env);
    assert!(c.request_full(HttpMethod::Put, &url, &[], Body::None).is_err());
    let r = c.request_with(HttpMethod::Put, &url, &[], &[("Content-Range", "bytes */10")], &[308], Body::None).unwrap();
    assert_eq!((r.status, r.header("range")), (308, Some("bytes=0-9")));
    assert_eq!(env.server.requests().last().unwrap().header("content-range"), Some("bytes */10"));
}

// ---------------------------------------------------------------- disconnect / accounts / config

#[test]
fn disconnect_removes_everything_even_when_revoke_fails() {
    let env = TestEnv::new(|r| match r.path() {
        "/revoke" => Response::json(500, json!({"error":"server_error"})),
        _ => Response::text(404, ""),
    });
    env.connect("a@x.com", Some("tok"), 3600);
    let out = host_call_with(&env.ctx, "google_disconnect", &json!({"email":"a@x.com"})).unwrap();
    assert_eq!(out["ok"], true);
    assert!(out["revokeError"].as_str().unwrap().contains("500"), "{out}");
    assert_eq!(env.server.count("/revoke"), 1);
    assert!(env.secrets.get("a@x.com").unwrap().is_none());
    assert!(list_accounts(&env.root.0).unwrap().is_empty());
    // Client secret is not an account secret and stays.
    assert!(env.secrets.get(store::CLIENT_SECRET_KEY).unwrap().is_some());
    assert!(host_call_with(&env.ctx, "google_disconnect", &json!({"email":"a@x.com"})).is_err());
}

#[test]
fn disconnect_success_has_no_revoke_error() {
    let env = TestEnv::new(|_| Response::text(200, ""));
    env.connect("a@x.com", Some("tok"), 3600);
    let out = host_call_with(&env.ctx, "google_disconnect", &json!({"email":"A@X.com"})).unwrap();
    assert_eq!(out, json!({"ok":true}));
}

#[test]
fn resolve_account_cases() {
    let env = TestEnv::new(|_| Response::text(200, ""));
    let root = &env.root.0;
    let err = resolve_account(root, None).unwrap_err();
    assert_eq!(err, "No Google account is connected. Connect one in Settings → Connected accounts.");
    assert!(resolve_account(root, Some("a@x.com")).is_err());

    env.connect("a@x.com", None, 3600);
    assert_eq!(resolve_account(root, None).unwrap(), "a@x.com");
    assert_eq!(resolve_account(root, Some("A@X.com")).unwrap(), "a@x.com");
    assert!(resolve_account(root, Some("other@x.com")).unwrap_err().contains("a@x.com"));

    env.connect("b@x.com", None, 3600);
    let err = resolve_account(root, None).unwrap_err();
    assert!(err.contains("a@x.com") && err.contains("b@x.com") && err.contains("`account`"), "{err}");
    assert_eq!(resolve_account(root, Some("b@x.com")).unwrap(), "b@x.com");
}

#[test]
fn config_set_get_round_trip() {
    let env = TestEnv::new(|_| Response::text(200, ""));
    let get = |env: &TestEnv| host_call_with(&env.ctx, "google_config_get", &json!({})).unwrap();
    assert_eq!(get(&env), json!({"clientId":null,"hasClientSecret":false,"secretStorage":"file"}));

    assert!(host_call_with(&env.ctx, "google_config_set", &json!({"clientId":"   "})).is_err());

    let set = host_call_with(&env.ctx, "google_config_set", &json!({"clientId":"  id-1  ","clientSecret":" s3 "})).unwrap();
    assert_eq!(set, json!({"clientId":"id-1","hasClientSecret":true,"secretStorage":"file"}));
    assert_eq!(env.secrets.get(store::CLIENT_SECRET_KEY).unwrap().as_deref(), Some("s3"));

    // Empty secret leaves the stored one untouched.
    let set = host_call_with(&env.ctx, "google_config_set", &json!({"clientId":"id-2","clientSecret":"  "})).unwrap();
    assert_eq!(set["clientId"], "id-2");
    assert_eq!(env.secrets.get(store::CLIENT_SECRET_KEY).unwrap().as_deref(), Some("s3"));
    assert_eq!(get(&env), set);
}

#[test]
fn file_secret_store_is_private_and_round_trips() {
    let root = test_support::TempRoot::new();
    let store = FileSecretStore::new(root.0.join("google/secrets.json"));
    assert_eq!(store.get("a").unwrap(), None);
    store.set("a", "1").unwrap();
    store.set("b", "2").unwrap();
    store.delete("a").unwrap();
    store.delete("missing").unwrap();
    assert_eq!(store.get("a").unwrap(), None);
    assert_eq!(store.get("b").unwrap().as_deref(), Some("2"));
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(root.0.join("google/secrets.json")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
}

// ---------------------------------------------------------------- review fixes

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

fn refused_port_url(path: &str) -> String {
    // Port 1 is never listening: the connection is refused immediately.
    format!("http://127.0.0.1:1{path}")
}

#[test]
fn transport_errors_never_contain_the_full_url_or_query_string() {
    let env = TestEnv::new(|_| Response::json(200, json!({})));
    env.connect("a@x.com", Some("tok"), 3600);
    let c = GoogleClient::with_context(env.ctx.clone(), "a@x.com");
    let err = c.get_json(&refused_port_url("/gmail/v1/users/me/messages"), &[("q", "SECRET-SEARCH-TEXT")]).unwrap_err();
    assert!(err.contains("could not reach Google") && err.contains("/gmail/v1/users/me/messages"), "{err}");
    assert!(!err.contains("SECRET-SEARCH-TEXT") && !err.contains('?'), "{err}");

    // A resumable-session style URL with a secret upload_id already in the string.
    let err = c.get_bytes(&refused_port_url("/upload/drive/v3/files?upload_id=SECRET-UPLOAD-ID"), &[]).unwrap_err();
    assert!(!err.contains("SECRET-UPLOAD-ID"), "{err}");

    // The token refresh path too.
    let mut ctx = env.ctx.clone();
    ctx.endpoints.token = refused_port_url("/token?client_secret=SECRET-IN-QUERY");
    env.connect("b@x.com", Some("old"), 10);
    let err = GoogleClient::with_context(ctx, "b@x.com").get_json(&api_url(&env), &[]).unwrap_err();
    assert!(err.contains("Could not refresh Google access") && !err.contains("SECRET-IN-QUERY"), "{err}");

    // An unparseable URL falls back to a prefix that still stops at the query string.
    assert_eq!(client::url_path("not a url?q=SECRET#frag"), "not a url");
    assert_eq!(client::url_path("http://h/a/b?q=SECRET"), "/a/b");
}

#[test]
fn json_calls_keep_the_short_timeout_and_media_calls_get_the_long_one() {
    let env = TestEnv::new(|r| {
        if r.path() == "/slow" {
            std::thread::sleep(Duration::from_millis(900));
        }
        Response::json(200, json!({"ok": true}))
    });
    env.connect("a@x.com", Some("tok"), 3600);
    let mut ctx = env.ctx.clone();
    ctx.request_timeout = Duration::from_millis(300);
    ctx.media_timeout = Duration::from_secs(10);
    let c = GoogleClient::with_context(ctx, "a@x.com");
    let url = format!("{}/slow", env.server.base);
    let err = c.get_json(&url, &[]).unwrap_err();
    assert!(err.contains("could not reach Google"), "{err}");
    assert_eq!(c.media().get_json(&url, &[]).unwrap()["ok"], true);
    // Defaults: 30 s for JSON, 10 minutes for media.
    assert_eq!((env.ctx.request_timeout, env.ctx.media_timeout), (Duration::from_secs(30), Duration::from_secs(600)));
}

#[test]
fn disconnect_waits_for_the_account_lock() {
    let env = TestEnv::new(|_| Response::text(200, ""));
    env.connect("a@x.com", Some("tok"), 3600);
    let lock = client::account_lock(&env.root.0, "a@x.com");
    let guard = lock.lock().unwrap();
    let done = AtomicBool::new(false);
    std::thread::scope(|s| {
        let h = s.spawn(|| {
            host_call_with(&env.ctx, "google_disconnect", &json!({"email": "A@x.com"})).unwrap();
            done.store(true, Ordering::SeqCst);
        });
        std::thread::sleep(Duration::from_millis(300));
        assert!(!done.load(Ordering::SeqCst), "disconnect must wait for an in-flight refresh to release the lock");
        assert!(store::get_account(&env.root.0, "a@x.com").unwrap().is_some());
        drop(guard);
        h.join().unwrap();
    });
    assert!(store::get_account(&env.root.0, "a@x.com").unwrap().is_none());
    assert!(env.secrets.get("a@x.com").unwrap().is_none());
}

#[test]
fn a_refresh_that_finishes_after_the_account_was_removed_does_not_save_tokens() {
    type Handles = Option<(std::path::PathBuf, Arc<store::MemorySecretStore>)>;
    let root: Arc<Mutex<Handles>> = Arc::default();
    let r = root.clone();
    let env = TestEnv::new(move |req| {
        if req.path() == "/token" {
            // The user's disconnect lands while the refresh request is in flight.
            let guard = r.lock().unwrap();
            let (root, secrets) = guard.as_ref().unwrap();
            store::remove_account(root, "a@x.com").unwrap();
            secrets.delete("a@x.com").unwrap();
            return Response::json(200, json!({"access_token": "new", "refresh_token": "rotated", "expires_in": 3600}));
        }
        Response::json(200, json!({}))
    });
    *root.lock().unwrap() = Some((env.root.0.clone(), env.secrets.clone()));
    env.connect("a@x.com", Some("old"), 10);
    let err = GoogleClient::with_context(env.ctx.clone(), "a@x.com").get_json(&api_url(&env), &[]).unwrap_err();
    assert!(err.contains("disconnected"), "{err}");
    assert!(env.secrets.get("a@x.com").unwrap().is_none(), "tokens must not be resurrected");
    assert!(list_accounts(&env.root.0).unwrap().is_empty());
}

struct DeniedSecrets;
impl SecretStore for DeniedSecrets {
    fn kind(&self) -> &'static str {
        "keychain"
    }
    fn get(&self, name: &str) -> Result<Option<String>, String> {
        Err(format!("Keychain read failed for {name}: user denied access"))
    }
    fn set(&self, _: &str, _: &str) -> Result<(), String> {
        Err("denied".into())
    }
    fn delete(&self, _: &str) -> Result<(), String> {
        Err("denied".into())
    }
}

#[test]
fn config_get_survives_a_denied_keychain_and_reports_secret_error() {
    let root = test_support::TempRoot::new();
    std::fs::create_dir_all(root.0.join("google")).unwrap();
    std::fs::write(root.0.join("google/config.json"), r#"{"clientId":"cid-1"}"#).unwrap();
    let ctx = Context::new(&root.0, Endpoints::default(), Arc::new(DeniedSecrets));
    let v = host_call_with(&ctx, "google_config_get", &json!({})).unwrap();
    assert_eq!(v["clientId"], "cid-1");
    assert_eq!(v["hasClientSecret"], false);
    assert_eq!(v["secretStorage"], "keychain");
    assert!(v["secretError"].as_str().unwrap().contains("user denied access"), "{v}");
    // A healthy store keeps the exact old shape: no secretError key.
    let env = TestEnv::new(|_| Response::text(200, ""));
    assert!(host_call_with(&env.ctx, "google_config_get", &json!({})).unwrap().get("secretError").is_none());
}

fn port_of(auth_url: &str) -> u16 {
    query_of(auth_url)["redirect_uri"].rsplit(':').next().unwrap().parse().unwrap()
}

/// True once nothing answers the sign-in listener's "Nothing to see here." on `port`.
fn sign_in_listener_gone(port: u16) -> bool {
    use std::io::{Read, Write};
    let addr = std::net::SocketAddr::from(([127, 0, 0, 1], port));
    match std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(2)) {
        Err(_) => true,
        Ok(mut s) => {
            let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
            let _ = s.write_all(b"GET /probe HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
            let mut reply = String::new();
            let _ = s.read_to_string(&mut reply);
            !reply.contains("Nothing to see here")
        }
    }
}

#[test]
fn a_stalled_local_connection_cannot_hold_the_sign_in_flow() {
    use std::io::Write;
    let mut env = signin_env(ALL_SCOPES, true);
    env.configure();
    env.ctx.callback_read_budget = Duration::from_millis(300);
    let (auth_url, flow) = start(&env, None);
    let port = port_of(&auth_url);
    // A local client that keeps dripping bytes (resetting any per-read timeout) and never finishes.
    let stop = Arc::new(AtomicBool::new(false));
    let s2 = stop.clone();
    let dripper = std::thread::spawn(move || {
        let mut conn = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        let _ = conn.write_all(b"GET /");
        while !s2.load(Ordering::SeqCst) {
            if conn.write_all(b"a").is_err() {
                break;
            }
            std::thread::sleep(Duration::from_millis(40));
        }
    });
    std::thread::sleep(Duration::from_millis(100)); // let the listener accept the dripper first
    let state = query_of(&auth_url)["state"].clone();
    let started = Instant::now();
    let (status, page) = browse(&auth_url, &[("code", "the-code"), ("state", &state)]);
    let waited = started.elapsed();
    stop.store(true, Ordering::SeqCst);
    dripper.join().unwrap();
    assert_eq!(status, 200, "{page}");
    assert!(waited < Duration::from_secs(3), "the real redirect waited {waited:?} behind a stalled connection");
    assert!(matches!(wait_done(&flow), FlowState::Connected { .. }));
}

#[test]
fn a_new_sign_in_supersedes_the_pending_one_and_releases_its_port() {
    let env = signin_env(ALL_SCOPES, true);
    env.configure();
    let (auth1, flow1) = start(&env, None);
    let port1 = port_of(&auth1);
    let (auth2, flow2) = start(&env, None);
    assert_eq!(oauth::flow_status(&flow1), Some(FlowState::Superseded));
    let status = host_call_with(&env.ctx, "google_connect_status", &json!({"flowId": flow1})).unwrap();
    assert_eq!(status, json!({"state": "expired", "error": "Superseded by a newer sign-in attempt"}));
    assert_eq!(oauth::flow_status(&flow2), Some(FlowState::Pending));
    let t = Instant::now();
    while !sign_in_listener_gone(port1) {
        assert!(t.elapsed() < Duration::from_secs(5), "superseded flow still listens on port {port1}");
        std::thread::sleep(Duration::from_millis(50));
    }
    // The newer flow is unaffected and still completes.
    let state = query_of(&auth2)["state"].clone();
    let (status, page) = browse(&auth2, &[("code", "c"), ("state", &state)]);
    assert_eq!(status, 200, "{page}");
    assert!(matches!(wait_done(&flow2), FlowState::Connected { .. }));
    assert_eq!(oauth::flow_status(&flow1), Some(FlowState::Superseded));
}
