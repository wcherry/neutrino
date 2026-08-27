use crate::shared::{AiClient, AiCredentials, ApiError};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Serialize, Deserialize)]
pub struct DetectedObject {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    pub label: String,
}

pub struct PhotosAIService {
    ai: Arc<AiClient>,
}

impl PhotosAIService {
    pub fn new(ai: Arc<AiClient>) -> Self {
        Self { ai }
    }

    /// Ask the caller's configured provider about an image.
    ///
    /// Every route here is a vision prompt, and every one of them fails the same way — no key
    /// configured, or the provider refusing the call — so they all report it as `AI_UNAVAILABLE`
    /// rather than as a fault of this server.
    async fn ask(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        prompt: &str,
        max_tokens: u32,
    ) -> Result<String, ApiError> {
        self.ai
            .complete_with_vision(credentials, image_base64, media_type, prompt, max_tokens)
            .await
            .map_err(|e| ApiError::new(503, "AI_UNAVAILABLE", e))
    }

    pub async fn ocr(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
    ) -> Result<String, ApiError> {
        let prompt = "Extract all text visible in this image. \
            Output only the extracted text, preserving line breaks and structure where possible. \
            If no text is found, respond with an empty string.";
        self.ask(credentials, image_base64, media_type, prompt, 2048)
            .await
    }

    pub async fn screenshot_intelligence(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        output_type: &str,
    ) -> Result<String, ApiError> {
        let prompt = match output_type {
            "table" => "Convert the content of this screenshot into a Markdown table. \
                Output only the Markdown table, nothing else.",
            "document" => "Convert the content of this screenshot into a clean Markdown document. \
                Preserve headings, lists, and paragraphs. Output only the Markdown, nothing else.",
            "diagram" => "Describe the structure or diagram in this screenshot as a Mermaid diagram. \
                Output only the Mermaid code block (```mermaid ... ```), nothing else.",
            _ => return Err(ApiError::bad_request("Invalid output_type")),
        };
        self.ask(credentials, image_base64, media_type, prompt, 4096)
            .await
    }

    pub async fn detect_objects(
        &self,
        credentials: &AiCredentials,
        image_base64: &str,
        media_type: &str,
        target: &str,
    ) -> Result<Vec<DetectedObject>, ApiError> {
        let target_desc = match target {
            "people" => "people, persons, and humans",
            "power_lines" => "power lines, electrical cables, utility wires, and telephone lines strung between poles",
            "cars" => "vehicles including cars, trucks, buses, and motorcycles",
            "clutter" => "distracting background clutter, signs, garbage, and unwanted objects",
            _ => return Err(ApiError::bad_request("Invalid target")),
        };
        let prompt = format!(
            "Detect all {} in this image. \
            Return a JSON array where each element has these exact keys: \
            \"x\" (left edge as a 0.0–1.0 fraction of image width), \
            \"y\" (top edge as a 0.0–1.0 fraction of image height), \
            \"w\" (width as a 0.0–1.0 fraction), \
            \"h\" (height as a 0.0–1.0 fraction), \
            \"label\" (a short string like \"person\" or \"power line\"). \
            If none are found return []. Output only valid JSON with no markdown fences.",
            target_desc
        );
        let raw = self
            .ask(credentials, image_base64, media_type, &prompt, 1024)
            .await?;

        let trimmed = raw.trim();
        let json = trimmed
            .trim_start_matches("```json")
            .trim_start_matches("```")
            .trim_end_matches("```")
            .trim();

        serde_json::from_str::<Vec<DetectedObject>>(json)
            .map_err(|_| ApiError::internal("Failed to parse object detection result"))
    }
}
