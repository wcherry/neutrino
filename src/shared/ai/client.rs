use super::credentials::{AiCredentials, AiProvider};
use serde_json::{json, Value};
use tracing::error;

/// The model each provider is called with.
///
/// One place for all three, so a model move is a line here rather than a hunt through four app
/// modules. These are the same models the product has been using.
const CLAUDE_MODEL: &str = "claude-haiku-4-5-20251001";
const OPENAI_MODEL: &str = "gpt-4o-mini";
const GEMINI_MODEL: &str = "gemini-1.5-flash";

/// A prompt sent to whichever provider the caller configured.
///
/// One client for the whole product: Sheets, Slides, Photos, Docs and Diagrams all go through it,
/// so they behave the same way whichever provider is chosen and none of them has to know a
/// provider's wire format.
pub struct AiClient {
    http: reqwest::Client,
}

impl Default for AiClient {
    fn default() -> Self {
        Self::new()
    }
}

impl AiClient {
    pub fn new() -> Self {
        AiClient {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(60))
                .build()
                .unwrap_or_default(),
        }
    }

    /// Send a prompt and return the model's text.
    pub async fn complete(
        &self,
        credentials: &AiCredentials,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        self.complete_with_system(credentials, "", prompt, max_tokens)
            .await
    }

    /// Send a prompt with separate system instructions.
    pub async fn complete_with_system(
        &self,
        credentials: &AiCredentials,
        system_prompt: &str,
        user_message: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        let key = credentials.key()?;

        match credentials.provider {
            AiProvider::Claude => {
                let mut body = json!({
                    "model": CLAUDE_MODEL,
                    "max_tokens": max_tokens,
                    "messages": [{ "role": "user", "content": user_message }],
                });
                if !system_prompt.is_empty() {
                    body["system"] = json!(system_prompt);
                }
                self.call_claude(key, body).await
            }
            AiProvider::Openai => {
                let mut messages = Vec::new();
                if !system_prompt.is_empty() {
                    messages.push(json!({ "role": "system", "content": system_prompt }));
                }
                messages.push(json!({ "role": "user", "content": user_message }));
                self.call_openai(
                    key,
                    json!({
                        "model": OPENAI_MODEL,
                        "max_tokens": max_tokens,
                        "messages": messages,
                    }),
                )
                .await
            }
            AiProvider::Gemini => {
                let mut body = json!({
                    "contents": [{ "parts": [{ "text": user_message }] }],
                    "generationConfig": { "maxOutputTokens": max_tokens },
                });
                if !system_prompt.is_empty() {
                    body["systemInstruction"] = json!({ "parts": [{ "text": system_prompt }] });
                }
                self.call_gemini(key, body).await
            }
        }
    }

    /// Send a prompt about an image, given as base64 with its media type.
    pub async fn complete_with_vision(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, String> {
        let key = credentials.key()?;

        match credentials.provider {
            AiProvider::Claude => {
                self.call_claude(
                    key,
                    json!({
                        "model": CLAUDE_MODEL,
                        "max_tokens": max_tokens,
                        "messages": [{
                            "role": "user",
                            "content": [
                                {
                                    "type": "image",
                                    "source": {
                                        "type": "base64",
                                        "media_type": media_type,
                                        "data": image_base64,
                                    }
                                },
                                { "type": "text", "text": prompt },
                            ]
                        }],
                    }),
                )
                .await
            }
            AiProvider::Openai => {
                // OpenAI takes the image as a data URL rather than as separate fields.
                self.call_openai(
                    key,
                    json!({
                        "model": OPENAI_MODEL,
                        "max_tokens": max_tokens,
                        "messages": [{
                            "role": "user",
                            "content": [
                                { "type": "text", "text": prompt },
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": format!("data:{};base64,{}", media_type, image_base64)
                                    }
                                },
                            ]
                        }],
                    }),
                )
                .await
            }
            AiProvider::Gemini => {
                self.call_gemini(
                    key,
                    json!({
                        "contents": [{
                            "parts": [
                                { "text": prompt },
                                { "inline_data": { "mime_type": media_type, "data": image_base64 } },
                            ]
                        }],
                        "generationConfig": { "maxOutputTokens": max_tokens },
                    }),
                )
                .await
            }
        }
    }

    // ── Per-provider calls ───────────────────────────────────────────────────

    async fn call_claude(&self, api_key: &str, body: Value) -> Result<String, String> {
        let json = self
            .send(
                self.http
                    .post("https://api.anthropic.com/v1/messages")
                    .header("x-api-key", api_key)
                    .header("anthropic-version", "2023-06-01")
                    .json(&body),
                AiProvider::Claude,
            )
            .await?;

        json["content"]
            .as_array()
            .and_then(|blocks| {
                blocks
                    .iter()
                    .find(|b| b["type"] == "text")
                    .and_then(|b| b["text"].as_str())
            })
            .map(|text| text.trim().to_string())
            .ok_or_else(|| "Unexpected response from Anthropic Claude".to_string())
    }

    async fn call_openai(&self, api_key: &str, body: Value) -> Result<String, String> {
        let json = self
            .send(
                self.http
                    .post("https://api.openai.com/v1/chat/completions")
                    .bearer_auth(api_key)
                    .json(&body),
                AiProvider::Openai,
            )
            .await?;

        json["choices"][0]["message"]["content"]
            .as_str()
            .map(|text| text.trim().to_string())
            .ok_or_else(|| "Unexpected response from OpenAI".to_string())
    }

    async fn call_gemini(&self, api_key: &str, body: Value) -> Result<String, String> {
        // The key goes in a header rather than the query string so it stays out of Google's
        // request logs and out of anything that records URLs on the way.
        let json = self
            .send(
                self.http
                    .post(format!(
                        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent",
                        GEMINI_MODEL
                    ))
                    .header("x-goog-api-key", api_key)
                    .json(&body),
                AiProvider::Gemini,
            )
            .await?;

        json["candidates"][0]["content"]["parts"]
            .as_array()
            .map(|parts| {
                parts
                    .iter()
                    .filter_map(|p| p["text"].as_str())
                    .collect::<Vec<_>>()
                    .join("")
            })
            .filter(|text| !text.is_empty())
            .map(|text| text.trim().to_string())
            .ok_or_else(|| "Unexpected response from Google Gemini".to_string())
    }

    /// Send a built request and read the JSON body, turning a transport or HTTP failure into a
    /// message naming the provider — which is the only way the user can tell whose key is wrong.
    async fn send(
        &self,
        request: reqwest::RequestBuilder,
        provider: AiProvider,
    ) -> Result<Value, String> {
        let resp = request.send().await.map_err(|e| {
            error!("{} API request failed: {:?}", provider.label(), e);
            format!("{} request failed: {}", provider.label(), e)
        })?;

        if !resp.status().is_success() {
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            error!("{} API error {}: {}", provider.label(), status, text);
            return Err(format!(
                "{} returned {}: {}",
                provider.label(),
                status,
                provider_error_message(&text).unwrap_or(text)
            ));
        }

        resp.json().await.map_err(|e| {
            error!("Failed to parse {} response: {:?}", provider.label(), e);
            format!("Failed to parse the {} response: {}", provider.label(), e)
        })
    }
}

/// Pull the human-readable half out of a provider's error body.
///
/// All three nest it under `error`, either as a string or as an object with a `message`; anything
/// else is passed through as-is rather than swallowed.
fn provider_error_message(body: &str) -> Option<String> {
    let json: Value = serde_json::from_str(body).ok()?;
    let error = json.get("error")?;
    error
        .get("message")
        .and_then(|m| m.as_str())
        .or_else(|| error.as_str())
        .map(|m| m.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_the_message_from_a_provider_error_body() {
        let body = r#"{"error":{"type":"authentication_error","message":"invalid x-api-key"}}"#;
        assert_eq!(
            provider_error_message(body).as_deref(),
            Some("invalid x-api-key")
        );
    }

    #[test]
    fn passes_through_a_body_it_cannot_read() {
        assert_eq!(provider_error_message("<html>502</html>"), None);
    }

    #[actix_web::test]
    async fn refuses_to_call_a_provider_without_a_key() {
        let client = AiClient::new();
        let creds = AiCredentials {
            provider: AiProvider::Openai,
            api_key: String::new(),
        };
        let err = client
            .complete(&creds, "hello", 16)
            .await
            .expect_err("no key");
        assert!(err.contains("Settings → AI Assistant"), "{err}");
    }
}
