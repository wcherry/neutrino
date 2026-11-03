//! What Google and Microsoft both do at their OAuth2 token endpoints.
use crate::shared::ApiError;
use serde::de::DeserializeOwned;
use serde::Deserialize;

/// The error body RFC 6749 §5.2 has a token endpoint send, which Google and Microsoft both do.
#[derive(Debug, Deserialize)]
struct TokenErrorBody {
    error: String,
}

/// Reads a refresh's answer. A refused refresh comes back as an error body with no
/// `access_token`; reading it as tokens is how "missing field `access_token`" once stood in for
/// the provider's own reason.
pub async fn read_refresh<T: DeserializeOwned>(
    provider: &str,
    resp: reqwest::Response,
) -> Result<T, ApiError> {
    let status = resp.status();
    let body = resp.text().await.map_err(|e| {
        tracing::error!("{} token refresh read error: {:?}", provider, e);
        ApiError::internal(format!("Failed to read the {provider} token response"))
    })?;

    if !status.is_success() {
        // The error body names the reason and holds no token, so it is safe to log.
        tracing::warn!(
            "{} token refresh refused: HTTP {} {}",
            provider,
            status.as_u16(),
            body.chars().take(500).collect::<String>()
        );
        return Err(refused(provider, status.as_u16(), &body));
    }

    serde_json::from_str(&body).map_err(|e| {
        tracing::error!("{} token refresh parse error: {:?}", provider, e);
        ApiError::internal(format!("Failed to parse {provider} token response"))
    })
}

/// `invalid_grant` is a refresh token the provider no longer honours: it expired (Google's are
/// good for a week while the consent screen is in Testing), was revoked, or the password
/// changed. Only connecting the account again gets a new one.
fn refused(provider: &str, status: u16, body: &str) -> ApiError {
    let reason = serde_json::from_str::<TokenErrorBody>(body).map(|b| b.error);
    match reason.as_deref() {
        Ok("invalid_grant") => ApiError::new(
            502,
            "RECONNECT_REQUIRED",
            format!(
                "{provider} no longer accepts this account's sign-in; reconnect it in Settings"
            ),
        ),
        _ => ApiError::new(
            502,
            "PROVIDER_ERROR",
            format!("{provider} refused to refresh the account's sign-in (HTTP {status})"),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_expired_or_revoked_token_asks_for_a_reconnect() {
        let body = "{\n  \"error\": \"invalid_grant\",\n  \"error_description\": \"Token has been expired or revoked.\"\n}";
        let e = refused("Google", 400, body);
        assert_eq!(e.code, "RECONNECT_REQUIRED");
        assert_eq!(e.status, 502);
    }

    #[test]
    fn any_other_refusal_names_the_status() {
        let e = refused("Outlook", 401, r#"{"error":"invalid_client"}"#);
        assert_eq!(e.code, "PROVIDER_ERROR");
        assert!(e.message.contains("HTTP 401"));
        assert_eq!(refused("Google", 503, "<html>").code, "PROVIDER_ERROR");
    }
}
