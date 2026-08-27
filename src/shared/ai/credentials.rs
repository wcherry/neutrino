use serde::{Deserialize, Serialize};

/// Which model provider a request is for.
///
/// Mirrors the `AiProvider` union in `@neutrino/api-core` — the browser is what chooses, in
/// Settings → AI Assistant, and sends its choice with every AI request.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum AiProvider {
    /// The settings default, and the only provider with a free tier to sign up for.
    #[default]
    Gemini,
    Claude,
    Openai,
}

impl AiProvider {
    /// How the provider is named in a message shown to the user.
    pub fn label(&self) -> &'static str {
        match self {
            AiProvider::Gemini => "Google Gemini",
            AiProvider::Claude => "Anthropic Claude",
            AiProvider::Openai => "OpenAI",
        }
    }
}

/// The provider and key an AI request is made with.
///
/// Carried in the body of every AI request rather than read from the server's environment: the key
/// belongs to the person using it, is entered in Settings → AI Assistant and is kept in their
/// browser. `ANTHROPIC_API_KEY` used to stand in for all of this and is no longer read anywhere —
/// a server-wide key made one account's spend everybody's, and pinned every AI feature in the
/// product to a single provider.
#[derive(Debug, Clone, Default, Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AiCredentials {
    /// Defaulted rather than required so a client that predates AI settings gets the "configure a
    /// key" message below instead of a JSON parse error it cannot act on.
    #[serde(default)]
    pub provider: AiProvider,
    #[serde(default)]
    pub api_key: String,
}

impl AiCredentials {
    /// The key to call the provider with, or the message to show the user if there isn't one.
    pub fn key(&self) -> Result<&str, String> {
        let key = self.api_key.trim();
        if key.is_empty() {
            return Err(format!(
                "{} needs an API key. Add one in Settings → AI Assistant.",
                self.provider.label()
            ));
        }
        Ok(key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_providers_the_browser_sends() {
        let creds: AiCredentials =
            serde_json::from_value(serde_json::json!({ "provider": "openai", "apiKey": "sk-x" }))
                .expect("deserialise");
        assert_eq!(creds.provider, AiProvider::Openai);
        assert_eq!(creds.key().expect("key"), "sk-x");
    }

    #[test]
    fn falls_back_to_the_settings_default_provider() {
        let creds: AiCredentials =
            serde_json::from_value(serde_json::json!({})).expect("deserialise");
        assert_eq!(creds.provider, AiProvider::Gemini);
    }

    #[test]
    fn a_missing_key_names_the_provider_and_where_to_set_it() {
        let creds = AiCredentials {
            provider: AiProvider::Claude,
            api_key: "   ".to_string(),
        };
        let err = creds.key().expect_err("blank key");
        assert!(err.contains("Anthropic Claude"), "{err}");
        assert!(err.contains("Settings → AI Assistant"), "{err}");
    }
}
