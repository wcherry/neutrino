//! Cloudflare Turnstile token checks.
//!
//! Behind a trait so the guard's tests can stand in a verifier that answers
//! without the network.

use async_trait::async_trait;
use serde::Deserialize;

const SITEVERIFY_URL: &str = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/// What Cloudflare said about a token.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CaptchaOutcome {
    Passed,
    Failed,
    /// Cloudflare could not be asked. The sign-up is treated as carrying no
    /// token, so an outage tightens limits instead of locking everyone out.
    Unavailable,
}

#[async_trait]
pub trait CaptchaVerifier: Send + Sync {
    async fn verify(&self, token: &str, remote_ip: &str) -> CaptchaOutcome;
}

/// Asks Cloudflare's `siteverify` endpoint.
pub struct TurnstileVerifier {
    secret: String,
    http: reqwest::Client,
}

impl TurnstileVerifier {
    pub fn new(secret: String) -> Self {
        TurnstileVerifier {
            secret,
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(5))
                .build()
                .expect("reqwest client"),
        }
    }
}

#[derive(Deserialize)]
struct SiteVerifyResponse {
    success: bool,
    #[serde(default, rename = "error-codes")]
    error_codes: Vec<String>,
}

#[async_trait]
impl CaptchaVerifier for TurnstileVerifier {
    async fn verify(&self, token: &str, remote_ip: &str) -> CaptchaOutcome {
        let mut form = vec![("secret", self.secret.as_str()), ("response", token)];
        if remote_ip != "unknown" && !remote_ip.contains('/') {
            form.push(("remoteip", remote_ip));
        }
        let response = match self.http.post(SITEVERIFY_URL).form(&form).send().await {
            Ok(r) => r,
            Err(e) => {
                tracing::error!("Turnstile siteverify request failed: {}", e);
                return CaptchaOutcome::Unavailable;
            }
        };
        match response.json::<SiteVerifyResponse>().await {
            Ok(body) if body.success => CaptchaOutcome::Passed,
            Ok(body) => {
                // A misconfigured secret fails every sign-up the same way; say so.
                if body.error_codes.iter().any(|c| c.contains("secret")) {
                    tracing::error!("Turnstile rejected the secret key: {:?}", body.error_codes);
                    return CaptchaOutcome::Unavailable;
                }
                tracing::info!("Turnstile token rejected: {:?}", body.error_codes);
                CaptchaOutcome::Failed
            }
            Err(e) => {
                tracing::error!("Turnstile siteverify returned an unreadable body: {}", e);
                CaptchaOutcome::Unavailable
            }
        }
    }
}
