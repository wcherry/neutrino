use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use crate::shared::get_env_or_secret;

use crate::shared::ApiError;
use super::provider::AiProvider;

/// Gemini model to use. The flash model has a free tier at no cost.
const GEMINI_MODEL: &str = "gemini-2.0-flash";

pub struct GeminiClient {
    client: Client,
    api_key: String,
}

impl GeminiClient {
    pub fn new(api_key: String) -> Self {
        Self {
            client: Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
            api_key,
        }
    }

    #[allow(dead_code)]
    pub fn from_env() -> Option<Self> {
        get_env_or_secret("GEMINI_API_KEY").ok().map(Self::new)
    }

    /// Returns a free-tier client using an empty key if no env var is set.
    /// The Gemini flash model allows unauthenticated/no-key usage within
    /// generous free-tier rate limits.
    #[allow(dead_code)]
    pub fn free_tier() -> Self {
        let key = get_env_or_secret("GEMINI_API_KEY")
            .unwrap_or_default();
        Self::new(key)
    }
}

#[async_trait]
impl AiProvider for GeminiClient {
    async fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, ApiError> {
        let url = if self.api_key.is_empty() {
            format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"
            )
        } else {
            format!(
                "https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent?key={}",
                self.api_key
            )
        };

        let body = json!({
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "maxOutputTokens": max_tokens
            }
        });

        let mut req = self
            .client
            .post(&url)
            .header("Content-Type", "application/json")
            .json(&body);

        // When a key is provided, also send it as a header for flexibility.
        if !self.api_key.is_empty() {
            req = req.header("x-goog-api-key", &self.api_key);
        }

        let resp = req
            .send()
            .await
            .map_err(|e| ApiError::internal(format!("Gemini API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(ApiError::internal(format!(
                "Gemini API request failed ({status}): {body_text}"
            )));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;

        Ok(data["candidates"][0]["content"]["parts"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }
}
