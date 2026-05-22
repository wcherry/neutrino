use std::env;
use crate::shared::get_env_or_secret;

/// Unified configuration for the neutrino service.
/// Each domain reads its own sub-config. This top-level struct gathers all
/// settings so `main.rs` only has to call `Config::from_env()` once.
#[derive(Debug, Clone)]
pub struct Config {
    pub port: u16,
    pub log_level: String,
    pub log_path: Option<String>,

    // Shared auth token settings (all services use the same JWT secret)
    pub jwt_secret: String,
    pub jwt_access_expiry_secs: u64,
    pub jwt_refresh_expiry_secs: u64,

    // Unified database URL
    pub database_url: String,

    // Drive storage
    pub storage_path: String,
    pub max_upload_bytes: u64,
    pub worker_secret: String,
    pub jobs_per_worker: usize,

    // OAuth for calendar connections
    pub oauth: OAuthConfig,
    pub drive_base_url: String,

    pub web_dir: String,
}

#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    pub google_redirect_uri: String,
    pub outlook_client_id: Option<String>,
    pub outlook_client_secret: Option<String>,
    pub outlook_redirect_uri: String,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .map_err(|e| format!("Invalid PORT: {}", e))?;

        let jwt_secret =
            get_env_or_secret("JWT_SECRET").map_err(|_| "JWT_SECRET environment variable is required")?;
        if jwt_secret.is_empty() {
            return Err("JWT_SECRET must not be empty".to_string());
        }

        let jwt_access_expiry_secs = env::var("JWT_ACCESS_EXPIRY_SECS")
            .unwrap_or_else(|_| "900".to_string())
            .parse::<u64>()
            .map_err(|e| format!("Invalid JWT_ACCESS_EXPIRY_SECS: {}", e))?;

        let jwt_refresh_expiry_secs = env::var("JWT_REFRESH_EXPIRY_SECS")
            .unwrap_or_else(|_| "604800".to_string())
            .parse::<u64>()
            .map_err(|e| format!("Invalid JWT_REFRESH_EXPIRY_SECS: {}", e))?;

        let log_level = env::var("LOG_LEVEL").unwrap_or_else(|_| "info".to_string());
        let log_path = env::var("LOG_PATH").ok();

        let database_url = env::var("DATABASE_URL")
            .unwrap_or_else(|_| "./data/neutrino.db".to_string());

        let storage_path = env::var("STORAGE_PATH").unwrap_or_else(|_| "./storage".to_string());

        let max_upload_bytes = env::var("MAX_UPLOAD_BYTES")
            .unwrap_or_else(|_| (10u64 * 1024 * 1024 * 1024).to_string())
            .parse::<u64>()
            .map_err(|e| format!("Invalid MAX_UPLOAD_BYTES: {}", e))?;

        let worker_secret = get_env_or_secret("WORKER_SECRET")
            .map_err(|_| "WORKER_SECRET environment variable is required")?;
        if worker_secret.is_empty() {
            return Err("WORKER_SECRET must not be empty".to_string());
        }

        let jobs_per_worker = env::var("JOBS_PER_WORKER")
            .unwrap_or_else(|_| "4".to_string())
            .parse::<usize>()
            .unwrap_or(4)
            .max(1);

        let drive_base_url =
            env::var("DRIVE_URL").unwrap_or_else(|_| format!("http://localhost:{}", port));

        let oauth = OAuthConfig {
            google_client_id: get_env_or_secret("GOOGLE_CLIENT_ID").ok(),
            google_client_secret: get_env_or_secret("GOOGLE_CLIENT_SECRET").ok(),
            google_redirect_uri: get_env_or_secret("GOOGLE_REDIRECT_URI")
                .unwrap_or_else(|_| format!("{}/api/v1/connections/google/callback", drive_base_url)),
            outlook_client_id: get_env_or_secret("OUTLOOK_CLIENT_ID").ok(),
            outlook_client_secret: get_env_or_secret("OUTLOOK_CLIENT_SECRET").ok(),
            outlook_redirect_uri: get_env_or_secret("OUTLOOK_REDIRECT_URI")
                .unwrap_or_else(|_| format!("{}/api/v1/connections/outlook/callback", drive_base_url)),
        };

        let web_dir = env::var("WEB_DIR").unwrap_or_else(|_| "web/apps/web/out".to_string());

        Ok(Config {
            port,
            log_level,
            log_path,
            jwt_secret,
            jwt_access_expiry_secs,
            jwt_refresh_expiry_secs,
            database_url,
            storage_path,
            max_upload_bytes,
            worker_secret,
            jobs_per_worker,
            drive_base_url,
            oauth,
            web_dir,
        })
    }
}
