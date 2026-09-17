use crate::photos::photos::model::{
    LockedFolderSettings, NewLockedFolderSettings, NewPhotoEdit, NewPhotoRecord, PhotoEdit,
    PhotoRecord, UpdatePhotoRecord,
};
use crate::schema::{album_photos, locked_folder_settings, photo_edits, photos};
use crate::shared::ApiError;
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// One page of a photo listing.
///
/// Both halves are already clamped by the time they arrive — see `list_photos` in `api.rs`, which
/// is the only place that builds one from user input.
#[derive(Debug, Clone, Copy)]
pub struct PhotoPage {
    pub limit: i64,
    pub offset: i64,
}

/// What a photo listing is sorted by, newest first either way.
///
/// This exists because paging made the choice matter. An unpaged listing could be sorted by
/// anything and the client would re-sort it; a *paged* one cannot, because `LIMIT`/`OFFSET` is
/// applied after `ORDER BY`, so the order the server sorts in is the order the pages are cut
/// along. A client that displays photos by one key while paging along another gets an arbitrary
/// slice of its own timeline per request, and no amount of client-side sorting fixes it — sorting
/// after the fact only sorts what has already arrived.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum PhotoOrder {
    /// When the record reached the account. The default, and what every existing caller gets.
    #[default]
    Created,
    /// When the picture was taken, falling back to when it arrived for anything without an EXIF
    /// date. This is the order the iOS timeline actually displays — see `MediaItem.timelineDate`
    /// — and the two genuinely invert: a scanned print is registered today and belongs in 1998,
    /// while a photo taken yesterday off an old upload belongs at the top.
    Capture,
}

pub struct PhotosRepository {
    pool: DbPool,
}

