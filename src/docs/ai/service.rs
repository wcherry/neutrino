use std::sync::Arc;

use crate::shared::get_env_or_secret;

use super::claude_client::ClaudeClient;
use super::gemini_client::GeminiClient;
use super::openai_client::OpenAiClient;
use super::provider::{AiProvider, ProviderKind};
use crate::shared::ApiError;

// ── Provider request options ──────────────────────────────────────────────────

/// Per-request provider override.  When `provider` and `api_key` are both
/// provided we construct an ephemeral client; otherwise we fall back to the
/// service's default provider.
pub struct ProviderOptions {
    pub provider: Option<String>,
    pub api_key: Option<String>,
}

// ── Service ───────────────────────────────────────────────────────────────────

pub struct DocsAIService {
    /// Default provider resolved at startup from env vars.
    default_provider: Arc<dyn AiProvider>,
}

impl DocsAIService {
    pub fn new() -> Self {
        let default_provider: Arc<dyn AiProvider> = resolve_default_provider();
        Self { default_provider }
    }

    /// Resolve the effective provider for this request.
    fn resolve_provider(&self, opts: &ProviderOptions) -> Result<Arc<dyn AiProvider>, ApiError> {
        match (&opts.provider, &opts.api_key) {
            (Some(provider_str), Some(key)) if !key.is_empty() => {
                // Caller supplied an explicit provider + key — use it.
                let kind = ProviderKind::from_str(provider_str).ok_or_else(|| {
                    ApiError::bad_request(format!("Unknown provider: {provider_str}"))
                })?;
                Ok(build_provider(kind, key.clone()))
            }
            (Some(provider_str), _) => {
                // Provider name given but no key — try env for that provider.
                let kind = ProviderKind::from_str(provider_str).ok_or_else(|| {
                    ApiError::bad_request(format!("Unknown provider: {provider_str}"))
                })?;
                match kind {
                    ProviderKind::Claude => {
                        let key = get_env_or_secret("ANTHROPIC_API_KEY")
                            .map_err(|_| ApiError::bad_request("ANTHROPIC_API_KEY not configured"))?;
                        Ok(build_provider(ProviderKind::Claude, key))
                    }
                    ProviderKind::OpenAi => {
                        let key = get_env_or_secret("OPENAI_API_KEY")
                            .map_err(|_| ApiError::bad_request("OPENAI_API_KEY not configured"))?;
                        Ok(build_provider(ProviderKind::OpenAi, key))
                    }
                    ProviderKind::Gemini => {
                        // Gemini is usable without a key (free tier).
                        let key = get_env_or_secret("GEMINI_API_KEY").unwrap_or_default();
                        Ok(build_provider(ProviderKind::Gemini, key))
                    }
                }
            }
            _ => Ok(Arc::clone(&self.default_provider)),
        }
    }

    // ── Public operations ─────────────────────────────────────────────────────

    pub async fn smart_compose(
        &self,
        context: &str,
        opts: ProviderOptions,
    ) -> Result<String, ApiError> {
        let provider = self.resolve_provider(&opts)?;
        let prompt = format!(
            "Continue this text naturally with one sentence completion (just the continuation, no explanation):\n\n{context}"
        );
        provider.complete(&prompt, 100).await
    }

    pub async fn translate(
        &self,
        content: &str,
        target_lang: &str,
        opts: ProviderOptions,
    ) -> Result<String, ApiError> {
        let provider = self.resolve_provider(&opts)?;
        let prompt = format!(
            "Translate this document content to {target_lang}. If it's JSON (TipTap format), translate only the text values while preserving the JSON structure. Return only the translated content.\n\nContent:\n{content}"
        );
        provider.complete(&prompt, 2000).await
    }

    pub async fn help_me_write(
        &self,
        description: &str,
        opts: ProviderOptions,
    ) -> Result<String, ApiError> {
        let provider = self.resolve_provider(&opts)?;
        let prompt = format!(
            "Write a document based on this description: \"{description}\". Return the content as plain text formatted with markdown. Be comprehensive and well-structured."
        );
        provider.complete(&prompt, 1500).await
    }

    pub async fn summarize(
        &self,
        content: &str,
        selected_text: Option<&str>,
        opts: ProviderOptions,
    ) -> Result<String, ApiError> {
        let provider = self.resolve_provider(&opts)?;
        let target = selected_text.unwrap_or(content);
        let text = if target.len() > 3000 {
            &target[..3000]
        } else {
            target
        };
        let context_note = if selected_text.is_some() {
            "This is an excerpt from a larger document. Summarize only the excerpt."
        } else {
            ""
        };
        let prompt = format!(
            "Summarize this document in 3-5 bullet points. {context_note}\n\n{text}"
        );
        provider.complete(&prompt, 300).await
    }

