use crate::photos::albums::model::{
    AlbumPhotoRecord, AlbumRecord, NewAlbumPhotoRecord, NewAlbumRecord, UpdateAlbumRecord,
};
use crate::schema::{album_photos, albums};
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

    #[allow(dead_code)]
    pub fn list_album_photos(&self, album_id: &str) -> Result<Vec<AlbumPhotoRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        album_photos::table
            .filter(album_photos::album_id.eq(album_id))
            .order(album_photos::added_at.desc())
            .select(AlbumPhotoRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list album photos error: {:?}", e);
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

    pub fn count_album_photos(&self, album_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.get_conn()?;
        let count: i64 = album_photos::table
            .filter(album_photos::album_id.eq(album_id))
            .count()
            .get_result(&mut conn)
            .map_err(|e| {
                tracing::error!("DB count album photos error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        Ok(count as usize)
    }
}
