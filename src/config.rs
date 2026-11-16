use crate::shared::get_env_or_secret;
use std::env;

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
    /// How often to sweep upload staging files that never committed.
    pub temp_sweep_interval_secs: u64,
    /// How long a staging file must have gone untouched before a sweep will
    /// remove it. Generous by design — the in-process guard already handles
    /// aborts, so this only has to catch what a crash leaves behind, and the
    /// cost of being wrong is deleting a live upload.
    pub temp_max_age_secs: u64,
    pub worker_secret: String,
    pub jobs_per_worker: usize,

    // OAuth for calendar connections
    pub oauth: OAuthConfig,

    /// The address people reach this server on (`PUBLIC_URL`), e.g.
    /// `https://neutrino.example.com`. Every link the server hands out starts
    /// with it: verification, reset, invite, share and notification email,
    /// and invite links returned by the API. Never used to call the server
    /// itself — that is [`Config::internal_url`].
    pub public_url: String,

    /// How the server reaches its own API from inside the process or
    /// container: always `http://127.0.0.1:<PORT>`, which is what it binds.
    /// Not configurable, so changing `PUBLIC_URL` can never send a self-call
    /// out through a reverse proxy.
    pub internal_url: String,

    pub web_dir: String,

    /// Whether anyone may create an account (`PUBLIC_SIGNUP=open`, the default)
    /// or only someone holding an invite (`PUBLIC_SIGNUP=closed`). Admin-created
    /// accounts are unaffected.
    pub public_signup_open: bool,

    /// `EMAIL_VERIFICATION` as given (`off`, `soft` or `enforce`), or `None`.
    /// Resolved in `main` once the mailer is known, since unset means
    /// `enforce` only when mail really leaves the server; see
    /// `auth::email_verification::policy::VerificationMode::parse`.
    pub email_verification: Option<String>,
}

/// Reads `PUBLIC_SIGNUP`: unset or `open` is true, `closed` is false, anything
/// else is a startup error rather than a guess.
fn parse_public_signup(value: Option<&str>) -> Result<bool, String> {
    match value.map(|v| v.trim().to_ascii_lowercase()).as_deref() {
        None | Some("") | Some("open") => Ok(true),
        Some("closed") => Ok(false),
        Some(other) => Err(format!(
            "PUBLIC_SIGNUP must be `open` or `closed`, not `{other}`"
        )),
    }
}

#[derive(Debug, Clone)]
pub struct OAuthConfig {
    pub google_client_id: Option<String>,
    pub google_client_secret: Option<String>,
    /// Only what `GOOGLE_REDIRECT_URI` set. Almost always `None` — read it
    /// through [`OAuthConfig::google_redirect_uri`], never directly.
    pub google_redirect_uri: Option<String>,
    pub outlook_client_id: Option<String>,
    pub outlook_client_secret: Option<String>,
    /// See [`OAuthConfig::google_redirect_uri`]; same rule.
    pub outlook_redirect_uri: Option<String>,
    /// Where the deployment believes it lives, from `PUBLIC_URL`. Only the
    /// fallback for a redirect URI — the request's own origin is preferred.
    pub base_url: String,
}

/// Where Google sends the browser back to: a page in the web app, not an API
/// route. The redirect is a plain browser navigation and carries no
/// `Authorization` header, so the page reads the code out of the URL and posts
/// it back with the user's JWT (`POST /connections/google/complete`).
pub const GOOGLE_REDIRECT_PATH: &str = "/calendar/settings/oauth/google/callback";

/// The same for Microsoft, and for the same reason: the redirect used to land on
/// the API route, which is behind the `AuthenticatedUser` extractor and so
/// answered Microsoft's token-less navigation with a 401 (issue #159).
pub const OUTLOOK_REDIRECT_PATH: &str = "/calendar/settings/oauth/outlook/callback";

