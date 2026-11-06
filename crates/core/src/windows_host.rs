//! Local, per-workspace named pipes. No TCP listener; only the creating user and SYSTEM have access.
use super::{dispatch, MAX_HOST_MESSAGE_BYTES, VERSION};
use crate::runtime::Runtime;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{io, path::Path, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::windows::named_pipe::{ClientOptions, NamedPipeServer, ServerOptions},
};
use windows_sys::Win32::{
    Foundation::LocalFree,
    Security::{
        Authorization::ConvertStringSecurityDescriptorToSecurityDescriptorW, SECURITY_ATTRIBUTES,
    },
};

fn runtime() -> io::Result<tokio::runtime::Runtime> {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
}
fn pipe_name(root: &Path) -> io::Result<String> {
    // Canonicalize both endpoints, including Windows' extended-path prefix and case insensitivity.
    let path = std::fs::canonicalize(root)?
        .to_string_lossy()
        .to_lowercase();
    Ok(format!(
        r"\\.\pipe\freddai-{:x}",
        Sha256::digest(path.as_bytes())
    ))
}
fn server(name: &str, first: bool) -> io::Result<NamedPipeServer> {
    // OW is the object's owner. Explicit DACL avoids the default Everyone read permission.
    let sddl: Vec<u16> = "D:P(A;;GA;;;OW)(A;;GA;;;SY)\0".encode_utf16().collect();
    let mut descriptor = std::ptr::null_mut();
    unsafe {
        if ConvertStringSecurityDescriptorToSecurityDescriptorW(
            sddl.as_ptr(),
            1,
            &mut descriptor,
            std::ptr::null_mut(),
        ) == 0
        {
            return Err(io::Error::last_os_error());
        }
        let mut attributes = SECURITY_ATTRIBUTES {
            nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
            lpSecurityDescriptor: descriptor,
            bInheritHandle: 0,
        };
        let result = ServerOptions::new()
            .first_pipe_instance(first)
            .reject_remote_clients(true)
            .create_with_security_attributes_raw(
                name,
                (&mut attributes as *mut SECURITY_ATTRIBUTES).cast(),
            );
        LocalFree(descriptor);
        result
    }
}
pub(super) fn call(root: &Path, method: &str, params: Value) -> Result<Value, String> {
    let name = pipe_name(root).map_err(|e| e.to_string())?;
    runtime().map_err(|e| e.to_string())?.block_on(async {
        let request = async {
            let mut pipe = loop {
                match ClientOptions::new().open(&name) {
                    Ok(pipe) => break pipe,
                    Err(e) if e.raw_os_error() == Some(231) => {
                        tokio::time::sleep(Duration::from_millis(10)).await
                    }
                    Err(_) => {
                        return Err(
                            "Freddai host is unavailable. Reopen the app to recover.".to_string()
                        )
                    }
                }
            };
            pipe.write_all(
                format!(
                    "{}\n",
                    json!({"version":VERSION,"method":method,"params":params})
                )
                .as_bytes(),
            )
            .await
            .map_err(|e| e.to_string())?;
            let mut line = Vec::new();
            BufReader::new(pipe)
                .take(MAX_HOST_MESSAGE_BYTES)
                .read_until(b'\n', &mut line)
                .await
                .map_err(|e| e.to_string())?;
            let reply = super::read_json_line(line.as_slice(), MAX_HOST_MESSAGE_BYTES, method)?;
            if let Some(error) = reply["error"].as_str() {
                return Err(error.into());
            }
            Ok(reply["result"].clone())
        };
        tokio::time::timeout(Duration::from_secs(40), request)
            .await
            .map_err(|_| "Freddai host request timed out".to_string())?
    })
}
pub(super) fn serve(root: &Path, rt: Runtime) -> Result<(), String> {
    let name = pipe_name(root).map_err(|e| e.to_string())?;
    runtime().map_err(|e| e.to_string())?.block_on(async move {
        let mut pending = server(&name, true).map_err(|e| e.to_string())?;
        loop {
            pending.connect().await.map_err(|e| e.to_string())?;
            // Keep one server instance alive at all times so the name cannot be claimed between clients.
            let mut pipe = std::mem::replace(
                &mut pending,
                server(&name, false).map_err(|e| e.to_string())?,
            );
            let rt = rt.clone();
            tokio::spawn(async move {
                let result = async {
                    let mut line = Vec::new();
                    BufReader::new(&mut pipe)
                        .take(MAX_HOST_MESSAGE_BYTES)
                        .read_until(b'\n', &mut line)
                        .await
                        .map_err(|e| e.to_string())?;
                    let req =
                        super::read_json_line(line.as_slice(), MAX_HOST_MESSAGE_BYTES, "request")?;
                    if req["version"] != VERSION {
                        return Err(
                            "Host version mismatch. Restart the background host.".to_string()
                        );
                    }
                    tokio::task::spawn_blocking(move || {
                        dispatch(
                            &rt,
                            req["method"].as_str().unwrap_or(""),
                            req["params"].clone(),
                        )
                    })
                    .await
                    .map_err(|e| e.to_string())?
                };
                let reply = match tokio::time::timeout(Duration::from_secs(40), result).await {
                    Ok(Ok(result)) => json!({"result":result}),
                    Ok(Err(error)) => json!({"error":error}),
                    Err(_) => json!({"error":"Host request timed out"}),
                };
                let _ = tokio::time::timeout(
                    Duration::from_secs(10),
                    pipe.write_all(format!("{reply}\n").as_bytes()),
                )
                .await;
                // Do not disconnect/flush synchronously: the client drains the pipe and closes its handle.
            });
        }
    })
}
