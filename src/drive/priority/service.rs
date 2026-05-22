use crate::shared::{ApiError, DbPool};
use super::dto::*;
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::*;

pub struct PriorityService {
    pool: DbPool,
}

impl PriorityService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn get_quick_access(&self, user_id: &str, limit: i64) -> Result<Vec<QuickAccessItem>, ApiError> {
        let conn = &mut self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })?;

        #[derive(QueryableByName)]
        struct ScoredFile {
            #[diesel(sql_type = Text)]
            file_id: String,
            #[diesel(sql_type = Double)]
            score: f64,
        }

        let cutoff = chrono::Utc::now().naive_utc() - chrono::Duration::days(30);

        // Try to use file_activity_log if it exists; fall back gracefully
        let scored: Vec<ScoredFile> = sql_query(format!(
            "SELECT f.id as file_id, \
                (COUNT(CASE WHEN al.action_type = 'view' THEN 1 END) * 1.0 \
                 + COUNT(CASE WHEN al.action_type = 'edit' THEN 1 END) * 2.0 \
                 + COALESCE(f.is_starred, 0) * 3.0 \
                 + (1.0 / (1.0 + CAST((julianday('now') - julianday(MAX(al.created_at))) AS REAL))) * 10.0 \
                ) as score \
             FROM files f \
             LEFT JOIN file_activity_log al ON al.file_id = f.id AND al.user_id = '{user_id}' AND al.created_at > '{}' \
             WHERE f.user_id = '{user_id}' AND f.deleted_at IS NULL \
             GROUP BY f.id \
             HAVING score > 0 \
             ORDER BY score DESC \
             LIMIT {limit}",
            cutoff.format("%Y-%m-%d %H:%M:%S")
        ))
        .load(conn)
        .unwrap_or_default();

        if scored.is_empty() {
            // Fall back to recently modified files
            let recent = crate::schema::files::table
                .filter(crate::schema::files::user_id.eq(user_id))
                .filter(crate::schema::files::deleted_at.is_null())
                .order(crate::schema::files::updated_at.desc())
                .limit(limit)
                .load::<crate::drive::storage::model::FileRecord>(conn)?;
            return Ok(recent
                .into_iter()
                .map(|f| QuickAccessItem {
                    id: f.id,
                    name: f.name,
                    mime_type: f.mime_type,
                    size_bytes: f.size_bytes,
                    updated_at: f.updated_at.to_string(),
                    score: 0.0,
                })
                .collect());
        }

        let file_ids: Vec<String> = scored.iter().map(|s| s.file_id.clone()).collect();
        let score_map: std::collections::HashMap<String, f64> =
            scored.into_iter().map(|s| (s.file_id, s.score)).collect();

        let file_rows: Vec<crate::drive::storage::model::FileRecord> = crate::schema::files::table
            .filter(crate::schema::files::id.eq_any(&file_ids))
            .filter(crate::schema::files::deleted_at.is_null())
            .load(conn)?;

        let mut items: Vec<QuickAccessItem> = file_rows
            .into_iter()
            .map(|f| {
                let score = score_map.get(&f.id).copied().unwrap_or(0.0);
                QuickAccessItem {
                    id: f.id,
                    name: f.name,
                    mime_type: f.mime_type,
                    size_bytes: f.size_bytes,
                    updated_at: f.updated_at.to_string(),
                    score,
                }
            })
            .collect();
        items.sort_by(|a, b| {
            b.score
                .partial_cmp(&a.score)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
        Ok(items)
    }

    pub fn get_suggested_collaborators(&self, user_id: &str) -> Result<Vec<SuggestedCollaborator>, ApiError> {
        #[derive(QueryableByName)]
        struct CollabRow {
            #[diesel(sql_type = Text)]
            collab_user_id: String,
            #[diesel(sql_type = Text)]
            name: String,
            #[diesel(sql_type = Text)]
            email: String,
            #[diesel(sql_type = BigInt)]
            share_count: i64,
        }

        let conn = &mut self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })?;
        let results: Vec<CollabRow> = sql_query(format!(
            "SELECT p.user_id as collab_user_id, u.name, u.email, COUNT(*) as share_count \
             FROM permissions p \
             JOIN users u ON u.id = p.user_id \
             WHERE p.granted_by = '{user_id}' AND p.user_id != '{user_id}' \
             GROUP BY p.user_id \
             ORDER BY share_count DESC \
             LIMIT 5"
        ))
        .load(conn)
        .unwrap_or_default();

        Ok(results
            .into_iter()
            .map(|r| SuggestedCollaborator {
                user_id: r.collab_user_id,
                name: r.name,
                email: r.email,
                shared_file_count: r.share_count,
            })
            .collect())
    }

    pub fn get_suggested_actions(&self, user_id: &str, file_id: &str) -> Result<Vec<SuggestedAction>, ApiError> {
        let conn = &mut self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })?;
        let mut actions = Vec::new();

        // Check for unresolved comments mentioning user (graceful if table missing)
        #[derive(QueryableByName)]
        struct CommentMention {
            #[diesel(sql_type = Text)]
            comment_id: String,
        }
        let mentions: Vec<CommentMention> = sql_query(format!(
            "SELECT c.id as comment_id FROM comments c \
             WHERE c.file_id = '{file_id}' AND c.resolved_at IS NULL AND c.content LIKE '%@{user_id}%' \
             LIMIT 1"
        ))
        .load(conn)
        .unwrap_or_default();

        if !mentions.is_empty() {
            actions.push(SuggestedAction {
                file_id: file_id.to_string(),
                action_type: "reply_comment".to_string(),
                label: "Reply to comment".to_string(),
                target_id: Some(mentions[0].comment_id.clone()),
            });
        }

        // Check for pending suggestions (graceful if table missing)
        #[derive(QueryableByName)]
        struct SuggestionCount {
            #[diesel(sql_type = BigInt)]
            count: i64,
        }
        let sugg_count: Vec<SuggestionCount> = sql_query(format!(
            "SELECT COUNT(*) as count FROM doc_suggestions \
             WHERE file_id = '{file_id}' AND status = 'pending' LIMIT 1"
        ))
        .load(conn)
        .unwrap_or_default();

        if sugg_count.first().map(|r| r.count).unwrap_or(0) > 0 {
            actions.push(SuggestedAction {
                file_id: file_id.to_string(),
                action_type: "view_changes".to_string(),
                label: "View suggested changes".to_string(),
                target_id: None,
            });
        }

        Ok(actions)
    }
}
