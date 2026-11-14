use serde::Serialize;
use std::{
    collections::HashMap,
    process::{Command, Stdio},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
#[derive(Clone, Serialize)]
pub struct LoginState {
    pub status: String,
    pub error: Option<String>,
    /// Browser sign-in link printed by the CLI, so it can be opened in a different browser.
    pub url: Option<String>,
}
/// First https URL in a line of CLI output (Codex prints "navigate to this URL to authenticate:" then the link).
pub fn find_url(line: &str) -> Option<String> {
    let i = line.find("https://")?;
    // Strip terminal colour codes that may trail the link.
    let url: String = line[i..].chars().take_while(|c| !c.is_whitespace() && *c != '\u{1b}').collect();
    (url.len() > 12).then_some(url)
}
struct Entry {
    state: LoginState,
    cancel: bool,
}
#[derive(Clone, Default)]
pub struct LoginManager(Arc<Mutex<HashMap<String, Entry>>>);
impl LoginManager {
    pub fn state(&self, id: &str) -> Option<LoginState> {
        self.0.lock().unwrap().get(id).map(|e| e.state.clone())
    }
    pub fn pending(&self, id: &str) -> bool {
        self.state(id).is_some_and(|s| s.status == "pending")
    }
    pub fn cancel(&self, id: &str) {
        if let Some(e) = self.0.lock().unwrap().get_mut(id) {
            e.cancel = true;
        }
    }
    pub fn stop_all(&self) {
        {
            for e in self.0.lock().unwrap().values_mut() {
                e.cancel = true;
            }
        }
        for _ in 0..120 {
            if self
                .0
                .lock()
                .unwrap()
                .values()
                .all(|e| e.state.status != "pending")
            {
                return;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }
    pub fn start(
        &self,
        id: String,
        cmd: Command,
        verify: impl FnOnce() -> Result<bool, String> + Send + 'static,
    ) -> Result<(), String> {
        self.start_bounded(id, cmd, Duration::from_secs(600), verify)
    }
    fn start_bounded(
        &self,
        id: String,
        mut cmd: Command,
        timeout: Duration,
        verify: impl FnOnce() -> Result<bool, String> + Send + 'static,
    ) -> Result<(), String> {
        // Starting again for the same account replaces an abandoned sign-in: kill the old one first.
        if self.pending(&id) {
            self.cancel(&id);
            for _ in 0..50 {
                if !self.pending(&id) { break; }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
        let mut entries = self.0.lock().unwrap();
        if entries.values().any(|e| e.state.status == "pending") {
            return Err("A sign-in is already open. Complete or cancel it before signing in to another account.".into());
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            cmd.process_group(0);
        }
        #[cfg(windows)]
        let (mut child, job) = crate::windows_process::spawn(&mut cmd)
            .map_err(|e| format!("Could not start sign-in: {e}"))?;
        #[cfg(not(windows))]
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("Could not start sign-in: {e}"))?;
        let streams: (Option<Box<dyn std::io::Read + Send>>, Option<Box<dyn std::io::Read + Send>>) = (
            child.stdout.take().map(|s| Box::new(s) as _),
            child.stderr.take().map(|s| Box::new(s) as _),
        );
        entries.insert(
            id.clone(),
            Entry {
                state: LoginState {
                    status: "pending".into(),
                    error: None,
                    url: None,
                },
                cancel: false,
            },
        );
        drop(entries);
        for stream in [streams.0, streams.1].into_iter().flatten() {
            let (manager, id) = (self.clone(), id.clone());
            std::thread::spawn(move || {
                use std::io::BufRead;
                for line in std::io::BufReader::new(stream).lines().map_while(Result::ok) {
                    if let Some(url) = find_url(&line) {
                        if let Some(e) = manager.0.lock().unwrap().get_mut(&id) {
                            if e.state.status == "pending" { e.state.url = Some(url); }
                        }
                    }
                }
            });
        }
        let manager = self.clone();
        std::thread::spawn(move || {
            #[cfg(windows)]
            let _job = job;
            let started = Instant::now();
            let result = loop {
                if manager.0.lock().unwrap().get(&id).is_none_or(|e| e.cancel) {
                    break (
                        "cancelled",
                        Some("Sign-in cancelled. You can try again.".into()),
                    );
                }
                if started.elapsed() > timeout {
                    break (
                        "failed",
                        Some(
                            "Sign-in timed out. Try again and complete the browser sign-in.".into(),
                        ),
                    );
                }
                match child.try_wait() {
                    Ok(Some(exit)) if exit.success() => {
                        break match verify() {
                            Ok(true) => ("ready", None),
                            Ok(false) => (
                                "failed",
                                Some(
                                    "Login finished, but this account is not signed in. Try again."
                                        .into(),
                                ),
                            ),
                            Err(e) => ("failed", Some(format!("Could not verify sign-in: {e}"))),
                        }
                    }
                    Ok(Some(_)) => {
                        break (
                            "failed",
                            Some(
                                "Sign-in did not complete. Try again, or check your browser."
                                    .into(),
                            ),
                        )
                    }
                    Err(e) => break ("failed", Some(format!("Could not monitor sign-in: {e}"))),
                    Ok(None) => std::thread::sleep(Duration::from_millis(100)),
                }
            };
            if !matches!(child.try_wait(), Ok(Some(_))) {
                #[cfg(unix)]
                unsafe {
                    libc::kill(-(child.id() as i32), libc::SIGKILL);
                }
                let _ = child.kill();
            }
            let _ = child.wait();
            let mut entries = manager.0.lock().unwrap();
            if let Some(e) = entries.get_mut(&id) {
                e.state = LoginState {
                    status: result.0.into(),
                    error: result.1,
                    url: None,
                };
            }
        });
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn cmd(script: &str) -> Command {
        #[cfg(not(windows))]
        let mut c = { let mut c = Command::new("/bin/sh"); c.args(["-c", script]); c };
        #[cfg(windows)]
        let mut c = { let mut c = Command::new("powershell.exe"); c.args(["-NoProfile", "-Command", &script.replace("sleep 30", "Start-Sleep -Seconds 30")]); c };
        crate::platform::hide_console(&mut c);
        c
    }
    fn wait(m: &LoginManager) -> LoginState {
        for _ in 0..500 {
            let s = m.state("a").unwrap();
            if s.status != "pending" {
                return s;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("login did not settle")
    }
    #[test]
    fn ready_requires_successful_exit_and_authentication() {
        let m = LoginManager::default();
        m.start("a".into(), cmd("exit 0"), || Ok(true)).unwrap();
        assert_eq!(wait(&m).status, "ready");
        let m = LoginManager::default();
        m.start("a".into(), cmd("exit 0"), || Ok(false)).unwrap();
        assert_eq!(wait(&m).status, "failed");
    }
    #[test]
    fn failed_login_does_not_reuse_old_authentication() {
        let m = LoginManager::default();
        m.start("a".into(), cmd("exit 1"), || {
            panic!("must not verify old credentials after failure")
        })
        .unwrap();
        assert_eq!(wait(&m).status, "failed");
    }
    #[test]
    fn cancel_and_duplicate_login() {
        let m = LoginManager::default();
        m.start("a".into(), cmd("sleep 30"), || Ok(true)).unwrap();
        assert!(m.start("b".into(), cmd("exit 0"), || Ok(true)).is_err());
        m.cancel("a");
        assert_eq!(wait(&m).status, "cancelled");
    }
    #[test]
    fn captures_sign_in_url_and_restart_replaces_pending_login() {
        let m = LoginManager::default();
        m.start("a".into(), cmd("echo 'navigate to this URL:'; echo 'https://auth.example.com/oauth?x=1'; sleep 30"), || Ok(true)).unwrap();
        let mut url = None;
        for _ in 0..500 {
            url = m.state("a").and_then(|s| s.url);
            if url.is_some() { break; }
            std::thread::sleep(Duration::from_millis(20));
        }
        assert_eq!(url.as_deref(), Some("https://auth.example.com/oauth?x=1"));
        // Restarting the same account kills the abandoned login instead of failing.
        m.start("a".into(), cmd("exit 0"), || Ok(true)).unwrap();
        assert_eq!(wait(&m).status, "ready");
    }
    #[test]
    fn login_timeout_is_actionable() {
        let m = LoginManager::default();
        m.start_bounded(
            "a".into(),
            cmd("sleep 30"),
            Duration::from_millis(50),
            || Ok(true),
        )
        .unwrap();
        let s = wait(&m);
        assert_eq!(s.status, "failed");
        assert!(s.error.unwrap().contains("timed out"));
    }
}
