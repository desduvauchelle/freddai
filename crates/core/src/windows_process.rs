//! A kill-on-close Job Object owns each agent tree. Assign while suspended, then resume its thread.
use std::{io, mem::size_of, os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle}, process::{Child, Command}};
use windows_sys::Win32::{Foundation::{CloseHandle, INVALID_HANDLE_VALUE}, System::{
    JobObjects::{CreateJobObjectW, SetInformationJobObject, AssignProcessToJobObject, JobObjectExtendedLimitInformation, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE},
    Diagnostics::ToolHelp::{CreateToolhelp32Snapshot, Thread32First, Thread32Next, THREADENTRY32, TH32CS_SNAPTHREAD},
    Threading::{OpenThread, ResumeThread, THREAD_SUSPEND_RESUME, CREATE_SUSPENDED, CREATE_NO_WINDOW},
}};
pub struct Job(OwnedHandle);
impl Job {
    fn new() -> io::Result<Self> {
        unsafe {
            let handle = CreateJobObjectW(std::ptr::null(), std::ptr::null());
            if handle.is_null() { return Err(io::Error::last_os_error()); }
            let job = Self(OwnedHandle::from_raw_handle(handle));
            let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            if SetInformationJobObject(handle, JobObjectExtendedLimitInformation, (&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(), size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0 { return Err(io::Error::last_os_error()); }
            Ok(job)
        }
    }
}
pub fn spawn(command: &mut Command) -> io::Result<(Child, Job)> {
    use std::os::windows::process::CommandExt;
    let job = Job::new()?;
    command.creation_flags(CREATE_SUSPENDED | CREATE_NO_WINDOW);
    let mut child = command.spawn()?;
    let result = unsafe {
        if AssignProcessToJobObject(job.0.as_raw_handle(), child.as_raw_handle()) == 0 { Err(io::Error::last_os_error()) }
        else { resume(child.id()) }
    };
    if let Err(error) = result { let _ = child.kill(); let _ = child.wait(); return Err(error); }
    Ok((child, job))
}
unsafe fn resume(pid: u32) -> io::Result<()> {
    let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPTHREAD, 0);
    if snapshot == INVALID_HANDLE_VALUE { return Err(io::Error::last_os_error()); }
    let snapshot = OwnedHandle::from_raw_handle(snapshot);
    let mut entry: THREADENTRY32 = std::mem::zeroed();
    entry.dwSize = size_of::<THREADENTRY32>() as u32;
    let mut found = Thread32First(snapshot.as_raw_handle(), &mut entry) != 0;
    while found {
        if entry.th32OwnerProcessID == pid {
            let thread = OpenThread(THREAD_SUSPEND_RESUME, 0, entry.th32ThreadID);
            if thread.is_null() { return Err(io::Error::last_os_error()); }
            let result = ResumeThread(thread);
            let error = io::Error::last_os_error();
            CloseHandle(thread);
            return if result == u32::MAX { Err(error) } else { Ok(()) };
        }
        found = Thread32Next(snapshot.as_raw_handle(), &mut entry) != 0;
    }
    Err(io::Error::new(io::ErrorKind::NotFound, "Suspended agent thread was not found"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{io::{BufRead, BufReader, Write}, process::Stdio, time::Duration};
    use windows_sys::Win32::System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE};
    #[test]
    #[ignore = "child fixture, invoked explicitly by the job test"]
    fn leaf_fixture() { std::thread::sleep(Duration::from_secs(120)); }
    #[test]
    #[ignore = "child fixture, invoked explicitly by the job test"]
    fn tree_fixture() {
        let child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "windows_process::tests::leaf_fixture", "--ignored"])
            .stdout(Stdio::null()).spawn().unwrap();
        println!("CHILD_PID={}", child.id());
        std::io::stdout().flush().unwrap();
        std::thread::sleep(Duration::from_secs(120));
    }
    #[test]
    fn closing_job_terminates_agent_and_descendants() {
        let mut cmd = Command::new(std::env::current_exe().unwrap());
        cmd.args(["--exact", "windows_process::tests::tree_fixture", "--ignored", "--nocapture"])
            .stdout(Stdio::piped()).stdin(Stdio::null());
        let (mut child, job) = spawn(&mut cmd).unwrap();
        let pid = BufReader::new(child.stdout.take().unwrap()).lines().map_while(Result::ok)
            .find_map(|line|line.strip_prefix("CHILD_PID=").and_then(|n|n.parse::<u32>().ok())).unwrap();
        unsafe {
            let descendant = OpenProcess(PROCESS_SYNCHRONIZE, 0, pid);
            assert!(!descendant.is_null());
            drop(job);
            assert_eq!(WaitForSingleObject(descendant, 10000), 0, "descendant survived job close");
            CloseHandle(descendant);
        }
        assert!(!child.wait().unwrap().success());
    }
}
