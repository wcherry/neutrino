// ── themes::repository ───────────────────────────────────────────────────────
//
// Mirrors `src/slides/slides/repository.rs`'s theme methods and
// `src/drive/fonts/repository.rs`'s `get_conn`/error-mapping style. Implemented
// for real (not stubbed) — ownership enforcement here is simple enough to get
// right the first time and the plan's acceptance criteria depend on it being
// testable in the red phase.

use crate::schema::custom_themes;
use crate::shared::ApiError;
use crate::themes::model::{CustomThemeRecord, NewCustomThemeRecord, UpdateCustomThemeRecord};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct CustomThemesRepository {
    pool: DbPool,
}

impl CustomThemesRepository {
    pub fn new(pool: DbPool) -> Self {
        CustomThemesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_theme(
        &self,
        new_theme: NewCustomThemeRecord,
    ) -> Result<CustomThemeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(custom_themes::table)
            .values(&new_theme)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert custom theme error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        custom_themes::table
            .filter(custom_themes::id.eq(new_theme.id))
            .select(CustomThemeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after custom theme insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Returns the given user's own themes (public and private) plus other
    /// users' public themes — mirrors `list_themes_for_user`'s
    /// `is_system OR user_id = ?` filter, but keyed on `is_public` instead.
    pub fn list_visible_themes_for_user(
        &self,
        user_id: &str,
    ) -> Result<Vec<CustomThemeRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        custom_themes::table
            .filter(
                custom_themes::user_id
                    .eq(user_id)
                    .or(custom_themes::is_public.eq(true)),
            )
            .order(custom_themes::created_at.asc())
            .select(CustomThemeRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list custom themes error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Ownership-scoped lookup used before mutations. NOT the same as
    /// visibility: a theme with `is_public = true` is still 404 here if
    /// `user_id` doesn't match the owner. Callers that need to read a
    /// possibly-public theme for display purposes should use
    /// `list_visible_themes_for_user` instead.
    pub fn get_theme(&self, theme_id: &str, user_id: &str) -> Result<CustomThemeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        custom_themes::table
            .filter(custom_themes::id.eq(theme_id))
            .filter(custom_themes::user_id.eq(user_id))
            .select(CustomThemeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Theme not found"),
                _ => {
                    tracing::error!("DB get custom theme error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_theme(
        &self,
        theme_id: &str,
        user_id: &str,
        changes: UpdateCustomThemeRecord,
    ) -> Result<CustomThemeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let rows = diesel::update(
            custom_themes::table
                .filter(custom_themes::id.eq(theme_id))
                .filter(custom_themes::user_id.eq(user_id)),
        )
        .set(&changes)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update custom theme error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if rows == 0 {
            return Err(ApiError::not_found("Theme not found"));
        }
        // Re-select on the SAME connection rather than calling `get_theme`
        // (which would acquire a second connection from the pool) — avoids
        // pool exhaustion/deadlock when only one connection is available.
        custom_themes::table
            .filter(custom_themes::id.eq(theme_id))
            .filter(custom_themes::user_id.eq(user_id))
            .select(CustomThemeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Theme not found"),
                _ => {
                    tracing::error!("DB query after custom theme update error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn delete_theme(&self, theme_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let rows = diesel::delete(
            custom_themes::table
                .filter(custom_themes::id.eq(theme_id))
                .filter(custom_themes::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete custom theme error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if rows == 0 {
            return Err(ApiError::not_found("Theme not found"));
        }
        Ok(())
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

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

    fn insert_user(pool: &DbPool, id: &str, email: &str) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
             VALUES (?, ?, ?, 'hash', datetime('now'), 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(email)
        .bind::<diesel::sql_types::Text, _>(id)
        .execute(&mut conn)
        .expect("insert user");
    }

    fn insert_test_theme(
        repo: &CustomThemesRepository,
        id: &str,
        user_id: &str,
        name: &str,
        is_public: bool,
    ) -> CustomThemeRecord {
        repo.insert_theme(NewCustomThemeRecord {
            id,
            user_id,
            name,
            is_public,
            color_scheme: "dark",
            tokens: r##"{"--color-bg":"#111111"}"##,
            created_at: "2026-07-26T00:00:00Z",
            updated_at: "2026-07-26T00:00:00Z",
        })
        .expect("insert theme")
    }

    fn repo_with_two_users() -> (CustomThemesRepository, DbPool) {
        let pool = test_pool();
        insert_user(&pool, "user-a", "a@example.com");
        insert_user(&pool, "user-b", "b@example.com");
        (CustomThemesRepository::new(pool.clone()), pool)
    }

    #[test]
    fn insert_theme_persists_and_returns_the_created_record() {
        let (repo, _pool) = repo_with_two_users();
        let record = insert_test_theme(&repo, "theme-1", "user-a", "My Theme", false);

        assert_eq!(record.id, "theme-1");
        assert_eq!(record.user_id, "user-a");
        assert_eq!(record.name, "My Theme");
        assert!(!record.is_public);
        assert_eq!(record.color_scheme, "dark");
    }

    #[test]
    fn list_visible_themes_for_user_includes_own_public_and_private_themes() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Own Private", false);
        insert_test_theme(&repo, "theme-2", "user-a", "Own Public", true);

        let themes = repo
            .list_visible_themes_for_user("user-a")
            .expect("list");
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"theme-1"));
        assert!(ids.contains(&"theme-2"));
    }

    #[test]
    fn list_visible_themes_for_user_includes_other_users_public_themes() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-b", "B's Public Theme", true);

        let themes = repo
            .list_visible_themes_for_user("user-a")
            .expect("list");
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert!(ids.contains(&"theme-1"));
    }

    #[test]
    fn list_visible_themes_for_user_excludes_other_users_private_themes() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-b", "B's Private Theme", false);

        let themes = repo
            .list_visible_themes_for_user("user-a")
            .expect("list");
        let ids: Vec<&str> = themes.iter().map(|t| t.id.as_str()).collect();
        assert!(!ids.contains(&"theme-1"));
    }

    #[test]
    fn get_theme_returns_the_record_for_its_owner() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Own Theme", false);

        let found = repo.get_theme("theme-1", "user-a").expect("get_theme");
        assert_eq!(found.id, "theme-1");
    }

    #[test]
    fn get_theme_404s_for_a_non_owner_even_when_public() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Public Theme", true);

        let err = repo
            .get_theme("theme-1", "user-b")
            .expect_err("expected not_found for non-owner, even on a public theme");
        assert_eq!(err.status, 404);
    }

    #[test]
    fn update_theme_succeeds_for_the_owner() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Original Name", false);

        let updated = repo
            .update_theme(
                "theme-1",
                "user-a",
                UpdateCustomThemeRecord {
                    name: Some("New Name".to_string()),
                    is_public: None,
                    color_scheme: None,
                    tokens: None,
                    updated_at: "2026-07-27T00:00:00Z".to_string(),
                },
            )
            .expect("update_theme");
        assert_eq!(updated.name, "New Name");
    }

    #[test]
    fn update_theme_404s_for_a_non_owner_even_when_public() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Public Theme", true);

        let err = repo
            .update_theme(
                "theme-1",
                "user-b",
                UpdateCustomThemeRecord {
                    name: Some("Hijacked".to_string()),
                    is_public: None,
                    color_scheme: None,
                    tokens: None,
                    updated_at: "2026-07-27T00:00:00Z".to_string(),
                },
            )
            .expect_err("expected not_found for non-owner update, even on a public theme");
        assert_eq!(err.status, 404);
    }

    #[test]
    fn delete_theme_succeeds_for_the_owner() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Deletable", false);

        repo.delete_theme("theme-1", "user-a").expect("delete");

        let err = repo.get_theme("theme-1", "user-a").expect_err("gone");
        assert_eq!(err.status, 404);
    }

    #[test]
    fn delete_theme_404s_for_a_non_owner_even_when_public() {
        let (repo, _pool) = repo_with_two_users();
        insert_test_theme(&repo, "theme-1", "user-a", "Public Theme", true);

        let err = repo
            .delete_theme("theme-1", "user-b")
            .expect_err("expected not_found for non-owner delete, even on a public theme");
        assert_eq!(err.status, 404);
    }
}
