#[cfg(unix)]
mod unix {
    use freddai_core::host::call;
    use serde_json::json;
    use std::{
        io::{BufRead, BufReader, Write},
        os::unix::net::UnixStream,
        path::PathBuf,
        process::{Command, Stdio},
        time::Duration,
    };
    #[test]
    #[ignore]
    fn host_worker() {
        let root = std::env::var_os("FREDDAI_TEST_HOST_ROOT").expect("test host only");
        freddai_core::host::serve(PathBuf::from(root)).unwrap();
    }

    #[test]
    #[ignore]
    fn watchdog_worker() {
        let group = std::env::var("FREDDAI_TEST_GROUP")
            .unwrap()
            .parse()
            .unwrap();
        freddai_core::watchdog::watch(std::io::stdin(), group);
    }
    #[test]
    fn watchdog_reaps_group_when_host_pipe_closes() {
        use std::os::unix::process::CommandExt;
        let mut agent = Command::new("/bin/sleep")
            .arg("30")
            .process_group(0)
            .spawn()
            .unwrap();
        let mut watcher = Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "unix::watchdog_worker"])
            .env("FREDDAI_TEST_GROUP", agent.id().to_string())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        assert!(agent.try_wait().unwrap().is_none());
        drop(watcher.stdin.take());
        assert!(watcher.wait().unwrap().success());
        assert!(!agent.wait().unwrap().success());
    }
    fn spawn(root: &std::path::Path) -> std::process::Child {
        Command::new(std::env::current_exe().unwrap())
            .args(["--ignored", "--exact", "unix::host_worker"])
            .env("FREDDAI_TEST_HOST_ROOT", root)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap()
    }
    fn wait_ready(root: &std::path::Path) {
        for _ in 0..100 {
            if call(root, "hello", json!({})).is_ok() {
                return;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        panic!("host startup timeout")
    }
    #[test]
    fn host_is_single_owner_and_recovers_persisted_state() {
        let root = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        let mut host = spawn(&root);
        wait_ready(&root);
        assert_eq!(
            call(&root, "hello", json!({})).unwrap()["build"].as_str(),
            std::env::current_exe().unwrap().to_str()
        );
        assert_eq!(
            call(&root, "snapshot", json!({})).unwrap()["preferences"]["use_worktree"],
            false
        );
        let folder = root.join("Dropped project");
        std::fs::create_dir_all(&folder).unwrap();
        let imported = call(
            &root,
            "import_project",
            json!({"path":folder,"color":"blue"}),
        )
        .unwrap();
        assert_eq!(imported["name"], "Dropped project");
        assert_eq!(imported["policy"], "inherit");
        assert_eq!(
            call(
                &root,
                "import_project",
                json!({"path":folder,"color":"red"})
            )
            .unwrap()["id"],
            imported["id"]
        );
        assert_eq!(
            call(&root, "snapshot", json!({})).unwrap()["projects"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        call(&root,"save_preferences",json!({"preferences":{"prefer_last":false,"fallback":null,"last":null,"use_worktree":true}})).unwrap();
        let mut socket = UnixStream::connect(root.join("host.sock")).unwrap();
        writeln!(
            socket,
            "{}",
            json!({"version":"wrong","method":"snapshot","params":{}})
        )
        .unwrap();
        let mut line = String::new();
        BufReader::new(socket).read_line(&mut line).unwrap();
        assert!(line.contains("version mismatch"));
        let mut duplicate = spawn(&root);
        assert!(!duplicate.wait().unwrap().success());
        assert!(call(&root, "snapshot", json!({})).is_ok());
        host.kill().unwrap();
        host.wait().unwrap();
        let mut restarted = spawn(&root);
        wait_ready(&root);
        assert_eq!(
            call(&root, "snapshot", json!({})).unwrap()["preferences"]["use_worktree"],
            true
        );
        assert_eq!(
            call(&root, "snapshot", json!({})).unwrap()["projects"][0]["id"],
            imported["id"]
        );
        let forced = call(&root, "upgrade_force", json!({})).unwrap();
        assert_eq!(forced["interrupted"], 0);
        assert!(restarted.wait().unwrap().success());
        std::fs::remove_dir_all(root).unwrap();
    }
}
