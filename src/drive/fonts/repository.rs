// ── drive::fonts::repository ──────────────────────────────────────────────────

use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

use super::model::{CustomFontRecord, NewCustomFontRecord};
use crate::schema::custom_fonts;
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct FontsRepository {
    pool: DbPool,
}

impl FontsRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    pub fn list(&self) -> Result<Vec<CustomFontRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        custom_fonts::table
            .select(CustomFontRecord::as_select())
            .order(custom_fonts::created_at.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB custom_fonts list error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn insert(&self, new: NewCustomFontRecord) -> Result<CustomFontRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();

        diesel::insert_into(custom_fonts::table)
            .values((
                custom_fonts::id.eq(new.id),
                custom_fonts::display_name.eq(new.display_name),
                custom_fonts::original_filename.eq(new.original_filename),
                custom_fonts::format.eq(new.format),
                custom_fonts::storage_key.eq(new.storage_key),
                custom_fonts::uploaded_by.eq(new.uploaded_by),
                custom_fonts::created_at.eq(&now),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB custom_fonts insert error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        custom_fonts::table
            .filter(custom_fonts::id.eq(new.id))
            .select(CustomFontRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB custom_fonts fetch after insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete(&self, id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(custom_fonts::table.filter(custom_fonts::id.eq(id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB custom_fonts delete error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn find_by_id(&self, id: &str) -> Result<Option<CustomFontRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        custom_fonts::table
            .filter(custom_fonts::id.eq(id))
            .select(CustomFontRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB custom_fonts find_by_id error: {:?}", e);
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

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shared::DbPool;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel::SqliteConnection;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn insert_test_font(
        repo: &FontsRepository,
        id: &str,
        display_name: &str,
        uploaded_by: &str,
    ) -> CustomFontRecord {
        repo.insert(NewCustomFontRecord {
            id,
            display_name,
            original_filename: "original.woff2",
            format: "woff2",
            storage_key: &format!("fonts/{id}.woff2"),
            uploaded_by,
        })
        .expect("insert font")
    }

    #[test]
    fn list_is_empty_when_no_fonts_have_been_uploaded() {
        let repo = FontsRepository::new(test_pool());
        let fonts = repo.list().expect("list");
        assert!(fonts.is_empty());
    }

    #[test]
    fn insert_persists_a_font_and_returns_the_created_record() {
        let repo = FontsRepository::new(test_pool());
        let record = insert_test_font(&repo, "font-1", "My Font", "user-1");

        assert_eq!(record.id, "font-1");
        assert_eq!(record.display_name, "My Font");
        assert_eq!(record.format, "woff2");
        assert_eq!(record.uploaded_by, "user-1");
    }

    #[test]
    fn list_returns_all_inserted_fonts() {
        let repo = FontsRepository::new(test_pool());
        insert_test_font(&repo, "font-1", "First Font", "user-1");
        insert_test_font(&repo, "font-2", "Second Font", "user-1");

        let fonts = repo.list().expect("list");
        assert_eq!(fonts.len(), 2);
        let ids: Vec<&str> = fonts.iter().map(|f| f.id.as_str()).collect();
        assert!(ids.contains(&"font-1"));
        assert!(ids.contains(&"font-2"));
    }

    #[test]
    fn list_allows_duplicate_display_names() {
        // Font display names have no uniqueness constraint (id/uuid is the
        // real primary key) — see plan's "Duplicate font names" risk note.
        let repo = FontsRepository::new(test_pool());
        insert_test_font(&repo, "font-1", "Same Name", "user-1");
        insert_test_font(&repo, "font-2", "Same Name", "user-1");

        let fonts = repo.list().expect("list");
        assert_eq!(fonts.len(), 2);
        assert!(fonts.iter().all(|f| f.display_name == "Same Name"));
    }

    #[test]
    fn find_by_id_returns_the_matching_record() {
        let repo = FontsRepository::new(test_pool());
        insert_test_font(&repo, "font-1", "Findable Font", "user-1");

        let found = repo.find_by_id("font-1").expect("find_by_id");
        assert!(found.is_some());
        assert_eq!(found.unwrap().display_name, "Findable Font");
    }

    #[test]
    fn find_by_id_returns_none_for_an_unknown_id() {
        let repo = FontsRepository::new(test_pool());
        let found = repo.find_by_id("nonexistent").expect("find_by_id");
        assert!(found.is_none());
    }

    #[test]
    fn delete_removes_the_font() {
        let repo = FontsRepository::new(test_pool());
        insert_test_font(&repo, "font-1", "Deletable Font", "user-1");

        repo.delete("font-1").expect("delete");

        let found = repo.find_by_id("font-1").expect("find_by_id");
        assert!(found.is_none());
    }

    #[test]
    fn delete_does_not_affect_other_fonts() {
        let repo = FontsRepository::new(test_pool());
        insert_test_font(&repo, "font-1", "Keep Me", "user-1");
        insert_test_font(&repo, "font-2", "Delete Me", "user-1");

        repo.delete("font-2").expect("delete");

        let remaining = repo.list().expect("list");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, "font-1");
    }
}
