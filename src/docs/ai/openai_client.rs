use async_trait::async_trait;
use reqwest::Client;
use serde_json::json;
use crate::shared::get_env_or_secret;

use crate::shared::ApiError;
use super::provider::AiProvider;

pub struct OpenAiClient {
    client: Client,
    api_key: String,
}

impl OpenAiClient {
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
        get_env_or_secret("OPENAI_API_KEY").ok().map(Self::new)
    }
}

#[async_trait]
impl AiProvider for OpenAiClient {
    async fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, ApiError> {
        let body = json!({
            "model": "gpt-4o",
            "max_tokens": max_tokens,
            "messages": [{"role": "user", "content": prompt}]
        });

        let resp = self
            .client
            .post("https://api.openai.com/v1/chat/completions")
            .header("Authorization", format!("Bearer {}", self.api_key))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await
            .map_err(|e| ApiError::internal(format!("OpenAI API error: {e}")))?;

        if !resp.status().is_success() {
            let status = resp.status();
            let body_text = resp.text().await.unwrap_or_default();
            return Err(ApiError::internal(format!(
                "OpenAI API request failed ({status}): {body_text}"
            )));
        }

        let data: serde_json::Value = resp
            .json()
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;

        Ok(data["choices"][0]["message"]["content"]
            .as_str()
            .unwrap_or("")
            .to_string())
    }
}