impl OAuthConfig {
    /// The redirect URI to hand Google, and to repeat verbatim at code exchange —
    /// the two must be byte-identical or the exchange fails.
    ///
    /// `origin` is the origin the browser reached us on, and it wins over
    /// `base_url` because `base_url` defaults to `http://localhost:<port>`: the
    /// address *inside* the container, which matches nothing an admin registered
    /// in the Google console and is what makes an otherwise-correct deployment
    /// fail with `redirect_uri_mismatch`. A forged `Origin` header only produces
    /// a URI Google rejects as unregistered, so trusting it costs nothing.
    pub fn google_redirect_uri(&self, origin: Option<&str>) -> String {
        redirect_uri(
            self.google_redirect_uri.as_deref(),
            origin,
            &self.base_url,
            GOOGLE_REDIRECT_PATH,
        )
    }

    /// As [`OAuthConfig::google_redirect_uri`], for Microsoft.
    pub fn outlook_redirect_uri(&self, origin: Option<&str>) -> String {
        redirect_uri(
            self.outlook_redirect_uri.as_deref(),
            origin,
            &self.base_url,
            OUTLOOK_REDIRECT_PATH,
        )
    }
}

/// An env var set to the empty string means "not set" here: an empty redirect
/// URI would otherwise override the derived one with nothing.
fn non_empty(value: Option<String>) -> Option<String> {
    value.filter(|s| !s.trim().is_empty())
}

fn redirect_uri(
    configured: Option<&str>,
    origin: Option<&str>,
    base_url: &str,
    path: &str,
) -> String {
    match configured {
        Some(uri) => uri.to_string(),
        None => format!("{}{}", origin.unwrap_or(base_url).trim_end_matches('/'), path),
    }
}

/// What [`resolve_public_url`] settled on, and anything an admin should hear
/// about it.
#[derive(Debug, PartialEq)]
struct PublicUrl {
    url: String,
    warnings: Vec<String>,
}

/// `PUBLIC_URL`, else the old name `DRIVE_URL`, else `http://localhost:<PORT>`.
///
/// `DRIVE_URL` is still read so a deployment that set it keeps working after
/// the rename. Dropping it would have quietly put localhost back into every
/// emailed link. The localhost default only suits a server nobody reaches from
/// another machine, so falling back to it gets a warning too.
fn resolve_public_url(public: Option<String>, legacy: Option<String>, port: u16) -> PublicUrl {
    let mut warnings = Vec::new();
    let url = match (public, legacy) {
        (Some(url), legacy) => {
            if legacy.is_some() {
                warnings.push(
                    "DRIVE_URL is ignored because PUBLIC_URL is set; remove DRIVE_URL".to_string(),
                );
            }
            url
        }
        (None, Some(url)) => {
            warnings.push("DRIVE_URL is deprecated; rename it to PUBLIC_URL".to_string());
            url
        }
        (None, None) => format!("http://localhost:{}", port),
    };
    let url = url.trim().trim_end_matches('/').to_string();
    if is_loopback(&url) {
        warnings.push(format!(
            "PUBLIC_URL is {url}: links in email will only open on this machine. \
             Set PUBLIC_URL to the address people reach this server on"
        ));
    }
    PublicUrl { url, warnings }
}

