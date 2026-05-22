use serde::Serialize;
use std::path::Path;

use crate::shared::ApiError;

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProcessInfo {
    pub pid: u32,
    pub name: String,
    pub status: String,
    pub cpu_percent: f64,
    pub memory_rss_kb: u64,
    pub open_files: u32,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PathUsage {
    pub path: String,
    pub used_bytes: u64,
    pub percent: f64,
}

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiskUsageInfo {
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub free_bytes: u64,
    pub paths: Vec<PathUsage>,
}

// ── Service ──────────────────────────────────────────────────────────────────

pub struct AdminDashboardService {
    pub storage_path: String,
}

impl AdminDashboardService {
    pub fn new(storage_path: String) -> Self {
        Self { storage_path }
    }

    /// Return process information for the current process and, on Linux,
    /// enumerate other visible processes from /proc.
    pub fn get_processes(&self) -> Result<Vec<ProcessInfo>, ApiError> {
        let mut procs = Vec::new();

        // Always include ourselves.
        let our_pid = std::process::id();
        let self_info = read_proc_info(our_pid);
        procs.push(self_info);

        // On Linux enumerate additional processes from /proc.
        #[cfg(target_os = "linux")]
        {
            if let Ok(entries) = std::fs::read_dir("/proc") {
                for entry in entries.flatten() {
                    let name = entry.file_name();
                    let name_str = name.to_string_lossy();
                    if let Ok(pid) = name_str.parse::<u32>() {
                        if pid == our_pid {
                            continue;
                        }
                        let info = read_proc_info(pid);
                        procs.push(info);
                    }
                }
            }
            // Keep list manageable — most relevant processes first
            procs.sort_by(|a, b| b.memory_rss_kb.cmp(&a.memory_rss_kb));
            procs.truncate(50);
        }

        Ok(procs)
    }

    /// Return disk usage for the configured storage path.
    pub fn get_disk_usage(&self) -> Result<DiskUsageInfo, ApiError> {
        get_disk_usage_for_path(&self.storage_path)
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Read process info for `pid`.  On Linux this parses /proc/<pid>/status and
/// /proc/<pid>/stat for memory and state.  On other platforms a stub is returned.
fn read_proc_info(pid: u32) -> ProcessInfo {
    #[cfg(target_os = "linux")]
    {
        linux_proc_info(pid)
    }
    #[cfg(not(target_os = "linux"))]
    {
        ProcessInfo {
            pid,
            name: "neutrino-drive".to_string(),
            status: "Running".to_string(),
            cpu_percent: 0.0,
            memory_rss_kb: 0,
            open_files: count_open_files(pid),
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_proc_info(pid: u32) -> ProcessInfo {
    let status_path = format!("/proc/{}/status", pid);
    let mut name = format!("pid-{}", pid);
    let mut memory_rss_kb: u64 = 0;
    let mut status_str = "unknown".to_string();

    if let Ok(content) = std::fs::read_to_string(&status_path) {
        for line in content.lines() {
            if let Some(rest) = line.strip_prefix("Name:\t") {
                name = rest.trim().to_string();
            } else if let Some(rest) = line.strip_prefix("State:\t") {
                // "R (running)" → "Running"
                status_str = parse_linux_state(rest.trim());
            } else if let Some(rest) = line.strip_prefix("VmRSS:\t") {
                let kb_str = rest.trim().trim_end_matches(" kB").trim();
                memory_rss_kb = kb_str.parse::<u64>().unwrap_or(0);
            }
        }
    }

    let open_files = count_open_files(pid);

    ProcessInfo {
        pid,
        name,
        status: status_str,
        cpu_percent: 0.0, // computing accurate CPU% requires two samples; omitted
        memory_rss_kb,
        open_files,
    }
}

#[cfg(target_os = "linux")]
fn parse_linux_state(state: &str) -> String {
    // state looks like "R (running)" or just "R"
    if state.starts_with('R') {
        "Running".to_string()
    } else if state.starts_with('S') {
        "Sleeping".to_string()
    } else if state.starts_with('D') {
        "Waiting".to_string()
    } else if state.starts_with('Z') {
        "Zombie".to_string()
    } else if state.starts_with('T') {
        "Stopped".to_string()
    } else {
        state.chars().next().map(|c| c.to_string()).unwrap_or_else(|| "Unknown".to_string())
    }
}

fn count_open_files(pid: u32) -> u32 {
    let fd_path = format!("/proc/{}/fd", pid);
    std::fs::read_dir(&fd_path)
        .map(|dir| dir.count() as u32)
        .unwrap_or(0)
}

pub fn get_disk_usage_for_path(path_str: &str) -> Result<DiskUsageInfo, ApiError> {
    let path = Path::new(path_str);
    if !path.exists() {
        return Err(ApiError::not_found(&format!("Path not found: {}", path_str)));
    }

    let (total_bytes, free_bytes) = statvfs_stats(path)?;
    let used_bytes = total_bytes.saturating_sub(free_bytes);
    let percent = if total_bytes > 0 {
        (used_bytes as f64 / total_bytes as f64) * 100.0
    } else {
        0.0
    };

    let paths = vec![PathUsage {
        path: path_str.to_string(),
        used_bytes,
        percent,
    }];

    Ok(DiskUsageInfo {
        total_bytes,
        used_bytes,
        free_bytes,
        paths,
    })
}

#[cfg(unix)]
fn statvfs_stats(path: &Path) -> Result<(u64, u64), ApiError> {
    use std::mem;
    use std::os::unix::ffi::OsStrExt;
    use std::ffi::CString;

    let c_path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| ApiError::internal("Invalid path"))?;

    unsafe {
        let mut stat: libc::statvfs = mem::zeroed();
        if libc::statvfs(c_path.as_ptr(), &mut stat) != 0 {
            return Err(ApiError::internal("statvfs failed"));
        }
        let block_size = stat.f_frsize as u64;
        let total = stat.f_blocks as u64 * block_size;
        let free = stat.f_bavail as u64 * block_size;
        Ok((total, free))
    }
}

#[cfg(not(unix))]
fn statvfs_stats(_path: &Path) -> Result<(u64, u64), ApiError> {
    // Stub for non-Unix platforms (e.g. Windows CI)
    Ok((100 * 1024 * 1024 * 1024, 50 * 1024 * 1024 * 1024))
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn get_processes_returns_at_least_one_entry() {
        let svc = AdminDashboardService::new(".".to_string());
        let result = svc.get_processes();
        assert!(result.is_ok(), "Expected Ok but got {:?}", result.err());
        let procs = result.unwrap();
        assert!(!procs.is_empty(), "Expected at least one process");
        // Our own PID must appear
        let our_pid = std::process::id();
        assert!(
            procs.iter().any(|p| p.pid == our_pid),
            "Expected current PID {} in list",
            our_pid
        );
    }

    #[test]
    fn get_disk_usage_returns_valid_stats() {
        let result = get_disk_usage_for_path(".");
        assert!(result.is_ok(), "Expected Ok but got {:?}", result.err());
        let info = result.unwrap();
        assert!(info.total_bytes > 0, "total_bytes must be > 0");
        assert!(
            info.used_bytes <= info.total_bytes,
            "used_bytes ({}) must not exceed total_bytes ({})",
            info.used_bytes,
            info.total_bytes
        );
        assert_eq!(
            info.used_bytes + info.free_bytes,
            info.total_bytes,
            "used + free should equal total"
        );
        assert!(!info.paths.is_empty());
    }

    #[test]
    fn disk_usage_invalid_path_returns_error() {
        let result = get_disk_usage_for_path("/nonexistent/path/xyz_12345");
        assert!(result.is_err(), "Expected Err for nonexistent path");
    }

    #[test]
    fn get_disk_usage_via_service() {
        let svc = AdminDashboardService::new(".".to_string());
        let result = svc.get_disk_usage();
        assert!(result.is_ok());
    }
}
