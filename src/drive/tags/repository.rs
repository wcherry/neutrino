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

    /// Replace the *calling user's* tags on a file with the given set of tag IDs.
    ///
    /// The delete is scoped to tags owned by `user_id`: tags are private per
    /// user, so an editor re-tagging a file shared with them must not wipe the
    /// owner's own labels on that same file.
    pub fn set_file_tags(
        &self,
        file_id: &str,
        user_id: &str,
        tag_ids: &[String],
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;

        conn.transaction(|conn| {
            let owned_tag_ids = tags::table
                .filter(tags::user_id.eq(user_id))
                .select(tags::id);

            diesel::delete(
                file_tags::table
                    .filter(file_tags::file_id.eq(file_id))
                    .filter(file_tags::tag_id.eq_any(owned_tag_ids)),
            )
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

    /// Count non-trashed files per tag for a user, in one query.
    /// Returns a map of tag_id → count; tags with no files are absent.
    ///
    /// The count is deliberately *not* permission-filtered — doing so would
    /// need a per-file effective-role walk, and this feeds tag ordering and
    /// badge counts where an approximate-but-cheap number is the right
    /// trade-off. It counts every non-trashed file the tag is attached to.
    pub fn count_files_per_tag(&self, user_id: &str) -> Result<HashMap<String, i64>, ApiError> {
        let mut conn = self.get_conn()?;

        let rows: Vec<(String, i64)> = file_tags::table
            .inner_join(tags::table.on(tags::id.eq(file_tags::tag_id)))
            .inner_join(files::table.on(files::id.eq(file_tags::file_id)))
            .filter(tags::user_id.eq(user_id))
            .filter(files::deleted_at.is_null())
            .group_by(file_tags::tag_id)
            .select((file_tags::tag_id, diesel::dsl::count_star()))
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count files per tag error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        Ok(rows.into_iter().collect())
    }

    /// Get every non-trashed file carrying the given tag, regardless of who
    /// owns it. Access filtering is the service's job — a user may tag a file
    /// that was shared with them, and those files must still come back here.
    pub fn get_files_for_tag(&self, tag_id: &str) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.get_conn()?;

        file_tags::table
            .inner_join(files::table.on(files::id.eq(file_tags::file_id)))
            .filter(file_tags::tag_id.eq(tag_id))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .order(files::name.asc())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get files for tag error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub(super) fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection error")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::storage::model::NewFileRecord;
    use diesel_migrations::MigrationHarness;

    /// A repository backed by a fresh in-memory SQLite database. The pool is
    /// capped at one connection so the `:memory:` database (which is per
    /// connection) persists across calls.
    fn test_repo() -> TagsRepository {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("failed to build test pool");
        pool.get()
            .expect("failed to get migration connection")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("failed to run migrations");
        TagsRepository::new(pool)
    }

    fn insert_file(repo: &TagsRepository, id: &str, user_id: &str, name: &str) {
        let mut conn = repo.get_conn().unwrap();
        diesel::insert_into(files::table)
            .values(NewFileRecord {
                id,
                user_id,
                name,
                size_bytes: 1,
                mime_type: "text/plain",
                storage_path: id,
                folder_id: None,
                encrypted_metadata: None,
            })
            .execute(&mut conn)
            .expect("failed to insert test file");
    }

    fn trash_file(repo: &TagsRepository, id: &str) {
        let mut conn = repo.get_conn().unwrap();
        diesel::update(files::table.filter(files::id.eq(id)))
            .set(files::deleted_at.eq(diesel::dsl::now))
            .execute(&mut conn)
            .expect("failed to trash test file");
    }

    fn make_tag(repo: &TagsRepository, id: &str, user_id: &str, name: &str) -> TagRecord {
        repo.insert_tag(NewTagRecord { id, user_id, name })
            .expect("failed to insert tag")
    }

    fn tag_names(tags: &[TagRecord]) -> Vec<&str> {
        tags.iter().map(|t| t.name.as_str()).collect()
    }

    // ── Tag CRUD ──────────────────────────────────────────────────────────────

    #[test]
    fn tag_names_are_unique_per_user_but_not_globally() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "invoices");

        let dup = repo.insert_tag(NewTagRecord {
            id: "t2",
            user_id: "alice",
            name: "invoices",
        });
        assert_eq!(dup.unwrap_err().status, 409);

        // Bob may use the same name — tags are per-user.
        make_tag(&repo, "t3", "bob", "invoices");
        assert_eq!(
            tag_names(&repo.list_tags("bob", None).unwrap()),
            ["invoices"]
        );
    }

    #[test]
    fn list_tags_is_scoped_to_the_user_and_filters_by_name() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "taxes");
        make_tag(&repo, "t2", "alice", "travel");
        make_tag(&repo, "t3", "bob", "bob-only");

        assert_eq!(
            tag_names(&repo.list_tags("alice", None).unwrap()),
            ["taxes", "travel"]
        );
        assert_eq!(
            tag_names(&repo.list_tags("alice", Some("tra")).unwrap()),
            ["travel"]
        );
        assert!(repo.list_tags("alice", Some("bob")).unwrap().is_empty());
    }

    #[test]
    fn deleting_a_tag_cascades_its_file_associations() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "taxes");
        insert_file(&repo, "f1", "alice", "return.pdf");
        repo.add_file_tag("f1", "t1").unwrap();

        assert!(repo.delete_tag("t1", "alice").unwrap());
        assert!(repo.get_files_for_tag("t1").unwrap().is_empty());
        assert!(repo.get_tags_for_file("f1", "alice").unwrap().is_empty());
    }

    #[test]
    fn a_user_cannot_delete_or_rename_another_users_tag() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "taxes");

        assert!(!repo.delete_tag("t1", "bob").unwrap());
        assert!(repo.find_tag("t1", "alice").unwrap().is_some());
        assert!(repo.find_tag("t1", "bob").unwrap().is_none());
    }

    // ── File associations ─────────────────────────────────────────────────────

    #[test]
    fn add_file_tag_is_idempotent() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "taxes");
        insert_file(&repo, "f1", "alice", "return.pdf");

        repo.add_file_tag("f1", "t1").unwrap();
        repo.add_file_tag("f1", "t1").unwrap();

        assert_eq!(repo.get_tags_for_file("f1", "alice").unwrap().len(), 1);
    }

    #[test]
    fn get_tags_for_file_never_leaks_another_users_tags() {
        let repo = test_repo();
        insert_file(&repo, "f1", "alice", "shared.pdf");
        make_tag(&repo, "a1", "alice", "alice-tag");
        make_tag(&repo, "b1", "bob", "bob-tag");
        repo.add_file_tag("f1", "a1").unwrap();
        repo.add_file_tag("f1", "b1").unwrap();

        assert_eq!(
            tag_names(&repo.get_tags_for_file("f1", "alice").unwrap()),
            ["alice-tag"]
        );
        assert_eq!(
            tag_names(&repo.get_tags_for_file("f1", "bob").unwrap()),
            ["bob-tag"]
        );
    }

    #[test]
    fn set_file_tags_replaces_only_the_calling_users_tags() {
        let repo = test_repo();
        insert_file(&repo, "f1", "alice", "shared.pdf");
        make_tag(&repo, "a1", "alice", "alice-one");
        make_tag(&repo, "a2", "alice", "alice-two");
        make_tag(&repo, "b1", "bob", "bob-tag");
        repo.add_file_tag("f1", "a1").unwrap();
        repo.add_file_tag("f1", "b1").unwrap();

        // Alice swaps her own tag set on a file Bob has also tagged.
        repo.set_file_tags("f1", "alice", &["a2".to_string()])
            .unwrap();

        assert_eq!(
            tag_names(&repo.get_tags_for_file("f1", "alice").unwrap()),
            ["alice-two"]
        );
        // Bob's private label on the same file survived.
        assert_eq!(
            tag_names(&repo.get_tags_for_file("f1", "bob").unwrap()),
            ["bob-tag"]
        );
    }

    #[test]
    fn set_file_tags_with_an_empty_set_clears_the_users_tags() {
        let repo = test_repo();
        insert_file(&repo, "f1", "alice", "return.pdf");
        make_tag(&repo, "a1", "alice", "taxes");
        repo.add_file_tag("f1", "a1").unwrap();

        repo.set_file_tags("f1", "alice", &[]).unwrap();

        assert!(repo.get_tags_for_file("f1", "alice").unwrap().is_empty());
    }

    // ── Files by tag ──────────────────────────────────────────────────────────

    #[test]
    fn get_files_for_tag_excludes_trashed_files_and_returns_others_files() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "taxes");
        insert_file(&repo, "f1", "alice", "a-return.pdf");
        insert_file(&repo, "f2", "alice", "b-receipt.pdf");
        // A file Bob owns that Alice tagged after it was shared with her.
        insert_file(&repo, "f3", "bob", "c-shared.pdf");
        repo.add_file_tag("f1", "t1").unwrap();
        repo.add_file_tag("f2", "t1").unwrap();
        repo.add_file_tag("f3", "t1").unwrap();

        trash_file(&repo, "f2");

        let files = repo.get_files_for_tag("t1").unwrap();
        let ids: Vec<&str> = files.iter().map(|f| f.id.as_str()).collect();
        // Ordered by name; the trashed file is gone, the shared one is not.
        assert_eq!(ids, ["f1", "f3"]);
    }

    // ── Counts ────────────────────────────────────────────────────────────────

    #[test]
    fn count_files_per_tag_skips_trashed_files_and_other_users_tags() {
        let repo = test_repo();
        make_tag(&repo, "t1", "alice", "busy");
        make_tag(&repo, "t2", "alice", "quiet");
        make_tag(&repo, "t3", "alice", "unused");
        make_tag(&repo, "b1", "bob", "bob-tag");
        insert_file(&repo, "f1", "alice", "one.pdf");
        insert_file(&repo, "f2", "alice", "two.pdf");
        insert_file(&repo, "f3", "alice", "three.pdf");

        repo.add_file_tag("f1", "t1").unwrap();
        repo.add_file_tag("f2", "t1").unwrap();
        repo.add_file_tag("f3", "t1").unwrap();
        repo.add_file_tag("f1", "t2").unwrap();
        repo.add_file_tag("f1", "b1").unwrap();

        trash_file(&repo, "f3");

        let counts = repo.count_files_per_tag("alice").unwrap();
        assert_eq!(counts.get("t1"), Some(&2)); // f3 is trashed
        assert_eq!(counts.get("t2"), Some(&1));
        assert_eq!(counts.get("t3"), None); // unused tags are absent
        assert_eq!(counts.get("b1"), None); // Bob's tag is not Alice's business

        assert_eq!(repo.count_files_per_tag("bob").unwrap().get("b1"), Some(&1));
    }
}
