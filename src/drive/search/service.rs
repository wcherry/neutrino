#![allow(dead_code)]

use super::dto::*;
use super::repository::SearchRepository;
use crate::schema::files;
use crate::shared::{ApiError, DbPool};
use diesel::prelude::*;

pub struct SearchService {
    pool: DbPool,
}

impl SearchService {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn upsert_content_index(
        &self,
        file_id: &str,
        user_id: &str,
        text: &str,
    ) -> Result<(), ApiError> {
        SearchRepository::upsert_content_index(&self.pool, file_id, user_id, text)
    }

    pub fn index_file_name(
        &self,
        file_id: &str,
        user_id: &str,
        name: &str,
    ) -> Result<(), ApiError> {
        SearchRepository::upsert_name_in_fts(&self.pool, file_id, user_id, name)
    }

    pub fn delete_index(&self, file_id: &str) -> Result<(), ApiError> {
        SearchRepository::delete_from_fts(&self.pool, file_id)
    }

    pub fn search(&self, user_id: &str, query: &SearchQuery) -> Result<SearchResponse, ApiError> {
        // Build FTS query
        let fts_query = build_fts_query(&query.q);

        // Get FTS matches
        let fts_matches = if query.q.trim().is_empty() {
            vec![]
        } else {
            SearchRepository::search(&self.pool, user_id, &fts_query, query.limit * 3, 0)
                .unwrap_or_default()
        };

        let conn = &mut self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })?;

        let items: Vec<SearchResultItem> = if fts_matches.is_empty() && !query.q.trim().is_empty() {
            // Fallback: search file names using LIKE
            let search_pattern = format!("%{}%", query.q);
            let mut db_query = files::table
                .filter(files::user_id.eq(user_id))
                .filter(files::name.like(&search_pattern))
                .filter(files::deleted_at.is_null())
                .into_boxed();
            if let Some(ref ft) = query.file_type {
                db_query = db_query.filter(files::mime_type.like(format!("{ft}%")));
            }
            let rows: Vec<crate::drive::storage::model::FileRecord> = db_query
                .order(files::updated_at.desc())
                .limit(query.limit)
                .offset(query.offset)
                .load(conn)?;
            rows.into_iter()
                .map(|f| SearchResultItem {
                    id: f.id,
                    name: f.name,
                    mime_type: f.mime_type,
                    size_bytes: f.size_bytes,
                    created_at: f.created_at.to_string(),
                    updated_at: f.updated_at.to_string(),
                    user_id: f.user_id,
                    snippet: None,
                })
                .collect()
        } else {
            // Join FTS results with files metadata
            let file_ids: Vec<String> = fts_matches.iter().map(|(id, _)| id.clone()).collect();
            let snippet_map: std::collections::HashMap<String, Option<String>> =
                fts_matches.into_iter().collect();

            let mut db_query = files::table
                .filter(files::id.eq_any(&file_ids))
                .filter(files::user_id.eq(user_id))
                .filter(files::deleted_at.is_null())
                .into_boxed();
            if let Some(ref ft) = query.file_type {
                db_query = db_query.filter(files::mime_type.like(format!("{ft}%")));
            }
            let rows: Vec<crate::drive::storage::model::FileRecord> = db_query.load(conn)?;

            rows.into_iter()
                .map(|f| {
                    let snippet = snippet_map.get(&f.id).and_then(|s| s.clone());
                    SearchResultItem {
                        id: f.id.clone(),
                        name: f.name,
                        mime_type: f.mime_type,
                        size_bytes: f.size_bytes,
                        created_at: f.created_at.to_string(),
                        updated_at: f.updated_at.to_string(),
                        user_id: f.user_id,
                        snippet,
                    }
                })
                .collect()
        };

        let total = items.len() as i64;
        Ok(SearchResponse { items, total })
    }
}

fn build_fts_query(q: &str) -> String {
    let q = q.trim();
    if q.contains('"') {
        // User already used phrases
        q.to_string()
    } else {
        // Make each word a prefix match
        q.split_whitespace()
            .map(|w| format!("{w}*"))
            .collect::<Vec<_>>()
            .join(" ")
    }
}
