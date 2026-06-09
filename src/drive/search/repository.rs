#![allow(dead_code)]

use super::model::*;
use crate::schema::file_content_index;
use crate::shared::{ApiError, DbPool};
use diesel::prelude::*;
use diesel::sql_query;
use diesel::sql_types::*;

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

pub struct SearchRepository;

impl SearchRepository {
    pub fn upsert_content_index(
        pool: &DbPool,
        file_id: &str,
        user_id: &str,
        text: &str,
    ) -> Result<(), ApiError> {
        let conn = &mut get_conn(pool)?;
        let now = chrono::Utc::now().naive_utc();

        diesel::insert_into(file_content_index::table)
            .values(NewContentIndex {
                file_id: file_id.to_string(),
                user_id: user_id.to_string(),
                indexed_at: now,
                text_content: text.to_string(),
            })
            .on_conflict(file_content_index::file_id)
            .do_update()
            .set((
                file_content_index::text_content.eq(text),
                file_content_index::indexed_at.eq(now),
            ))
            .execute(conn)?;

        // Update FTS index using sql_query (two separate statements)
        let escaped_id = file_id.replace('\'', "''");
        sql_query(format!(
            "DELETE FROM file_fts WHERE file_id = '{escaped_id}'"
        ))
        .execute(conn)
        .ok();
        sql_query(format!(
            "INSERT INTO file_fts(file_id, user_id, name, content) \
             SELECT file_id, user_id, '', text_content FROM file_content_index WHERE file_id = '{escaped_id}'"
        ))
        .execute(conn)
        .ok();

        Ok(())
    }

    pub fn upsert_name_in_fts(
        pool: &DbPool,
        file_id: &str,
        user_id: &str,
        name: &str,
    ) -> Result<(), ApiError> {
        let conn = &mut get_conn(pool)?;
        // Check if content index exists for this file
        let content: Option<ContentIndex> = file_content_index::table
            .find(file_id)
            .first(conn)
            .optional()?;
        let text_content = content.map(|c| c.text_content).unwrap_or_default();
        let escaped_file_id = file_id.replace('\'', "''");
        let escaped_name = name.replace('\'', "''");
        let escaped_content = text_content.replace('\'', "''");
        let escaped_user_id = user_id.replace('\'', "''");
        sql_query(format!(
            "DELETE FROM file_fts WHERE file_id = '{escaped_file_id}'"
        ))
        .execute(conn)
        .ok();
        sql_query(format!(
            "INSERT INTO file_fts(file_id, user_id, name, content) \
             VALUES('{escaped_file_id}', '{escaped_user_id}', '{escaped_name}', '{escaped_content}')"
        ))
        .execute(conn)
        .ok();
        Ok(())
    }

    pub fn delete_from_fts(pool: &DbPool, file_id: &str) -> Result<(), ApiError> {
        let conn = &mut get_conn(pool)?;
        let escaped = file_id.replace('\'', "''");
        sql_query(format!("DELETE FROM file_fts WHERE file_id = '{escaped}'"))
            .execute(conn)
            .ok();
        diesel::delete(file_content_index::table.find(file_id)).execute(conn)?;
        Ok(())
    }

    pub fn search(
        pool: &DbPool,
        user_id: &str,
        fts_query: &str,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<(String, Option<String>)>, ApiError> {
        let conn = &mut get_conn(pool)?;
        let escaped_query = fts_query.replace('\'', "''");
        let escaped_user = user_id.replace('\'', "''");

        #[derive(QueryableByName)]
        struct Row {
            #[diesel(sql_type = Text)]
            file_id: String,
            #[diesel(sql_type = Nullable<Text>)]
            snippet: Option<String>,
        }

        let results: Vec<(String, Option<String>)> = sql_query(format!(
            "SELECT file_id, snippet(file_fts, 2, '<mark>', '</mark>', '...', 30) as snippet \
             FROM file_fts \
             WHERE user_id = '{escaped_user}' AND file_fts MATCH '{escaped_query}' \
             ORDER BY rank \
             LIMIT {limit} OFFSET {offset}"
        ))
        .load::<Row>(conn)
        .unwrap_or_default()
        .into_iter()
        .map(|r| (r.file_id, r.snippet))
        .collect();

        Ok(results)
    }
}
