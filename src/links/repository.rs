use crate::links::model::NewFileLinkRecord;
use crate::schema::file_links;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct LinksRepository {
    pool: DbPool,
}

impl LinksRepository {
    pub fn new(pool: DbPool) -> Self {
        LinksRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    /// Return the IDs of all files that link to `target_file_id`.
    pub fn get_backlink_source_ids(&self, target_file_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        file_links::table
            .filter(file_links::target_file_id.eq(target_file_id))
            .select(file_links::source_file_id)
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get backlink source ids error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return the IDs of all files that `source_file_id` currently links to.
    pub fn get_link_target_ids(&self, source_file_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        file_links::table
            .filter(file_links::source_file_id.eq(source_file_id))
            .select(file_links::target_file_id)
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get link target ids error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Applies an add/remove diff to `source_file_id`'s outgoing links in one
    /// transaction, rather than deleting everything and reinserting — so a
    /// concurrent reader never observes the link set as momentarily empty.
    pub fn batch_update_links(
        &self,
        source_file_id: &str,
        added: &[String],
        removed: &[String],
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            if !removed.is_empty() {
                diesel::delete(
                    file_links::table.filter(
                        file_links::source_file_id
                            .eq(source_file_id)
                            .and(file_links::target_file_id.eq_any(removed)),
                    ),
                )
                .execute(conn)?;
            }
            for target_id in added {
                let new_link = NewFileLinkRecord {
                    source_file_id,
                    target_file_id: target_id.as_str(),
                };
                diesel::insert_or_ignore_into(file_links::table)
                    .values(&new_link)
                    .execute(conn)?;
            }
            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB batch_update_links error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// Delete all links where `file_id` is either source or target (called on file deletion).
    /// Not wired to a caller yet — file deletion still goes through each app's own module
    /// (e.g. `notes::repository::delete_links_for_note`) until Phase 3 migrates them here.
    #[allow(dead_code)]
    pub fn delete_links_for_file(&self, file_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            file_links::table.filter(
                file_links::source_file_id
                    .eq(file_id)
                    .or(file_links::target_file_id.eq(file_id)),
            ),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete links for file error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::MIGRATIONS;
    use diesel_migrations::MigrationHarness;

    fn test_pool() -> DbPool {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    #[test]
    fn batch_update_links_adds_and_removes_in_one_call() {
        let repo = LinksRepository::new(test_pool());
        repo.batch_update_links("a", &["b".to_string(), "c".to_string()], &[])
            .expect("initial add");
        assert_eq!(repo.get_link_target_ids("a").unwrap().len(), 2);

        repo.batch_update_links("a", &["d".to_string()], &["b".to_string()])
            .expect("diff update");

        let mut targets = repo.get_link_target_ids("a").unwrap();
        targets.sort();
        assert_eq!(targets, vec!["c".to_string(), "d".to_string()]);
    }

    #[test]
    fn get_backlink_source_ids_returns_sources_pointing_at_target() {
        let repo = LinksRepository::new(test_pool());
        repo.batch_update_links("a", &["z".to_string()], &[]).unwrap();
        repo.batch_update_links("b", &["z".to_string()], &[]).unwrap();

        let mut sources = repo.get_backlink_source_ids("z").unwrap();
        sources.sort();
        assert_eq!(sources, vec!["a".to_string(), "b".to_string()]);
    }

    #[test]
    fn delete_links_for_file_removes_as_source_and_target() {
        let repo = LinksRepository::new(test_pool());
        repo.batch_update_links("a", &["b".to_string()], &[]).unwrap();
        repo.batch_update_links("b", &["c".to_string()], &[]).unwrap();

        repo.delete_links_for_file("b").unwrap();

        assert!(repo.get_link_target_ids("a").unwrap().is_empty());
        assert!(repo.get_link_target_ids("b").unwrap().is_empty());
        assert!(repo.get_backlink_source_ids("c").unwrap().is_empty());
    }

    #[test]
    fn batch_update_links_with_duplicate_add_is_idempotent() {
        let repo = LinksRepository::new(test_pool());
        repo.batch_update_links("a", &["b".to_string()], &[]).unwrap();
        repo.batch_update_links("a", &["b".to_string()], &[])
            .expect("re-adding an existing link should not error");
        assert_eq!(repo.get_link_target_ids("a").unwrap(), vec!["b".to_string()]);
    }
}
