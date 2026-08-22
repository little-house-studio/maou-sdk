/**
 * process_group.rs — 跨平台进程树 teardown（对齐 Grok xai-tty-utils::ProcessGroup）
 *
 * - Unix: 子进程 process_group(0) 后，用 killpg(SIGTERM/SIGKILL) 收整组
 * - Windows: Job Object + JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE，TerminateJobObject
 *
 * 业务层只应调用 ProcessGroup::attach_std / terminate / kill，不要散落 cfg。
 */

use std::io;
use std::process::Child as StdChild;

/// 跨平台进程树句柄。
pub struct ProcessGroup {
    #[cfg(unix)]
    leader: Option<u32>,
    #[cfg(windows)]
    job: windows::Win32::Foundation::HANDLE,
}

#[cfg(windows)]
unsafe impl Send for ProcessGroup {}
#[cfg(windows)]
unsafe impl Sync for ProcessGroup {}

impl ProcessGroup {
    pub fn new() -> io::Result<Self> {
        #[cfg(unix)]
        {
            Ok(Self { leader: None })
        }
        #[cfg(windows)]
        {
            use std::mem::{size_of, zeroed};
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::JobObjects::{
                CreateJobObjectW, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
                JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JobObjectExtendedLimitInformation,
                SetInformationJobObject,
            };
            use windows::core::PCWSTR;

            let job = unsafe { CreateJobObjectW(None, PCWSTR::null()) }
                .map_err(|e| io::Error::other(format!("CreateJobObjectW: {e}")))?;

            let mut info: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = unsafe { zeroed() };
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

            let result = unsafe {
                SetInformationJobObject(
                    job,
                    JobObjectExtendedLimitInformation,
                    (&info as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),
                    size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32,
                )
            };
            if let Err(e) = result {
                let _ = unsafe { CloseHandle(job) };
                return Err(io::Error::other(format!("SetInformationJobObject: {e}")));
            }

            Ok(Self { job })
        }
    }

    /// 把 std::process::Child 登记进组/作业（须在 spawn 后、wait 前调用）。
    pub fn attach_std(&mut self, child: &StdChild) -> io::Result<()> {
        self.attach_pid(child.id())
    }

    pub fn attach_pid(&mut self, pid: u32) -> io::Result<()> {
        #[cfg(unix)]
        {
            // killpg 安全：拒绝 0（本进程组）、1（init）、过大 pid
            if pid <= 1 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("refusing degenerate process-group id {pid}"),
                ));
            }
            if pid > i32::MAX as u32 {
                return Err(io::Error::new(
                    io::ErrorKind::InvalidInput,
                    format!("process-group id {pid} exceeds i32::MAX"),
                ));
            }
            self.leader = Some(pid);
            Ok(())
        }
        #[cfg(windows)]
        {
            use windows::Win32::Foundation::CloseHandle;
            use windows::Win32::System::JobObjects::AssignProcessToJobObject;
            use windows::Win32::System::Threading::{
                OpenProcess, PROCESS_SET_QUOTA, PROCESS_TERMINATE,
            };

            let process_handle =
                unsafe { OpenProcess(PROCESS_SET_QUOTA | PROCESS_TERMINATE, false, pid) }
                    .map_err(|e| io::Error::other(format!("OpenProcess({pid}): {e}")))?;

            let assign_result = unsafe { AssignProcessToJobObject(self.job, process_handle) };
            let _ = unsafe { CloseHandle(process_handle) };

            assign_result
                .map_err(|e| io::Error::other(format!("AssignProcessToJobObject({pid}): {e}")))
        }
    }

    /// 温和结束（Unix SIGTERM；Windows TerminateJobObject）
    pub fn terminate(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.killpg(libc::SIGTERM)
        }
        #[cfg(windows)]
        {
            self.terminate_job(1)
        }
    }

    /// 强制结束（Unix SIGKILL；Windows TerminateJobObject）
    pub fn kill(&self) -> io::Result<()> {
        #[cfg(unix)]
        {
            self.killpg(libc::SIGKILL)
        }
        #[cfg(windows)]
        {
            self.terminate_job(1)
        }
    }

    #[cfg(unix)]
    fn killpg(&self, sig: i32) -> io::Result<()> {
        let Some(leader) = self.leader else {
            return Ok(());
        };
        // kill(-pgid, sig) == killpg
        let rc = unsafe { libc::kill(-(leader as i32), sig) };
        if rc == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(windows)]
    fn terminate_job(&self, exit_code: u32) -> io::Result<()> {
        use windows::Win32::System::JobObjects::TerminateJobObject;
        unsafe { TerminateJobObject(self.job, exit_code) }
            .map_err(|e| io::Error::other(format!("TerminateJobObject: {e}")))
    }
}

#[cfg(windows)]
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        // KILL_ON_JOB_CLOSE：关 job 句柄时干掉仍在作业内的进程
        let _ = unsafe { windows::Win32::Foundation::CloseHandle(self.job) };
    }
}

/// 配置 Command：子进程成为新进程组 leader（Unix）/ 新进程组（Windows flags 在 shell 里拼）
pub fn configure_new_process_group(cmd: &mut std::process::Command) {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }
    // Windows：进程组 + Job 由 spawn 后 attach 负责；CREATE_NEW_PROCESS_GROUP 在 shell 拼 flags
}