impl PhotosRepository {
    pub fn new(pool: DbPool) -> Self {
        PhotosRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_photo(&self, new_photo: NewPhotoRecord) -> Result<PhotoRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(photos::table)
            .values(&new_photo)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert photo error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        photos::table
            .filter(photos::id.eq(new_photo.id))
            .select(PhotoRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after photo insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_photo(&self, photo_id: &str) -> Result<PhotoRecord, ApiError> {
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::id.eq(photo_id))
            .filter(photos::deleted_at.is_null())
            .select(PhotoRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Photo not found"),
                _ => {
                    tracing::error!("DB get photo error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn get_photo_including_deleted(&self, photo_id: &str) -> Result<PhotoRecord, ApiError> {
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::id.eq(photo_id))
            .select(PhotoRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Photo not found"),
                _ => {
                    tracing::error!("DB get photo error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn list_photos(
        &self,
        user_id: &str,
        include_archived: bool,
        starred_only: bool,
        order: PhotoOrder,
        page: Option<PhotoPage>,
    ) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .select(PhotoRecord::as_select())
            .into_boxed();

        if !include_archived {
            query = query.filter(photos::is_archived.eq(false));
        }
        if starred_only {
            query = query.filter(photos::is_starred.eq(true));
        }

        // Neither sort key is a total order on its own: a bulk import stamps thousands of rows
        // inside the same second, and a scanned batch can share one capture date across the whole
        // shoebox. Where rows tie SQLite may return them in any order it likes. It happens to be
        // stable today — 25,000 rows sharing a timestamp page cleanly without this — but that is a
        // property of the current plan (a full scan in rowid order), not a promise, and it is one
        // an index or a different filter could take away. Two pages ordered differently would hand
        // a client one photo twice and never show it another, so `id` breaks the tie with
        // something unique and stable rather than leaving offset paging resting on an
        // implementation detail.
        query = match order {
            PhotoOrder::Created => query.order((photos::created_at.desc(), photos::id.desc())),
            // `COALESCE` rather than a plain column because `capture_date` is nullable and a photo
            // without EXIF still has to land somewhere sensible. Sorting on the bare column would
            // bunch every such photo at one end of the library regardless of when it arrived,
            // which is the opposite of what the fallback in `timelineDate` means. Raw SQL because
            // Diesel has no backend-agnostic `coalesce` helper; the query is unjoined, so the
            // unqualified names can only resolve to `photos`.
            PhotoOrder::Capture => query.order((
                diesel::dsl::sql::<diesel::sql_types::Timestamp>(
                    "COALESCE(capture_date, created_at)",
                )
                .desc(),
                photos::id.desc(),
            )),
        };

        if let Some(page) = page {
            query = query.limit(page.limit).offset(page.offset);
        }

        query.load(&mut conn).map_err(|e| {
            tracing::error!("DB list photos error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// How many photos the same filters match, ignoring any page.
    ///
    /// What makes a page meaningful: the client needs to know how far it has to keep asking, and
    /// `photos.len()` on the last page cannot tell it that.
    pub fn count_photos(
        &self,
        user_id: &str,
        include_archived: bool,
        starred_only: bool,
    ) -> Result<i64, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .select(diesel::dsl::count_star())
            .into_boxed();

        if !include_archived {
            query = query.filter(photos::is_archived.eq(false));
        }
        if starred_only {
            query = query.filter(photos::is_starred.eq(true));
        }

        query.get_result(&mut conn).map_err(|e| {
            tracing::error!("DB count photos error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn list_trash(&self, user_id: &str) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_not_null())
            .order(photos::deleted_at.desc())
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list trash error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn update_photo(
        &self,
        photo_id: &str,
        changes: UpdatePhotoRecord,
    ) -> Result<PhotoRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(photos::table.filter(photos::id.eq(photo_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update photo error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_photo_including_deleted(photo_id)
    }

    pub fn set_metadata(&self, photo_id: &str, metadata: String) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(photos::table.filter(photos::id.eq(photo_id)))
            .set((
                photos::metadata.eq(Some(metadata)),
                photos::updated_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB set metadata error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// The photos whose retention window has closed — trashed at or before `before`.
    ///
    /// Returned rather than deleted so the caller can take each one's Drive file with it. Deleting
    /// the rows first would strand the bytes: nothing would be left pointing at them.
    pub fn list_expired_trash(&self, before: NaiveDateTime) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::deleted_at.is_not_null())
            .filter(photos::deleted_at.le(before))
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list expired trash error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_expired_trash(&self, before: NaiveDateTime) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<usize, diesel::result::Error, _>(|conn| {
            let doomed: Vec<String> = photos::table
                .filter(photos::deleted_at.is_not_null())
                .filter(photos::deleted_at.le(before))
                .select(photos::id)
                .load(conn)?;
            // Same reason as `delete_photo_record`: no foreign key, so nothing cascades.
            diesel::delete(album_photos::table.filter(album_photos::photo_id.eq_any(&doomed)))
                .execute(conn)?;
            diesel::delete(
                photos::table
                    .filter(photos::deleted_at.is_not_null())
                    .filter(photos::deleted_at.le(before)),
            )
            .execute(conn)
        })
        .map_err(|e| {
            tracing::error!("DB delete expired trash error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn get_photo_ids_for_person(
        &self,
        user_id: &str,
        person_id: &str,
    ) -> Result<Vec<String>, ApiError> {
        use crate::schema::faces;
        let mut conn = self.get_conn()?;
        photos::table
            .inner_join(faces::table.on(faces::photo_id.eq(photos::id)))
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(photos::is_archived.eq(false))
            .filter(faces::person_id.eq(person_id))
            .select(photos::id)
            .distinct()
            .load::<String>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get photo ids for person error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Removes one photo row outright, and its album membership with it.
    ///
    /// `album_photos` has no foreign key onto `photos` (see the `create_albums` migration), so
    /// nothing cascades — a row left behind here is a membership pointing at a photo that no longer
    /// exists, which every album read then has to filter around forever.
    pub fn delete_photo_record(&self, photo_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<usize, diesel::result::Error, _>(|conn| {
            diesel::delete(album_photos::table.filter(album_photos::photo_id.eq(photo_id)))
                .execute(conn)?;
            diesel::delete(photos::table.filter(photos::id.eq(photo_id))).execute(conn)
        })
        .map_err(|e| {
            tracing::error!("DB delete photo error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn empty_trash(&self, user_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<usize, diesel::result::Error, _>(|conn| {
            let doomed: Vec<String> = photos::table
                .filter(photos::user_id.eq(user_id))
                .filter(photos::deleted_at.is_not_null())
                .select(photos::id)
                .load(conn)?;
            diesel::delete(album_photos::table.filter(album_photos::photo_id.eq_any(&doomed)))
                .execute(conn)?;
            diesel::delete(
                photos::table
                    .filter(photos::user_id.eq(user_id))
                    .filter(photos::deleted_at.is_not_null()),
            )
            .execute(conn)
        })
        .map_err(|e| {
            tracing::error!("DB empty trash error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// List photos that have GPS coordinates (latitude/longitude) in their metadata JSON.
    pub fn list_photos_with_gps(
        &self,
        user_id: &str,
        limit: i64,
    ) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(photos::is_archived.eq(false))
            .filter(photos::metadata.is_not_null())
            .order(photos::created_at.desc())
            .limit(limit)
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list photos with gps error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List photos that are "backed up" (have metadata set by the worker).
    pub fn list_backed_up_photos(&self, user_id: &str) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(photos::metadata.is_not_null())
            .order(photos::created_at.desc())
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list backed up photos error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List photos whose capture_date matches a given month and day (for "on this day").
    pub fn list_photos_by_month_day(
        &self,
        user_id: &str,
        month: u32,
        day: u32,
    ) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        // Use SQLite strftime to filter by month and day
        let month_str = format!("{:02}", month);
        let day_str = format!("{:02}", day);
        photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(photos::is_archived.eq(false))
            .filter(photos::capture_date.is_not_null())
            .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                "strftime('%m', capture_date) = '{}' AND strftime('%d', capture_date) = '{}'",
                month_str, day_str
            )))
            .order(photos::capture_date.desc())
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list photos by month/day error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List photos from a given year (for year-in-review).
    pub fn list_photos_by_year(
        &self,
        user_id: &str,
        year: i32,
        limit: i64,
    ) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let year_str = format!("{}", year);
        photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(photos::capture_date.is_not_null())
            .filter(diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                "strftime('%Y', capture_date) = '{}'",
                year_str
            )))
            .order(photos::is_starred.desc())
            .then_order_by(photos::created_at.desc())
            .limit(limit)
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list photos by year error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Set is_locked for a photo.
    pub fn set_locked(&self, photo_id: &str, locked: bool) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let val: i32 = if locked { 1 } else { 0 };
        diesel::update(photos::table.filter(photos::id.eq(photo_id)))
            .set((
                photos::is_locked.eq(val),
                photos::updated_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB set locked error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    /// Set strip_gps for a photo.
    pub fn set_strip_gps(&self, photo_id: &str, strip: bool) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let val: i32 = if strip { 1 } else { 0 };
        diesel::update(photos::table.filter(photos::id.eq(photo_id)))
            .set((
                photos::strip_gps.eq(val),
                photos::updated_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB set strip_gps error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(())
    }

    // ---- Photo Edits ----

    pub fn upsert_photo_edit(&self, new_edit: NewPhotoEdit) -> Result<PhotoEdit, ApiError> {
        let mut conn = self.get_conn()?;
        let photo_id = new_edit.photo_id.clone();
        diesel::insert_into(photo_edits::table)
            .values(&new_edit)
            .on_conflict(photo_edits::photo_id)
            .do_update()
            .set((
                photo_edits::edits_json.eq(&new_edit.edits_json),
                photo_edits::updated_at.eq(&new_edit.updated_at),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert photo edit error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        photo_edits::table
            .filter(photo_edits::photo_id.eq(&photo_id))
            .select(PhotoEdit::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get photo edit after upsert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_photo_edit(&self, photo_id: &str) -> Result<Option<PhotoEdit>, ApiError> {
        let mut conn = self.get_conn()?;
        photo_edits::table
            .filter(photo_edits::photo_id.eq(photo_id))
            .select(PhotoEdit::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get photo edit error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn delete_photo_edit(&self, photo_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(photo_edits::table.filter(photo_edits::photo_id.eq(photo_id)))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB delete photo edit error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    // ---- Locked Folder Settings ----

    pub fn get_locked_folder_settings(
        &self,
        user_id: &str,
    ) -> Result<Option<LockedFolderSettings>, ApiError> {
        let mut conn = self.get_conn()?;
        locked_folder_settings::table
            .filter(locked_folder_settings::user_id.eq(user_id))
            .select(LockedFolderSettings::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB get locked folder settings error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn upsert_locked_folder_settings(
        &self,
        settings: NewLockedFolderSettings,
    ) -> Result<LockedFolderSettings, ApiError> {
        let mut conn = self.get_conn()?;
        let user_id = settings.user_id.clone();
        diesel::insert_into(locked_folder_settings::table)
            .values(&settings)
            .on_conflict(locked_folder_settings::user_id)
            .do_update()
            .set((
                locked_folder_settings::is_enabled.eq(settings.is_enabled),
                locked_folder_settings::pin_hash.eq(&settings.pin_hash),
                locked_folder_settings::updated_at.eq(settings.updated_at),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB upsert locked folder settings error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        locked_folder_settings::table
            .filter(locked_folder_settings::user_id.eq(&user_id))
            .select(LockedFolderSettings::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get locked folder settings after upsert error: {:?}", e);
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

    fn add_to_album(pool: &DbPool, album_id: &str, photo_id: &str) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query("INSERT INTO album_photos (album_id, photo_id) VALUES (?, ?)")
            .bind::<diesel::sql_types::Text, _>(album_id)
            .bind::<diesel::sql_types::Text, _>(photo_id)
            .execute(&mut conn)
            .expect("add to album");
    }

    fn membership_count(pool: &DbPool) -> i64 {
        let mut conn = pool.get().expect("conn");
        album_photos::table
            .count()
            .get_result(&mut conn)
            .expect("count memberships")
    }

    #[test]
    fn deleting_a_photo_record_takes_its_album_memberships_with_it() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photo(&pool, "p1", "u1", true);
        add_to_album(&pool, "album-a", "p1");
        add_to_album(&pool, "album-b", "p1");
        assert_eq!(membership_count(&pool), 2);

        repo.delete_photo_record("p1").expect("delete");

        // `album_photos` has no foreign key onto `photos`, so nothing cascades on its own. A row
        // left behind is a membership pointing at a photo that no longer exists — which every
        // album read would then have to filter around forever.
        assert_eq!(membership_count(&pool), 0);
    }

    #[test]
    fn emptying_the_trash_drops_memberships_for_trashed_photos_only() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photo(&pool, "live", "u1", false);
        insert_photo(&pool, "trashed", "u1", true);
        add_to_album(&pool, "album-a", "live");
        add_to_album(&pool, "album-a", "trashed");

        repo.empty_trash("u1").expect("empty");

        assert_eq!(membership_count(&pool), 1);
        let mut conn = pool.get().expect("conn");
        let remaining: Vec<String> = album_photos::table
            .select(album_photos::photo_id)
            .load(&mut conn)
            .expect("load");
        assert_eq!(remaining, vec!["live"]);
    }

    /// Inserts a photo trashed a given number of days ago.
    fn insert_trashed_days_ago(pool: &DbPool, id: &str, user_id: &str, days: i64) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO photos (id, user_id, file_id, is_starred, is_archived, deleted_at, \
             created_at, updated_at) VALUES (?, ?, ?, 0, 0, datetime('now', ?), \
             datetime('now'), datetime('now'))",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(user_id)
        .bind::<diesel::sql_types::Text, _>(format!("file-{}", id))
        .bind::<diesel::sql_types::Text, _>(format!("-{} days", days))
        .execute(&mut conn)
        .expect("insert trashed photo");
    }

    #[test]
    fn expired_trash_is_the_set_past_the_cutoff_and_nothing_younger() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_trashed_days_ago(&pool, "ancient", "u1", 40);
        insert_trashed_days_ago(&pool, "just-expired", "u1", 31);
        insert_trashed_days_ago(&pool, "still-waiting", "u1", 29);
        insert_photo(&pool, "live", "u1", false);

        let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).naive_utc();
        let expired = repo.list_expired_trash(cutoff).expect("list");

        let mut ids: Vec<&str> = expired.iter().map(|p| p.id.as_str()).collect();
        ids.sort_unstable();
        // A live photo has no `deleted_at` at all and must never be swept, whatever the cutoff.
        assert_eq!(ids, vec!["ancient", "just-expired"]);
    }

    #[test]
    fn purging_expired_trash_takes_album_memberships_with_it() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_trashed_days_ago(&pool, "expired", "u1", 40);
        insert_trashed_days_ago(&pool, "waiting", "u1", 5);
        add_to_album(&pool, "album-a", "expired");
        add_to_album(&pool, "album-a", "waiting");

        let cutoff = (chrono::Utc::now() - chrono::Duration::days(30)).naive_utc();
        let removed = repo.delete_expired_trash(cutoff).expect("purge");

        assert_eq!(removed, 1);
        let mut conn = pool.get().expect("conn");
        let remaining: Vec<String> = album_photos::table
            .select(album_photos::photo_id)
            .load(&mut conn)
            .expect("load");
        assert_eq!(remaining, vec!["waiting"]);
    }

    #[test]
    fn emptying_the_trash_leaves_another_users_trash_alone() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photo(&pool, "mine", "u1", true);
        insert_photo(&pool, "theirs", "u2", true);
        add_to_album(&pool, "album-a", "theirs");

        repo.empty_trash("u1").expect("empty");

        assert!(repo.get_photo_including_deleted("theirs").is_ok());
        assert!(repo.get_photo_including_deleted("mine").is_err());
        assert_eq!(membership_count(&pool), 1);
    }

    // MARK: - Paging

    /// Every one of these lands in the same second, which is the shape a bulk import actually
    /// writes: `created_at` alone cannot order them, so this is what the `id` tie-break is for.
    fn insert_photos_in_one_second(pool: &DbPool, user_id: &str, n: usize) {
        for i in 0..n {
            insert_photo(pool, &format!("photo-{i:04}"), user_id, false);
        }
    }

    #[test]
    fn paging_walks_the_library_once_without_repeating_or_dropping_a_photo() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photos_in_one_second(&pool, "u1", 25);

        let mut seen: Vec<String> = Vec::new();
        let mut offset = 0;
        loop {
            let page = repo
                .list_photos(
                    "u1",
                    true,
                    false,
                    PhotoOrder::default(),
                    Some(PhotoPage { limit: 10, offset }),
                )
                .expect("page");
            if page.is_empty() {
                break;
            }
            seen.extend(page.iter().map(|p| p.id.clone()));
            offset += 10;
        }

        let unique: std::collections::HashSet<&String> = seen.iter().collect();
        assert_eq!(
            seen.len(),
            25,
            "paging saw {} rows, expected 25",
            seen.len()
        );
        assert_eq!(unique.len(), 25, "paging repeated a photo");

        let whole = repo
            .list_photos("u1", true, false, PhotoOrder::default(), None)
            .expect("whole");
        assert_eq!(
            seen,
            whole.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
            "paged order must match the unpaged order"
        );
    }

    #[test]
    fn a_page_is_bounded_and_starts_where_it_was_asked_to() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photos_in_one_second(&pool, "u1", 10);

        let whole = repo
            .list_photos("u1", true, false, PhotoOrder::default(), None)
            .expect("whole");
        let page = repo
            .list_photos(
                "u1",
                true,
                false,
                PhotoOrder::default(),
                Some(PhotoPage {
                    limit: 3,
                    offset: 4,
                }),
            )
            .expect("page");

        assert_eq!(page.len(), 3);
        assert_eq!(
            page.iter().map(|p| p.id.clone()).collect::<Vec<_>>(),
            whole[4..7].iter().map(|p| p.id.clone()).collect::<Vec<_>>()
        );
    }

    #[test]
    fn an_offset_past_the_end_is_an_empty_page_rather_than_an_error() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photos_in_one_second(&pool, "u1", 3);

        let page = repo
            .list_photos(
                "u1",
                true,
                false,
                PhotoOrder::default(),
                Some(PhotoPage {
                    limit: 10,
                    offset: 99,
                }),
            )
            .expect("page");

        assert!(page.is_empty());
    }

    // MARK: - Ordering

    /// Inserts a photo that arrived at `created_at` carrying `capture_date`, so a test can build
    /// the case the two orders disagree on. `capture_date` of `None` is a file with no EXIF date.
    fn insert_photo_dated(
        pool: &DbPool,
        id: &str,
        user_id: &str,
        created_at: &str,
        capture_date: Option<&str>,
    ) {
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO photos (id, user_id, file_id, is_starred, is_archived, deleted_at, \
             capture_date, created_at, updated_at) VALUES (?, ?, ?, 0, 0, NULL, ?, ?, ?)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(user_id)
        .bind::<diesel::sql_types::Text, _>(format!("file-{}", id))
        .bind::<diesel::sql_types::Nullable<diesel::sql_types::Text>, _>(capture_date)
        .bind::<diesel::sql_types::Text, _>(created_at)
        .bind::<diesel::sql_types::Text, _>(created_at)
        .execute(&mut conn)
        .expect("insert dated photo");
    }

    fn ids(records: &[PhotoRecord]) -> Vec<String> {
        records.iter().map(|p| p.id.clone()).collect()
    }

    /// The case the whole parameter exists for. A scanned print is registered today and belongs in
    /// 1998; a photo taken yesterday off a year-old upload belongs at the top. The two orders are
    /// not a reshuffle of each other — they invert.
    #[test]
    fn capture_order_sorts_by_when_the_picture_was_taken_not_when_it_arrived() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photo_dated(
            &pool,
            "scan-of-1998",
            "u1",
            "2026-09-16 10:00:00",
            Some("1998-06-01 12:00:00"),
        );
        insert_photo_dated(
            &pool,
            "taken-yesterday",
            "u1",
            "2025-09-16 10:00:00",
            Some("2026-09-15 12:00:00"),
        );

        let by_created = repo
            .list_photos("u1", true, false, PhotoOrder::Created, None)
            .expect("created");
        assert_eq!(ids(&by_created), vec!["scan-of-1998", "taken-yesterday"]);

        let by_capture = repo
            .list_photos("u1", true, false, PhotoOrder::Capture, None)
            .expect("capture");
        assert_eq!(
            ids(&by_capture),
            vec!["taken-yesterday", "scan-of-1998"],
            "capture order must invert the arrival order here, not echo it"
        );
    }

    /// A photo with no EXIF date files under when it arrived, exactly as `timelineDate` does on the
    /// client. Sorting on the bare nullable column would bunch every such photo at one end instead.
    #[test]
    fn a_photo_without_a_capture_date_falls_back_to_when_it_arrived() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photo_dated(
            &pool,
            "has-exif",
            "u1",
            "2020-01-01 00:00:00",
            Some("2026-01-01 00:00:00"),
        );
        insert_photo_dated(&pool, "no-exif", "u1", "2023-01-01 00:00:00", None);
        insert_photo_dated(
            &pool,
            "older-exif",
            "u1",
            "2026-01-01 00:00:00",
            Some("2021-01-01 00:00:00"),
        );

        let by_capture = repo
            .list_photos("u1", true, false, PhotoOrder::Capture, None)
            .expect("capture");

        // 2026 capture, then the 2023 arrival standing in for a missing capture, then 2021 capture.
        assert_eq!(ids(&by_capture), vec!["has-exif", "no-exif", "older-exif"]);
    }

    /// The property paging rests on: pages cut along capture order must reassemble into exactly the
    /// unpaged capture order, with nothing repeated and nothing missed. A shared capture date is
    /// the shape a scanned batch writes, and is what the `id` tie-break is there for.
    #[test]
    fn capture_order_pages_without_repeating_or_dropping_a_photo() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        for i in 0..25 {
            // Half share one capture date, half have none at all — both tie cases at once.
            let capture = if i % 2 == 0 {
                Some("2024-05-05 09:00:00")
            } else {
                None
            };
            insert_photo_dated(
                &pool,
                &format!("photo-{i:04}"),
                "u1",
                "2026-02-02 08:00:00",
                capture,
            );
        }

        let whole = repo
            .list_photos("u1", true, false, PhotoOrder::Capture, None)
            .expect("whole");

        let mut seen: Vec<String> = Vec::new();
        let mut offset = 0;
        loop {
            let page = repo
                .list_photos(
                    "u1",
                    true,
                    false,
                    PhotoOrder::Capture,
                    Some(PhotoPage { limit: 10, offset }),
                )
                .expect("page");
            if page.is_empty() {
                break;
            }
            seen.extend(ids(&page));
            offset += 10;
        }

        let unique: std::collections::HashSet<&String> = seen.iter().collect();
        assert_eq!(seen.len(), 25);
        assert_eq!(unique.len(), 25, "capture paging repeated a photo");
        assert_eq!(
            seen,
            ids(&whole),
            "paged capture order must match the unpaged capture order"
        );
    }

    /// Ordering and filtering are independent: asking for capture order must not quietly widen the
    /// listing to archived photos the caller did not ask for.
    #[test]
    fn capture_order_still_honours_the_filters() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photo_dated(
            &pool,
            "live",
            "u1",
            "2026-01-01 00:00:00",
            Some("2026-01-01 00:00:00"),
        );
        insert_photo(&pool, "archived", "u1", false);
        {
            let mut conn = pool.get().expect("conn");
            diesel::sql_query("UPDATE photos SET is_archived = 1 WHERE id = 'archived'")
                .execute(&mut conn)
                .expect("archive");
        }

        let without = repo
            .list_photos("u1", false, false, PhotoOrder::Capture, None)
            .expect("without archived");
        assert_eq!(ids(&without), vec!["live"]);

        let with = repo
            .list_photos("u1", true, false, PhotoOrder::Capture, None)
            .expect("with archived");
        assert_eq!(with.len(), 2);
    }

    /// The count is what tells a paging client how far it has to keep going, so it has to answer
    /// for the whole library and honour the same filters the listing does.
    #[test]
    fn the_count_ignores_the_page_but_not_the_filters() {
        let pool = test_pool();
        let repo = PhotosRepository::new(pool.clone());
        insert_photos_in_one_second(&pool, "u1", 7);
        insert_photo(&pool, "trashed", "u1", true);
        insert_photo(&pool, "someone-else", "u2", false);

        assert_eq!(repo.count_photos("u1", true, false).expect("count"), 7);
        assert_eq!(repo.count_photos("u2", true, false).expect("count"), 1);
    }
}
