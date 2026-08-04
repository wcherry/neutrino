use super::claude_client::ClaudeClient;
use crate::shared::{ApiError, DbPool};
use diesel::prelude::*;
use serde::Serialize;

fn get_conn(
    pool: &DbPool,
) -> Result<
    diesel::r2d2::PooledConnection<diesel::r2d2::ConnectionManager<SqliteConnection>>,
    ApiError,
> {
    pool.get().map_err(|e| {
        tracing::error!("DB pool error: {:?}", e);
        ApiError::internal("Database connection unavailable")
    })
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
            ApiError::bad_request("AI features require ANTHROPIC_API_KEY to be configured")
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
}
