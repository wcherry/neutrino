use crate::photos::photos::model::{
    LockedFolderSettings, NewLockedFolderSettings, NewPhotoEdit, NewPhotoRecord, PhotoEdit,
    PhotoRecord, UpdatePhotoRecord,
};
use crate::schema::{locked_folder_settings, photo_edits, photos};
use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

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
    ) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let mut query = photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .into_boxed();

        if !include_archived {
            query = query.filter(photos::is_archived.eq(false));
        }
        if starred_only {
            query = query.filter(photos::is_starred.eq(true));
        }

        query
            .order(photos::created_at.desc())
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list photos error: {:?}", e);
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

    pub fn delete_expired_trash(&self, before: NaiveDateTime) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            photos::table
                .filter(photos::deleted_at.is_not_null())
                .filter(photos::deleted_at.le(before)),
        )
        .execute(&mut conn)
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

    pub fn empty_trash(&self, user_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::delete(
            photos::table
                .filter(photos::user_id.eq(user_id))
                .filter(photos::deleted_at.is_not_null()),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB empty trash error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    /// List photos that have GPS coordinates (latitude/longitude) in their metadata JSON.
    pub fn list_photos_with_gps(&self, user_id: &str, limit: i64) -> Result<Vec<PhotoRecord>, ApiError> {
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
            .filter(
                diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                    "strftime('%m', capture_date) = '{}' AND strftime('%d', capture_date) = '{}'",
                    month_str, day_str
                ))
            )
            .order(photos::capture_date.desc())
            .select(PhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list photos by month/day error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// List photos from a given year (for year-in-review).
    pub fn list_photos_by_year(&self, user_id: &str, year: i32, limit: i64) -> Result<Vec<PhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        let year_str = format!("{}", year);
        photos::table
            .filter(photos::user_id.eq(user_id))
            .filter(photos::deleted_at.is_null())
            .filter(photos::capture_date.is_not_null())
            .filter(
                diesel::dsl::sql::<diesel::sql_types::Bool>(&format!(
                    "strftime('%Y', capture_date) = '{}'",
                    year_str
                ))
            )
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

    pub fn get_locked_folder_settings(&self, user_id: &str) -> Result<Option<LockedFolderSettings>, ApiError> {
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

    pub fn upsert_locked_folder_settings(&self, settings: NewLockedFolderSettings) -> Result<LockedFolderSettings, ApiError> {
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
