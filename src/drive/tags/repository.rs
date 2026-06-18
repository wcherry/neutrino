use crate::drive::storage::model::FileRecord;
use crate::drive::tags::model::{NewFileTag, NewTagRecord, TagRecord};
use crate::schema::{file_tags, files, tags};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use std::collections::HashMap;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct TagsRepository {
    pool: DbPool,
}

impl TagsRepository {
    pub fn new(pool: DbPool) -> Self {
        TagsRepository { pool }
    }

    // ── Tag CRUD ──────────────────────────────────────────────────────────────

    pub fn insert_tag(&self, new_tag: NewTagRecord) -> Result<TagRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_into(tags::table)
            .values(&new_tag)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert tag error: {:?}", e);
                if e.to_string().contains("UNIQUE") {
                    ApiError::new(409, "TAG_EXISTS", "A tag with that name already exists")
                } else {
                    ApiError::internal("Database error")
                }
            })?;

        tags::table
            .filter(tags::id.eq(new_tag.id))
            .select(TagRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch tag after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn find_tag(&self, tag_id: &str, user_id: &str) -> Result<Option<TagRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        tags::table
            .filter(tags::id.eq(tag_id))
            .filter(tags::user_id.eq(user_id))
            .select(TagRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find tag error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List all tags for a user, optionally filtering by a partial name match.
    pub fn list_tags(
        &self,
        user_id: &str,
        name_filter: Option<&str>,
    ) -> Result<Vec<TagRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        let mut query = tags::table
            .filter(tags::user_id.eq(user_id))
            .select(TagRecord::as_select())
            .order(tags::name.asc())
            .into_boxed();

        if let Some(q) = name_filter {
            let pattern = format!("%{}%", q);
            query = query.filter(tags::name.like(pattern));
        }

        query.load(&mut conn).map_err(|e| {
            tracing::error!("DB list tags error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn rename_tag(
        &self,
        tag_id: &str,
        user_id: &str,
        new_name: &str,
    ) -> Result<TagRecord, ApiError> {
        let mut conn = self.get_conn()?;

        diesel::update(
            tags::table
                .filter(tags::id.eq(tag_id))
                .filter(tags::user_id.eq(user_id)),
        )
        .set(tags::name.eq(new_name))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB rename tag error: {:?}", e);
            if e.to_string().contains("UNIQUE") {
                ApiError::new(409, "TAG_EXISTS", "A tag with that name already exists")
            } else {
                ApiError::internal("Database error")
            }
        })?;

        tags::table
            .filter(tags::id.eq(tag_id))
            .select(TagRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB fetch tag after rename error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_tag(&self, tag_id: &str, user_id: &str) -> Result<bool, ApiError> {
        let mut conn = self.get_conn()?;

        let rows = diesel::delete(
            tags::table
                .filter(tags::id.eq(tag_id))
                .filter(tags::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete tag error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(rows > 0)
    }

    // ── File-Tag associations ─────────────────────────────────────────────────

    pub fn add_file_tag(&self, file_id: &str, tag_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        diesel::insert_or_ignore_into(file_tags::table)
            .values(NewFileTag { file_id, tag_id })
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB add file tag error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(())
    }

    pub fn remove_file_tag(&self, file_id: &str, tag_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        diesel::delete(
            file_tags::table
                .filter(file_tags::file_id.eq(file_id))
                .filter(file_tags::tag_id.eq(tag_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB remove file tag error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(())
    }

    /// Replace all tags on a file with the given set of tag IDs.
    pub fn set_file_tags(&self, file_id: &str, tag_ids: &[String]) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        conn.transaction(|conn| {
            diesel::delete(file_tags::table.filter(file_tags::file_id.eq(file_id)))
                .execute(conn)?;

            let new_entries: Vec<NewFileTag> = tag_ids
                .iter()
                .map(|tid| NewFileTag {
                    file_id,
                    tag_id: tid.as_str(),
                })
                .collect();

            if !new_entries.is_empty() {
                diesel::insert_into(file_tags::table)
                    .values(&new_entries)
                    .execute(conn)?;
            }

            Ok(())
        })
        .map_err(|e: diesel::result::Error| {
            tracing::error!("DB set file tags error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Get all tags for a single file.
    pub fn get_tags_for_file(
        &self,
        file_id: &str,
        user_id: &str,
    ) -> Result<Vec<TagRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        file_tags::table
            .inner_join(tags::table.on(tags::id.eq(file_tags::tag_id)))
            .filter(file_tags::file_id.eq(file_id))
            .filter(tags::user_id.eq(user_id))
            .select(TagRecord::as_select())
            .order(tags::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get tags for file error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Get tag names for multiple files in a single query.
    /// Returns a map of file_id → sorted tag names.
    #[allow(dead_code)]
    pub fn get_tag_names_for_files(
        &self,
        file_ids: &[String],
        user_id: &str,
    ) -> Result<HashMap<String, Vec<String>>, ApiError> {
        if file_ids.is_empty() {
            return Ok(HashMap::new());
        }

        let mut conn = self.get_conn()?;

        // Diesel doesn't support IN with dynamic slices easily in SQLite via the DSL for
        // text columns, so we use a raw approach: load all file_tags for the user's tags,
        // then filter in Rust. For typical list sizes this is fine.
        let rows: Vec<(String, String)> = file_tags::table
            .inner_join(tags::table.on(tags::id.eq(file_tags::tag_id)))
            .filter(tags::user_id.eq(user_id))
            .select((file_tags::file_id, tags::name))
            .order(tags::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get tag names for files error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        let file_id_set: std::collections::HashSet<&String> = file_ids.iter().collect();
        let mut map: HashMap<String, Vec<String>> = HashMap::new();
        for (file_id, tag_name) in rows {
            if file_id_set.contains(&file_id) {
                map.entry(file_id).or_default().push(tag_name);
            }
        }

        Ok(map)
    }

    /// Get all files that have the given tag.
    pub fn get_files_for_tag(
        &self,
        tag_id: &str,
        user_id: &str,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        file_tags::table
            .inner_join(files::table.on(files::id.eq(file_tags::file_id)))
            .filter(file_tags::tag_id.eq(tag_id))
            .filter(files::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .order(files::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get files for tag error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }
}