fn is_loopback(url: &str) -> bool {
    let host = url
        .split_once("://")
        .map_or(url, |(_, rest)| rest)
        .split(['/', '?', '#'])
        .next()
        .unwrap_or("");
    let host = match host.strip_prefix('[') {
        Some(v6) => v6.split(']').next().unwrap_or(""),
        None => host.rsplit_once(':').map_or(host, |(h, _)| h),
    };
    host.eq_ignore_ascii_case("localhost") || host.starts_with("127.") || host == "::1"
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        let port = env::var("PORT")
            .unwrap_or_else(|_| "8080".to_string())
            .parse::<u16>()
            .map_err(|e| format!("Invalid PORT: {}", e))?;

        let jwt_secret = get_env_or_secret("JWT_SECRET")
            .map_err(|_| "JWT_SECRET environment variable is required")?;
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

        let database_url =
            env::var("DATABASE_URL").unwrap_or_else(|_| "./data/neutrino.db".to_string());

        let storage_path = env::var("STORAGE_PATH").unwrap_or_else(|_| "./storage".to_string());

        let max_upload_bytes = env::var("MAX_UPLOAD_BYTES")
            .unwrap_or_else(|_| (10u64 * 1024 * 1024 * 1024).to_string())
            .parse::<u64>()
            .map_err(|e| format!("Invalid MAX_UPLOAD_BYTES: {}", e))?;

        let temp_sweep_interval_secs = env::var("TEMP_SWEEP_INTERVAL_SECS")
            .unwrap_or_else(|_| "3600".to_string())
            .parse::<u64>()
            .map_err(|e| format!("Invalid TEMP_SWEEP_INTERVAL_SECS: {}", e))?
            .max(60);

        let temp_max_age_secs = env::var("TEMP_MAX_AGE_SECS")
            .unwrap_or_else(|_| "21600".to_string())
            .parse::<u64>()
            .map_err(|e| format!("Invalid TEMP_MAX_AGE_SECS: {}", e))?;

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

        let public_url = resolve_public_url(
            non_empty(env::var("PUBLIC_URL").ok()),
            non_empty(env::var("DRIVE_URL").ok()),
            port,
        );
        for warning in &public_url.warnings {
            // Printed for the same reason as the paths below: logging is not up yet.
            println!("WARNING: {warning}");
        }
        let public_url = public_url.url;
        let internal_url = format!("http://127.0.0.1:{}", port);

        let oauth = OAuthConfig {
            google_client_id: get_env_or_secret("GOOGLE_CLIENT_ID").ok(),
            google_client_secret: get_env_or_secret("GOOGLE_CLIENT_SECRET").ok(),
            google_redirect_uri: non_empty(get_env_or_secret("GOOGLE_REDIRECT_URI").ok()),
            outlook_client_id: get_env_or_secret("OUTLOOK_CLIENT_ID").ok(),
            outlook_client_secret: get_env_or_secret("OUTLOOK_CLIENT_SECRET").ok(),
            outlook_redirect_uri: non_empty(get_env_or_secret("OUTLOOK_REDIRECT_URI").ok()),
            base_url: public_url.clone(),
        };

        let web_dir = env::var("WEB_DIR").unwrap_or_else(|_| "web/apps/web/out".to_string());

        let public_signup_open = parse_public_signup(env::var("PUBLIC_SIGNUP").ok().as_deref())?;

        // Every path here has a default, so a variable that is missing — or
        // misspelled in a `.env` — produces a working server pointed somewhere
        // nobody meant, with nothing said about it. Reporting what was actually
        // resolved is what makes that visible on the first line of the log
        // instead of on the day the files cannot be found. Printed rather than
        // logged because `init_logging` runs on the values being returned here.
        println!(
            "Resolved paths: public_url={} database={} storage={} web={} logs={}",
            public_url,
            database_url,
            storage_path,
            web_dir,
            log_path.as_deref().unwrap_or("stdout"),
        );

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
            temp_sweep_interval_secs,
            temp_max_age_secs,
            worker_secret,
            jobs_per_worker,
            oauth,
            public_url,
            internal_url,
            web_dir,
            public_signup_open,
            email_verification: env::var("EMAIL_VERIFICATION").ok(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve(public: Option<&str>, legacy: Option<&str>) -> PublicUrl {
        resolve_public_url(public.map(str::to_string), legacy.map(str::to_string), 8080)
    }

    #[test]
    fn public_url_is_read_as_given_without_a_trailing_slash() {
        assert_eq!(
            resolve(Some("https://neutrino.example.com/"), None),
            PublicUrl {
                url: "https://neutrino.example.com".into(),
                warnings: vec![]
            }
        );
    }

    #[test]
    fn the_old_drive_url_name_still_works_with_a_warning() {
        let got = resolve(None, Some("https://neutrino.example.com"));
        assert_eq!(got.url, "https://neutrino.example.com");
        assert_eq!(got.warnings.len(), 1);
        assert!(got.warnings[0].contains("rename it to PUBLIC_URL"));
    }

    #[test]
    fn public_url_wins_over_drive_url() {
        let got = resolve(Some("https://new.example"), Some("http://localhost:8080"));
        assert_eq!(got.url, "https://new.example");
        assert_eq!(got.warnings.len(), 1);
        assert!(got.warnings[0].contains("DRIVE_URL is ignored"));
    }

    #[test]
    fn unset_defaults_to_localhost_and_says_so() {
        let got = resolve(None, None);
        assert_eq!(got.url, "http://localhost:8080");
        assert_eq!(got.warnings.len(), 1);
        assert!(got.warnings[0].contains("only open on this machine"));
    }

    #[test]
    fn a_loopback_public_url_is_warned_about() {
        for url in [
            "http://localhost:8080",
            "http://LOCALHOST",
            "http://127.0.0.1:9000/",
            "http://[::1]:8080",
        ] {
            assert_eq!(resolve(Some(url), None).warnings.len(), 1, "{url}");
        }
        for url in [
            "https://neutrino.example.com",
            "http://192.168.1.10:8080",
            "https://localhost.example.com",
        ] {
            assert!(resolve(Some(url), None).warnings.is_empty(), "{url}");
        }
    }

    #[test]
    fn public_signup_defaults_to_open_and_refuses_unknown_values() {
        assert_eq!(parse_public_signup(None), Ok(true));
        assert_eq!(parse_public_signup(Some("open")), Ok(true));
        assert_eq!(parse_public_signup(Some(" Closed ")), Ok(false));
        assert!(parse_public_signup(Some("invite-only")).is_err());
    }

    fn cfg(google: Option<&str>, outlook: Option<&str>) -> OAuthConfig {
        OAuthConfig {
            google_client_id: Some("id".into()),
            google_client_secret: Some("secret".into()),
            google_redirect_uri: google.map(str::to_string),
            outlook_client_id: None,
            outlook_client_secret: None,
            outlook_redirect_uri: outlook.map(str::to_string),
            base_url: "http://localhost:8080".into(),
        }
    }

    /// Issue #158: the browser is at `https://neutrino.example.com`, the server
    /// only knows it is listening on `localhost:8080`, and a redirect URI built
    /// from the latter is one Google has never heard of.
    #[test]
    fn prefers_the_origin_the_browser_arrived_on() {
        assert_eq!(
            cfg(None, None).google_redirect_uri(Some("https://neutrino.example.com")),
            "https://neutrino.example.com/calendar/settings/oauth/google/callback"
        );
    }

    #[test]
    fn falls_back_to_the_configured_base_url() {
        assert_eq!(
            cfg(None, None).google_redirect_uri(None),
            "http://localhost:8080/calendar/settings/oauth/google/callback"
        );
    }

    #[test]
    fn an_explicit_redirect_uri_wins_over_both() {
        let cfg = cfg(Some("https://pinned.example/cb"), None);
        assert_eq!(
            cfg.google_redirect_uri(Some("https://neutrino.example.com")),
            "https://pinned.example/cb"
        );
        assert_eq!(cfg.google_redirect_uri(None), "https://pinned.example/cb");
    }

    #[test]
    fn does_not_double_the_slash_between_origin_and_path() {
        assert_eq!(
            cfg(None, None).google_redirect_uri(Some("https://neutrino.example.com/")),
            "https://neutrino.example.com/calendar/settings/oauth/google/callback"
        );
    }

    /// Both callbacks are pages in the web app, not API routes: the redirect
    /// carries no `Authorization` header, so the code has to come back through
    /// an authenticated POST.
    #[test]
    fn both_providers_redirect_to_the_web_app() {
        let cfg = cfg(None, None);
        assert_eq!(
            cfg.google_redirect_uri(Some("https://x.test")),
            "https://x.test/calendar/settings/oauth/google/callback"
        );
        assert_eq!(
            cfg.outlook_redirect_uri(Some("https://x.test")),
            "https://x.test/calendar/settings/oauth/outlook/callback"
        );
    }

    #[test]
    fn an_empty_env_var_is_not_a_redirect_uri() {
        assert_eq!(non_empty(Some("   ".into())), None);
        assert_eq!(non_empty(Some("x".into())), Some("x".into()));
    }
}
