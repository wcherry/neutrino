use crate::slides::ai::claude_client::ClaudeClient;
use serde::{Deserialize, Serialize};
use tracing::error;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageResult {
    pub id: String,
    pub name: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub url: String,
}

pub struct SlidesAIService {
    claude: Option<ClaudeClient>,
    drive_url: String,
    http_client: reqwest::Client,
}

impl SlidesAIService {
    pub fn new(claude: Option<ClaudeClient>) -> Self {
        let drive_url = std::env::var("DRIVE_URL")
            .unwrap_or_else(|_| "http://localhost:8080".to_string());
        SlidesAIService {
            claude,
            drive_url,
            http_client: reqwest::Client::new(),
        }
    }

    fn get_claude(&self) -> Result<&ClaudeClient, String> {
        self.claude
            .as_ref()
            .ok_or_else(|| "AI features require ANTHROPIC_API_KEY to be configured".to_string())
    }

    pub async fn smart_compose(&self, slide_text: &str) -> Result<String, String> {
        let claude = self.get_claude()?;

        let prompt = format!(
            "You are a presentation writing assistant. Complete or improve the following slide text to make it more professional and concise:\n\n{}\n\nReturn only the completed/improved text, no explanation.",
            slide_text
        );

        claude.complete(&prompt, 512).await
    }

    pub async fn search_images(
        &self,
        query: &str,
        token: &str,
    ) -> Result<Vec<ImageResult>, String> {
        // Search the internal Drive API for images matching the query
        // Encode query for URL inclusion
        let encoded_query: String = query
            .chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' || c == '.' { c.to_string() } else { format!("%{:02X}", c as u32) })
            .collect();
        let url = format!(
            "{}/api/v1/drive/files?mime_type=image&name={}&limit=20",
            self.drive_url,
            encoded_query
        );

        let resp = self
            .http_client
            .get(&url)
            .header("Authorization", format!("Bearer {}", token))
            .send()
            .await
            .map_err(|e| {
                error!("Drive API image search request failed: {:?}", e);
                // Return empty results gracefully if drive is unavailable
                "Drive service unavailable".to_string()
            });

        match resp {
            Err(_) => Ok(vec![]),
            Ok(r) if !r.status().is_success() => Ok(vec![]),
            Ok(r) => {
                let json: serde_json::Value = r.json().await.map_err(|_| {
                    "Failed to parse drive response".to_string()
                })?;
                let files = json["files"].as_array().cloned().unwrap_or_default();
                let results = files
                    .into_iter()
                    .filter_map(|f| {
                        let id = f["id"].as_str()?.to_string();
                        let name = f["name"].as_str()?.to_string();
                        let mime_type = f["mimeType"].as_str()?.to_string();
                        let size_bytes = f["sizeBytes"].as_i64().unwrap_or(0);
                        let url = format!("/api/v1/drive/files/{}/preview", id);
                        Some(ImageResult { id, name, mime_type, size_bytes, url })
                    })
                    .collect();
                Ok(results)
            }
        }
    }

    pub async fn help_design(&self, slide_content: &str) -> Result<serde_json::Value, String> {
        let claude = self.get_claude()?;

        let prompt = format!(
            "You are a presentation design assistant. Analyze the following slide content and suggest an optimal layout:\n\n{}\n\nReturn a JSON object with these fields:\n- layout: string (one of: 'title', 'title-content', 'two-column', 'blank', 'image-text')\n- colorScheme: object with 'primary', 'secondary', 'accent', 'background' hex color strings\n- fontSuggestions: object with 'heading' and 'body' font family strings\n- tips: array of strings (design improvement tips)\n\nReturn only the JSON object, no explanation.",
            slide_content
        );

        let response = claude.complete(&prompt, 1024).await?;

        let trimmed = response.trim();
        let json_start = trimmed.find('{').unwrap_or(0);
        let json_end = trimmed.rfind('}').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        serde_json::from_str::<serde_json::Value>(json_str).map_err(|e| {
            error!("Failed to parse help_design response as JSON: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })
    }

    pub async fn auto_format(&self, slide_json: &str) -> Result<serde_json::Value, String> {
        let claude = self.get_claude()?;

        let prompt = format!(
            "You are a presentation layout optimizer. Here is a slide in JSON format:\n{}\n\nReturn an improved version of this slide JSON with balanced layout, proper spacing, and visual hierarchy. Adjust element positions (x, y, w, h as percentages 0-100) and text sizes for best readability. Return only the JSON object matching the same structure, no explanation.",
            slide_json
        );

        let response = claude.complete(&prompt, 2048).await?;

        let trimmed = response.trim();
        let json_start = trimmed.find('{').unwrap_or(0);
        let json_end = trimmed.rfind('}').map(|i| i + 1).unwrap_or(trimmed.len());
        let json_str = &trimmed[json_start..json_end];

        serde_json::from_str::<serde_json::Value>(json_str).map_err(|e| {
            error!("Failed to parse auto_format response as JSON: {:?}", e);
            format!("Failed to parse AI response: {}", e)
        })
    }
}