    /// Suggest the next sentence or paragraph after the current content.
    pub async fn suggestions(
        &self,
        content: &str,
        selected_text: Option<&str>,
        opts: ProviderOptions,
    ) -> Result<String, ApiError> {
        let provider = self.resolve_provider(&opts)?;
        let context = selected_text.unwrap_or(content);
        // Trim to last 2000 chars to keep the prompt focused on recent context.
        let recent = if context.len() > 2000 {
            &context[context.len() - 2000..]
        } else {
            context
        };
        let prompt = format!(
            "Based on the following text, suggest a natural continuation — one or two sentences or a short paragraph that follows on well. Output only the suggestion itself, no preamble:\n\n{recent}"
        );
        provider.complete(&prompt, 200).await
    }

    /// Rewrite the content with the given tone parameters.
    ///
    /// * `formal`   — 0 = informal, 100 = formal
    /// * `cheerful` — 0 = reserved, 100 = cheerful
    /// * `verbose`  — 0 = succinct, 100 = verbose
    pub async fn change_tone(
        &self,
        content: &str,
        selected_text: Option<&str>,
        formal: u8,
        cheerful: u8,
        verbose: u8,
        opts: ProviderOptions,
    ) -> Result<String, ApiError> {
        let provider = self.resolve_provider(&opts)?;
        let target = selected_text.unwrap_or(content);
        let text = if target.len() > 3000 {
            &target[..3000]
        } else {
            target
        };

        let formality = if formal > 66 {
            "formal and professional"
        } else if formal < 33 {
            "informal and conversational"
        } else {
            "neutral in formality"
        };

        let mood = if cheerful > 66 {
            "warm and cheerful"
        } else if cheerful < 33 {
            "reserved and matter-of-fact"
        } else {
            "balanced in tone"
        };

        let length = if verbose > 66 {
            "elaborate and detailed, expanding on ideas"
        } else if verbose < 33 {
            "concise and succinct, keeping it brief"
        } else {
            "similar in length"
        };

        let prompt = format!(
            "Rewrite the following text to be {formality}, {mood}, and {length}. \
             Preserve the original meaning and information. Output only the rewritten text:\n\n{text}"
        );
        provider.complete(&prompt, 1500).await
    }
}

// ── Provider resolution helpers ───────────────────────────────────────────────

fn build_provider(kind: ProviderKind, key: String) -> Arc<dyn AiProvider> {
    match kind {
        ProviderKind::Claude => Arc::new(ClaudeClient::new(key)),
        ProviderKind::OpenAi => Arc::new(OpenAiClient::new(key)),
        ProviderKind::Gemini => Arc::new(GeminiClient::new(key)),
    }
}

/// Choose the default provider at startup based on env vars.
///
/// Priority:
/// 1. `DEFAULT_AI_PROVIDER` env var + matching key env var
/// 2. `ANTHROPIC_API_KEY` (Claude)
/// 3. `GEMINI_API_KEY` (Gemini) — or Gemini free tier
fn resolve_default_provider() -> Arc<dyn AiProvider> {
    // 1. Explicit default configured
    if let Ok(default) = get_env_or_secret("DEFAULT_AI_PROVIDER") {
        if let Some(kind) = ProviderKind::from_str(&default) {
            let key = match &kind {
                ProviderKind::Claude => get_env_or_secret("ANTHROPIC_API_KEY").unwrap_or_default(),
                ProviderKind::OpenAi => get_env_or_secret("OPENAI_API_KEY").unwrap_or_default(),
                ProviderKind::Gemini => get_env_or_secret("GEMINI_API_KEY").unwrap_or_default(),
            };
            return build_provider(kind, key);
        }
    }

    // 2. Claude key present
    if let Ok(key) = get_env_or_secret("ANTHROPIC_API_KEY") {
        return Arc::new(ClaudeClient::new(key));
    }

    // 3. Gemini (free tier or explicit key)
    let gemini_key = get_env_or_secret("GEMINI_API_KEY").unwrap_or_default();
    Arc::new(GeminiClient::new(gemini_key))
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── ProviderKind::from_str ─────────────────────────────────────────────────

    #[test]
    fn provider_kind_from_str_claude() {
        assert_eq!(ProviderKind::from_str("claude"), Some(ProviderKind::Claude));
        assert_eq!(ProviderKind::from_str("anthropic"), Some(ProviderKind::Claude));
        assert_eq!(ProviderKind::from_str("Claude"), Some(ProviderKind::Claude));
    }

    #[test]
    fn provider_kind_from_str_openai() {
        assert_eq!(ProviderKind::from_str("openai"), Some(ProviderKind::OpenAi));
        assert_eq!(ProviderKind::from_str("gpt"), Some(ProviderKind::OpenAi));
    }

    #[test]
    fn provider_kind_from_str_gemini() {
        assert_eq!(ProviderKind::from_str("gemini"), Some(ProviderKind::Gemini));
        assert_eq!(ProviderKind::from_str("google"), Some(ProviderKind::Gemini));
    }

    #[test]
    fn provider_kind_from_str_unknown() {
        assert_eq!(ProviderKind::from_str("unknown"), None);
        assert_eq!(ProviderKind::from_str(""), None);
    }
}
