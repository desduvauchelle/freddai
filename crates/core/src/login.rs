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
        let mut entries = self.0.lock().unwrap();
        if entries.values().any(|e| e.state.status == "pending") {
            return Err("A sign-in is already open. Complete or cancel it before signing in to another account.".into());
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
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
        entries.insert(
            id.clone(),
            Entry {
                state: LoginState {
                    status: "pending".into(),
                    error: None,
                },
                cancel: false,
            },
        );
        drop(entries);
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
