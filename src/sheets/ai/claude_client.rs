use crate::shared::get_env_or_secret;
use serde_json::json;
use tracing::error;

pub struct ClaudeClient {
    client: reqwest::Client,
    api_key: String,
}

impl ClaudeClient {
    pub fn new(api_key: String) -> Self {
        ClaudeClient {
            client: reqwest::Client::new(),
            api_key,
        }
    }

    pub fn from_env() -> Option<Self> {
        get_env_or_secret("ANTHROPIC_API_KEY").ok().map(Self::new)
    }

    pub async fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, String> {
        let body = json!({
            "model": "claude-haiku-4-5-20251001",
            "max_tokens": max_tokens,
            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ]
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
            .map_err(|e| {
                error!("Claude API request failed: {:?}", e);
                format!("Claude API request failed: {}", e)
            })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            error!("Claude API error {}: {}", status, text);
            return Err(format!("Claude API returned {}: {}", status, text));
        }

        let json: serde_json::Value = resp.json().await.map_err(|e| {
            error!("Failed to parse Claude API response: {:?}", e);
            format!("Failed to parse Claude API response: {}", e)
        })?;

        let content = json["content"][0]["text"]
            .as_str()
            .ok_or_else(|| "Unexpected Claude API response structure".to_string())?
            .to_string();

        Ok(content)
    }
}
