use super::credentials::{AiCredentials, AiProvider};
use serde_json::{json, Value};
use tracing::error;

/// The model each provider is called with.
///
/// One place for all three, so a model move is a line here rather than a hunt through four app
/// modules. Each is that provider's small, fast tier: every one of these prompts is short and
/// wants a quick, cheaply-priced answer, and the bill lands on the user's own key.
///
/// Pinned to explicit versions, deliberately. Google publishes a `gemini-flash-latest` alias, but
/// it can point at a preview or experimental release and is hot-swapped with two weeks' notice —
/// a product default should not move under a deployment that way. The cost of pinning is that a
/// retired model 404s until this line is updated, which is what happened to `gemini-1.5-flash`.
const CLAUDE_MODEL: &str = "claude-haiku-4-5-20251001";
const OPENAI_MODEL: &str = "gpt-4o-mini";
const GEMINI_MODEL: &str = "gemini-3.5-flash";

/// Extra output budget handed to Gemini on top of what the caller asked for.
///
/// Gemini 3 thinks before it answers and the thinking counts against `maxOutputTokens`, so
/// asking for exactly the caller's budget spends most of it before the answer starts and returns
/// a reply cut off mid-sentence — for a diagram, JSON that ends part-way through an array. The
/// thinking gets its own allowance instead, and is kept short: these prompts are mechanical
/// (fill in a shape, fix a sentence, emit a config), not problems to reason about.
const GEMINI_THINKING_HEADROOM: u32 = 8192;

/// Gemini's `generationConfig`, sized for a caller that wants `max_tokens` of actual answer.
fn gemini_generation_config(max_tokens: u32) -> Value {
    json!({
        "maxOutputTokens": max_tokens.saturating_add(GEMINI_THINKING_HEADROOM),
        "thinkingConfig": { "thinkingLevel": "low" },
    })
}

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
                    "generationConfig": gemini_generation_config(max_tokens),
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
                        "generationConfig": gemini_generation_config(max_tokens),
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

        extract_claude(&json)
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

        extract_openai(&json)
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

        extract_gemini(&json)
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

/// What a provider says when it stopped because the answer hit the output budget.
///
/// A truncated answer is a success as far as HTTP is concerned, and the caller only finds out
/// when whatever it parses out of the text ends mid-structure — "EOF while parsing a list" from a
/// half-written diagram, which says nothing about what went wrong or what to do. Every provider
/// reports it, under its own name, so it is read here and reported as itself.
fn truncation_error(provider: AiProvider) -> String {
    format!(
        "{} ran out of room before finishing its answer. Try a shorter or simpler request.",
        provider.label()
    )
}

fn extract_claude(json: &Value) -> Result<String, String> {
    if json["stop_reason"] == "max_tokens" {
        return Err(truncation_error(AiProvider::Claude));
    }

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

fn extract_openai(json: &Value) -> Result<String, String> {
    let choice = &json["choices"][0];
    if choice["finish_reason"] == "length" {
        return Err(truncation_error(AiProvider::Openai));
    }

    choice["message"]["content"]
        .as_str()
        .map(|text| text.trim().to_string())
        .ok_or_else(|| "Unexpected response from OpenAI".to_string())
}

fn extract_gemini(json: &Value) -> Result<String, String> {
    let candidate = &json["candidates"][0];
    // `MAX_TOKENS` covers the thinking having eaten the budget as well as a genuinely long
    // answer — either way what came back is a fragment, so it is not worth parsing.
    if candidate["finishReason"] == "MAX_TOKENS" {
        return Err(truncation_error(AiProvider::Gemini));
    }

    candidate["content"]["parts"]
        .as_array()
        .map(|parts| {
            parts
                .iter()
                // A thinking model returns its reasoning as parts marked `thought`; only the
                // answer belongs to the caller.
                .filter(|p| p["thought"] != true)
                .filter_map(|p| p["text"].as_str())
                .collect::<Vec<_>>()
                .join("")
        })
        .filter(|text| !text.trim().is_empty())
        .map(|text| text.trim().to_string())
        .ok_or_else(|| "Unexpected response from Google Gemini".to_string())
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
    fn gemini_gets_its_thinking_paid_for_on_top_of_the_answer() {
        // Asking Gemini for exactly the caller's budget is what truncated a diagram mid-array.
        let config = gemini_generation_config(4096);
        assert_eq!(config["maxOutputTokens"], 4096 + GEMINI_THINKING_HEADROOM);
        assert_eq!(config["thinkingConfig"]["thinkingLevel"], "low");
    }

    #[test]
    fn reports_a_truncated_answer_as_truncation() {
        // Each provider says it differently, and none of them fail the HTTP request over it.
        let gemini = extract_gemini(&json!({
            "candidates": [{
                "finishReason": "MAX_TOKENS",
                "content": { "parts": [{ "text": "{\"shapes\": [" }] },
            }]
        }));
        let claude = extract_claude(&json!({
            "stop_reason": "max_tokens",
            "content": [{ "type": "text", "text": "{\"shapes\": [" }],
        }));
        let openai = extract_openai(&json!({
            "choices": [{ "finish_reason": "length", "message": { "content": "{" } }],
        }));

        for (err, provider) in [
            (gemini, "Google Gemini"),
            (claude, "Anthropic Claude"),
            (openai, "OpenAI"),
        ] {
            let err = err.expect_err("truncated");
            assert!(err.contains(provider), "{err}");
            assert!(err.contains("ran out of room"), "{err}");
        }
    }

    #[test]
    fn reads_a_complete_answer_from_each_provider() {
        assert_eq!(
            extract_gemini(&json!({
                "candidates": [{
                    "finishReason": "STOP",
                    "content": { "parts": [{ "text": " done " }] },
                }]
            })),
            Ok("done".to_string())
        );
        assert_eq!(
            extract_claude(&json!({
                "stop_reason": "end_turn",
                "content": [{ "type": "text", "text": " done " }],
            })),
            Ok("done".to_string())
        );
        assert_eq!(
            extract_openai(&json!({
                "choices": [{ "finish_reason": "stop", "message": { "content": " done " } }],
            })),
            Ok("done".to_string())
        );
    }

    #[test]
    fn keeps_geminis_reasoning_out_of_the_answer() {
        // A thinking model marks its reasoning parts; returning them would put prose in front of
        // the JSON every caller parses.
        let text = extract_gemini(&json!({
            "candidates": [{
                "finishReason": "STOP",
                "content": { "parts": [
                    { "thought": true, "text": "First I will lay out the shapes…" },
                    { "text": "{\"shapes\":[]}" },
                ] },
            }]
        }))
        .expect("answer");
        assert_eq!(text, "{\"shapes\":[]}");
    }

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
