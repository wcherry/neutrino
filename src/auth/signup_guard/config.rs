//! Sign-up guard settings, read from the environment once at startup.

use super::client_ip::ClientIpSource;
use crate::shared::get_env_or_secret;
use std::env;

/// Limits and CAPTCHA keys for public sign-up. A limit of `0` means unlimited.
#[derive(Debug, Clone)]
pub struct SignupGuardConfig {
    /// Sign-ups from one client IP per rolling hour (`SIGNUP_IP_HOURLY_LIMIT`).
    pub ip_hourly: i64,
    /// Sign-ups from one client IP per rolling day (`SIGNUP_IP_DAILY_LIMIT`).
    pub ip_daily: i64,
    /// Sign-ups across the whole server per rolling hour
    /// (`SIGNUP_GLOBAL_HOURLY_LIMIT`).
    pub global_hourly: i64,
    /// While Turnstile is configured: sign-ups with neither a CAPTCHA token nor
    /// an invite, from one client IP per rolling day
    /// (`SIGNUP_UNVERIFIED_IP_DAILY_LIMIT`).
    pub unverified_ip_daily: i64,
    /// While Turnstile is configured: the same, across the whole server per
    /// rolling hour (`SIGNUP_UNVERIFIED_GLOBAL_HOURLY_LIMIT`).
    pub unverified_global_hourly: i64,
    /// Extra email domains refused at sign-up, on top of the built-in
    /// throwaway-mail list (`SIGNUP_BLOCKED_EMAIL_DOMAINS`, comma-separated).
    pub blocked_domains: Vec<String>,
    /// `TURNSTILE_SECRET_KEY`: checks CAPTCHA tokens when set.
    pub turnstile_secret: Option<String>,
    /// `TURNSTILE_SITE_KEY`: handed to the web app by `GET /auth/signup-policy`
    /// so it can render the widget without a rebuild.
    pub turnstile_site_key: Option<String>,
    /// `CLIENT_IP_HEADER`: where the client address comes from.
    pub client_ip: ClientIpSource,
}

impl Default for SignupGuardConfig {
    fn default() -> Self {
        SignupGuardConfig {
            ip_hourly: 3,
            ip_daily: 10,
            global_hourly: 60,
            unverified_ip_daily: 2,
            unverified_global_hourly: 10,
            blocked_domains: Vec::new(),
            turnstile_secret: None,
            turnstile_site_key: None,
            client_ip: ClientIpSource::Peer,
        }
    }
}

fn limit(name: &str, default: i64) -> Result<i64, String> {
    match env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty()) {
        None => Ok(default),
        Some(v) => v
            .parse::<i64>()
            .ok()
            .filter(|n| *n >= 0)
            .ok_or_else(|| format!("{name} must be a whole number of sign-ups (0 for unlimited), not `{v}`")),
    }
}

fn non_empty(v: Option<String>) -> Option<String> {
    v.map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

impl SignupGuardConfig {
    pub fn from_env() -> Result<Self, String> {
        let d = Self::default();
        let turnstile_secret = non_empty(get_env_or_secret("TURNSTILE_SECRET_KEY").ok());
        let turnstile_site_key = non_empty(env::var("TURNSTILE_SITE_KEY").ok());
        if turnstile_secret.is_some() != turnstile_site_key.is_some() {
            return Err(
                "TURNSTILE_SECRET_KEY and TURNSTILE_SITE_KEY must be set together".to_string(),
            );
        }
        Ok(SignupGuardConfig {
            ip_hourly: limit("SIGNUP_IP_HOURLY_LIMIT", d.ip_hourly)?,
            ip_daily: limit("SIGNUP_IP_DAILY_LIMIT", d.ip_daily)?,
            global_hourly: limit("SIGNUP_GLOBAL_HOURLY_LIMIT", d.global_hourly)?,
            unverified_ip_daily: limit("SIGNUP_UNVERIFIED_IP_DAILY_LIMIT", d.unverified_ip_daily)?,
            unverified_global_hourly: limit(
                "SIGNUP_UNVERIFIED_GLOBAL_HOURLY_LIMIT",
                d.unverified_global_hourly,
            )?,
            blocked_domains: env::var("SIGNUP_BLOCKED_EMAIL_DOMAINS")
                .unwrap_or_default()
                .split(',')
                .map(|s| s.trim().trim_start_matches('@').to_ascii_lowercase())
                .filter(|s| !s.is_empty())
                .collect(),
            turnstile_secret,
            turnstile_site_key,
            client_ip: ClientIpSource::parse(env::var("CLIENT_IP_HEADER").ok().as_deref()),
        })
    }

    /// One line for the startup log.
    pub fn summary(&self) -> String {
        let n = |v: i64| if v == 0 { "unlimited".to_string() } else { v.to_string() };
        format!(
            "per IP {}/h {}/day, server {}/h; CAPTCHA {}{}; client IP from {}; {} extra blocked domain(s)",
            n(self.ip_hourly),
            n(self.ip_daily),
            n(self.global_hourly),
            if self.turnstile_secret.is_some() { "on" } else { "off" },
            if self.turnstile_secret.is_some() {
                format!(
                    " (without it: {}/day per IP, {}/h server)",
                    n(self.unverified_ip_daily),
                    n(self.unverified_global_hourly)
                )
            } else {
                String::new()
            },
            self.client_ip.describe(),
            self.blocked_domains.len(),
        )
    }
}
