use crate::photos::albums::model::{
    AlbumRecord, NewAlbumPhotoRecord, NewAlbumRecord, UpdateAlbumRecord,
};
use crate::schema::{album_photos, albums, photos};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct AlbumsRepository {
    pool: DbPool,
}

impl AlbumsRepository {
    pub fn new(pool: DbPool) -> Self {
        AlbumsRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_album(&self, new_album: NewAlbumRecord) -> Result<AlbumRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(albums::table)
            .values(&new_album)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert album error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        albums::table
            .filter(albums::id.eq(new_album.id))
            .select(AlbumRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after album insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_album(&self, album_id: &str) -> Result<AlbumRecord, ApiError> {
        let mut conn = self.get_conn()?;
        albums::table
            .filter(albums::id.eq(album_id))
            .select(AlbumRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Album not found"),
                _ => {
                    tracing::error!("DB get album error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn list_albums(&self, user_id: &str) -> Result<Vec<AlbumRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        albums::table
            .filter(albums::user_id.eq(user_id))
            .order(albums::created_at.desc())
            .select(AlbumRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list albums error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_album(
        &self,
        album_id: &str,
        changes: UpdateAlbumRecord,
    ) -> Result<AlbumRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(albums::table.filter(albums::id.eq(album_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update album error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_album(album_id)
    }

    pub fn delete_album(&self, album_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(album_photos::table.filter(album_photos::album_id.eq(album_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete album_photos error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        diesel::delete(albums::table.filter(albums::id.eq(album_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete album error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn add_photo_to_album(&self, album_id: &str, photo_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let new_item = NewAlbumPhotoRecord { album_id, photo_id };
        diesel::insert_or_ignore_into(album_photos::table)
            .values(&new_item)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB add photo to album error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    pub fn remove_photo_from_album(&self, album_id: &str, photo_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            album_photos::table
                .filter(album_photos::album_id.eq(album_id))
                .filter(album_photos::photo_id.eq(photo_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB remove photo from album error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        Ok(())
    }

    /// The IDs of an album's *live* photos, most recently added first.
    ///
    /// The one query the count, the cover, and the contents all answer from, so the three cannot
    /// disagree — a card reading "20 photos" over a grid of 19 with a cover that is neither is what
    /// three separately-filtered queries produce. Trashing a photo leaves its `album_photos` row
    /// alone so a restore can put it back, which is exactly why the filter has to live here.
    pub fn list_live_album_photo_ids(&self, album_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        album_photos::table
            .inner_join(photos::table.on(photos::id.eq(album_photos::photo_id)))
            .filter(album_photos::album_id.eq(album_id))
            .filter(photos::deleted_at.is_null())
            .order(album_photos::added_at.desc())
            .select(album_photos::photo_id)
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list live album photos error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Find the auto-generated album for a specific person (if one exists).
    pub fn find_auto_album_for_person(
        &self,
        user_id: &str,
        person_id: &str,
    ) -> Result<Option<AlbumRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let result = albums::table
            .filter(albums::user_id.eq(user_id))
            .filter(albums::person_id.eq(person_id))
            .filter(albums::is_auto.eq(true))
            .select(AlbumRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB find auto album error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(result)
    }

    /// Replace all photos in an album with the given set of photo IDs.
    /// Photos not in the set are removed; new ones are added.
    pub fn sync_album_photos(&self, album_id: &str, photo_ids: &[String]) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<(), diesel::result::Error, _>(|conn| {
            // Remove all existing entries.
            diesel::delete(album_photos::table.filter(album_photos::album_id.eq(album_id)))
                .execute(conn)?;
            // Insert the new set.
            for photo_id in photo_ids {
                let new_item = NewAlbumPhotoRecord { album_id, photo_id };
                diesel::insert_or_ignore_into(album_photos::table)
                    .values(&new_item)
                    .execute(conn)?;
            }
            Ok(())
        })
        .map_err(|e| {
            tracing::error!("DB sync album photos error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    /// Inserts a photo, optionally already in the trash.
    fn insert_photo(pool: &DbPool, id: &str, user_id: &str, trashed: bool) {
        let mut conn = pool.get().expect("conn");
        let deleted = if trashed { "datetime('now')" } else { "NULL" };
        diesel::sql_query(format!(
            "INSERT INTO photos (id, user_id, file_id, is_starred, is_archived, deleted_at, \
             created_at, updated_at) VALUES (?, ?, ?, 0, 0, {}, datetime('now'), datetime('now'))",
            deleted
        ))
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(user_id)
        .bind::<diesel::sql_types::Text, _>(format!("file-{}", id))
        .execute(&mut conn)
        .expect("insert photo");
    }

    fn set_added_at(pool: &DbPool, album_id: &str, photo_id: &str, added_at: &str) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "UPDATE album_photos SET added_at = ? WHERE album_id = ? AND photo_id = ?",
        )
        .bind::<diesel::sql_types::Text, _>(added_at)
        .bind::<diesel::sql_types::Text, _>(album_id)
        .bind::<diesel::sql_types::Text, _>(photo_id)
        .execute(&mut conn)
        .expect("set added_at");
    }

    fn make_album(repo: &AlbumsRepository, id: &str, user_id: &str) {
        repo.insert_album(NewAlbumRecord {
            id,
            user_id,
            title: "Trip",
            description: None,
            is_auto: false,
            person_id: None,
        })
        .expect("insert album");
    }

    #[test]
    fn live_album_photos_are_returned_most_recently_added_first() {
        let pool = test_pool();
        let repo = AlbumsRepository::new(pool.clone());
        make_album(&repo, "a", "u1");
        // `added_at` defaults to CURRENT_TIMESTAMP, which is second-resolution — three rows
        // inserted in a loop would share one value and the ordering assertion would be testing
        // insertion order by accident. So the timestamps are set explicitly.
        for (id, added_at) in [
            ("p1", "2026-08-01 10:00:00"),
            ("p2", "2026-08-02 10:00:00"),
            ("p3", "2026-08-03 10:00:00"),
        ] {
            insert_photo(&pool, id, "u1", false);
            repo.add_photo_to_album("a", id).expect("add");
            set_added_at(&pool, "a", id, added_at);
        }

        let ids = repo.list_live_album_photo_ids("a").expect("list");
        assert_eq!(ids, vec!["p3", "p2", "p1"]);
    }

    #[test]
    fn a_trashed_photo_leaves_the_contents_but_keeps_its_membership() {
        let pool = test_pool();
        let repo = AlbumsRepository::new(pool.clone());
        make_album(&repo, "a", "u1");
        insert_photo(&pool, "live", "u1", false);
        insert_photo(&pool, "trashed", "u1", true);
        repo.add_photo_to_album("a", "live").expect("add");
        repo.add_photo_to_album("a", "trashed").expect("add");

        // The contents and the count agree, which is the whole point of them sharing one query:
        // a card reading "2 photos" over a grid of 1 is what two separate filters produce.
        let ids = repo.list_live_album_photo_ids("a").expect("list");
        assert_eq!(ids, vec!["live"]);

        // The membership survives, so restoring the photo puts it back in this album rather than
        // only in the timeline. Read straight from the table: no method exposes it, deliberately —
        // nothing outside a restore should ever see a trashed photo as album content.
        let mut conn = pool.get().expect("conn");
        let memberships: i64 = album_photos::table
            .filter(album_photos::album_id.eq("a"))
            .count()
            .get_result(&mut conn)
            .expect("count memberships");
        assert_eq!(memberships, 2);
    }

    #[test]
    fn an_empty_album_has_no_cover_and_no_count() {
        let pool = test_pool();
        let repo = AlbumsRepository::new(pool);
        make_album(&repo, "a", "u1");

        let ids = repo.list_live_album_photo_ids("a").expect("list");
        assert!(ids.is_empty());
        assert!(ids.first().is_none());
    }

    #[test]
    fn deleting_an_album_leaves_its_photos_alone() {
        let pool = test_pool();
        let repo = AlbumsRepository::new(pool.clone());
        make_album(&repo, "a", "u1");
        insert_photo(&pool, "p1", "u1", false);
        repo.add_photo_to_album("a", "p1").expect("add");

        repo.delete_album("a").expect("delete");

        // The photo record is untouched — an album is a grouping, not a container that owns its
        // contents. This is the client-visible promise "the photos in it stay in your library".
        let mut conn = pool.get().expect("conn");
        let count: i64 = photos::table
            .filter(photos::id.eq("p1"))
            .count()
            .get_result(&mut conn)
            .expect("count");
        assert_eq!(count, 1);
    }

    #[test]
    fn adding_the_same_photo_twice_is_a_no_op() {
        let pool = test_pool();
        let repo = AlbumsRepository::new(pool.clone());
        make_album(&repo, "a", "u1");
        insert_photo(&pool, "p1", "u1", false);

        repo.add_photo_to_album("a", "p1").expect("add");
        repo.add_photo_to_album("a", "p1").expect("add again");

        // What lets the picker skip a membership check it would otherwise need every album's
        // contents to perform.
        assert_eq!(repo.list_live_album_photo_ids("a").expect("list").len(), 1);
    }
}
