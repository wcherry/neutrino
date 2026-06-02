use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use crate::shared::{get_env_or_secret, ApiError};

use super::provider::AiProvider;

pub struct ClaudeClient {
    client: Client,
    api_key: String,
}

impl ClaudeClient {
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
        get_env_or_secret("ANTHROPIC_API_KEY").ok().map(Self::new)
    }
}

#[async_trait]
impl AiProvider for ClaudeClient {
    async fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, ApiError> {
        let body = json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}]
        });

        let resp = self
            .client
            .post("https://api.anthropic.com/v1/messages")
            .header("x-api-key", &self.api_key)
            .header("anthropic-version", "2023-06-01")
            .header("content-type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| ApiError::internal(format!("Claude API error: {e}")))?;

        if !resp.status().is_success() {
            return Err(ApiError::internal("Claude API request failed"));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;

        Ok(data["content"][0]["text"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }
}
