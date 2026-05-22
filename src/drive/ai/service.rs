use crate::shared::{ApiError, DbPool};
use super::claude_client::ClaudeClient;
use diesel::prelude::*;
use serde::Serialize;

fn get_conn(pool: &DbPool) -> Result<diesel::r2d2::PooledConnection<diesel::r2d2::ConnectionManager<SqliteConnection>>, ApiError> {
    pool.get().map_err(|e| {
        tracing::error!("DB pool error: {:?}", e);
        ApiError::internal("Database connection unavailable")
    })
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileSummary {
    pub file_id: String,
    pub summary: String,
    pub generated_at: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CatchMeUpResponse {
    pub summary: String,
    pub files_changed: Vec<ChangedFile>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub file_id: String,
    pub name: String,
    pub action_count: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DriveAnswerResponse {
    pub answer: String,
    pub sources: Vec<AnswerSource>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AnswerSource {
    pub file_id: String,
    pub name: String,
}

pub struct DriveAIService {
    pool: DbPool,
    claude: Option<ClaudeClient>,
}

impl DriveAIService {
    pub fn new(pool: DbPool) -> Self {
        Self {
            pool,
            claude: ClaudeClient::from_env(),
        }
    }

    fn require_claude(&self) -> Result<&ClaudeClient, ApiError> {
        self.claude.as_ref().ok_or_else(|| {
            ApiError::bad_request(
                "AI features require ANTHROPIC_API_KEY to be configured",
            )
        })
    }

    pub async fn get_file_summary(&self, file_id: &str, user_id: &str) -> Result<FileSummary, ApiError> {
        let claude = self.require_claude()?;
        let conn = &mut get_conn(&self.pool)?;

        // Check cache first
        use diesel::sql_query;
        use diesel::sql_types::*;
        #[derive(QueryableByName)]
        struct CachedSummary {
            #[diesel(sql_type = Text)]
            summary: String,
            #[diesel(sql_type = Text)]
            generated_at: String,
        }

        let cached: Vec<CachedSummary> = sql_query(format!(
            "SELECT fs.summary, CAST(fs.generated_at AS TEXT) as generated_at \
             FROM file_summaries fs \
             JOIN files f ON f.id = fs.file_id \
             WHERE fs.file_id = '{file_id}' AND f.user_id = '{user_id}' \
             AND fs.generated_at > datetime('now', '-24 hours')"
        ))
        .load(conn)
        .unwrap_or_default();

        if let Some(cached) = cached.into_iter().next() {
            return Ok(FileSummary {
                file_id: file_id.to_string(),
                summary: cached.summary,
                generated_at: cached.generated_at,
            });
        }

        // Get content from content index
        use crate::schema::file_content_index;
        let content: Option<String> = file_content_index::table
            .find(file_id)
            .select(file_content_index::text_content)
            .first(conn)
            .optional()?;

        let text_sample = content.unwrap_or_default();
        let text_sample = if text_sample.len() > 3000 {
            text_sample[..3000].to_string()
        } else {
            text_sample
        };

        if text_sample.trim().is_empty() {
            return Err(ApiError::not_found("No content available to summarize"));
        }

        let prompt = format!(
            "Summarize this document in 2-3 concise sentences. Focus on the main topic and key points.\n\nDocument content:\n{text_sample}"
        );

        let summary = claude.complete(&prompt, 200).await?;
        let now = chrono::Utc::now().naive_utc();

        // Cache the summary
        sql_query(format!(
            "INSERT OR REPLACE INTO file_summaries(file_id, summary, generated_at) \
             VALUES('{}', '{}', '{}')",
            file_id.replace('\'', "''"),
            summary.replace('\'', "''"),
            now.format("%Y-%m-%d %H:%M:%S")
        ))
        .execute(conn)
        .ok();

        Ok(FileSummary {
            file_id: file_id.to_string(),
            summary,
            generated_at: now.to_string(),
        })
    }

    pub async fn catch_me_up(&self, user_id: &str) -> Result<CatchMeUpResponse, ApiError> {
        let claude = self.require_claude()?;
        let conn = &mut get_conn(&self.pool)?;

        use diesel::sql_query;
        use diesel::sql_types::*;
        #[derive(QueryableByName)]
        struct ActivityRow {
            #[diesel(sql_type = Text)]
            file_id: String,
            #[diesel(sql_type = Text)]
            name: String,
            #[diesel(sql_type = BigInt)]
            action_count: i64,
            #[diesel(sql_type = Text)]
            action_types: String,
        }

        let rows: Vec<ActivityRow> = sql_query(format!(
            "SELECT al.file_id, f.name, COUNT(*) as action_count, \
             GROUP_CONCAT(DISTINCT al.action_type) as action_types \
             FROM file_activity_log al \
             JOIN files f ON f.id = al.file_id \
             WHERE f.user_id = '{user_id}' AND al.created_at > datetime('now', '-48 hours') \
             GROUP BY al.file_id, f.name \
             ORDER BY action_count DESC \
             LIMIT 10"
        ))
        .load(conn)
        .unwrap_or_default();

        let files_changed: Vec<ChangedFile> = rows
            .iter()
            .map(|r| ChangedFile {
                file_id: r.file_id.clone(),
                name: r.name.clone(),
                action_count: r.action_count,
            })
            .collect();

        if rows.is_empty() {
            return Ok(CatchMeUpResponse {
                summary: "No recent activity in the last 48 hours.".to_string(),
                files_changed,
            });
        }

        let activity_text = rows
            .iter()
            .map(|r| {
                format!(
                    "- \"{}\" had {} action(s): {}",
                    r.name, r.action_count, r.action_types
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let prompt = format!(
            "Summarize this Drive activity in 2-3 sentences as a quick update for the user:\n\n{activity_text}"
        );

        let summary = claude.complete(&prompt, 150).await?;

        Ok(CatchMeUpResponse {
            summary,
            files_changed,
        })
    }

    pub async fn answer_question(
        &self,
        user_id: &str,
        question: &str,
        search_service: &crate::drive::search::service::SearchService,
    ) -> Result<DriveAnswerResponse, ApiError> {
        let claude = self.require_claude()?;

        // Search for relevant files
        let search_query = crate::drive::search::dto::SearchQuery {
            q: question.to_string(),
            file_type: None,
            owner_id: None,
            after: None,
            before: None,
            shared_only: false,
            limit: 5,
            offset: 0,
        };

        let search_results = search_service.search(user_id, &search_query)?;

        let conn = &mut get_conn(&self.pool)?;

        // Build context from search results
        let mut context_parts = Vec::new();
        let mut sources = Vec::new();

        for item in &search_results.items {
            use crate::schema::file_content_index;
            let content: Option<String> = file_content_index::table
                .find(&item.id)
                .select(file_content_index::text_content)
                .first(conn)
                .optional()?;

            if let Some(text) = content {
                let snippet = if text.len() > 500 {
                    text[..500].to_string()
                } else {
                    text
                };
                context_parts.push(format!("File: {}\n{}", item.name, snippet));
                sources.push(AnswerSource {
                    file_id: item.id.clone(),
                    name: item.name.clone(),
                });
            }
        }

        if context_parts.is_empty() {
            return Ok(DriveAnswerResponse {
                answer: "I couldn't find any relevant documents to answer your question. Try uploading or creating relevant files first.".to_string(),
                sources: vec![],
            });
        }

        let context = context_parts.join("\n\n---\n\n");
        let prompt = format!(
            "Based on these documents from the user's Drive, answer this question: \"{question}\"\n\nDocuments:\n{context}\n\nProvide a concise, accurate answer based only on the provided documents."
        );

        let answer = claude.complete(&prompt, 400).await?;

        Ok(DriveAnswerResponse { answer, sources })
    }
}
