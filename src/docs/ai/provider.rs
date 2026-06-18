use crate::shared::ApiError;
use async_trait::async_trait;

/// Abstraction over AI text-completion providers.
#[async_trait]
pub trait AiProvider: Send + Sync {
    /// Complete the given prompt with at most `max_tokens` output tokens.
    async fn complete(&self, prompt: &str, max_tokens: u32) -> Result<String, ApiError>;
}

/// Which provider to use for an AI request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProviderKind {
    Claude,
    OpenAi,
    Gemini,
}

impl ProviderKind {
    /// Parse a provider name string (case-insensitive) returning the enum.
    pub fn from_str(s: &str) -> Option<Self> {
        match s.to_ascii_lowercase().as_str() {
            "claude" | "anthropic" => Some(Self::Claude),
            "openai" | "gpt" => Some(Self::OpenAi),
            "gemini" | "google" => Some(Self::Gemini),
            _ => None,
        }
    }
}
