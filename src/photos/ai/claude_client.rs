use crate::shared::{get_env_or_secret, ApiError};
use reqwest::Client;
use serde_json::{json, Value};

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

    pub fn from_env() -> Option<Self> {
        get_env_or_secret("ANTHROPIC_API_KEY").ok().map(Self::new)
    }

    /// Send a prompt that includes a base64-encoded image.
    pub async fn complete_with_vision(
        &self,
        image_base64: &str,
        media_type: &str,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, ApiError> {
        let body = json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": max_tokens,
            "messages": [{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_base64
                        }
                    },
                    {
                        "type": "text",
                        "text": prompt
                    }
                ]
            }]
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
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            return Err(ApiError::internal(format!(
                "Claude API returned {status}: {text}"
            )));
        }

        let data: Value = resp
            .json()
            .await
            .map_err(|e| ApiError::internal(e.to_string()))?;
        let text = data["content"][0]["text"]
            .as_str()
            .ok_or_else(|| ApiError::internal("Invalid Claude response"))?
            .to_string();
        Ok(text)
    }
}
