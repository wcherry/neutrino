use crate::photos::faces::model::{FaceRecord, NewFaceRecord};
use crate::schema::faces;
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct FacesRepository {
    pool: DbPool,
}

impl FacesRepository {
    pub fn new(pool: DbPool) -> Self {
        FacesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_face(&self, new_face: NewFaceRecord) -> Result<FaceRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(faces::table)
            .values(&new_face)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert face error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        faces::table
            .filter(faces::id.eq(new_face.id))
            .select(FaceRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after face insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_face(&self, face_id: &str) -> Result<FaceRecord, ApiError> {
        let mut conn = self.get_conn()?;
        faces::table
            .filter(faces::id.eq(face_id))
            .select(FaceRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Face not found"),
                _ => {
                    tracing::error!("DB get face error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn get_faces_by_ids(&self, ids: &[String]) -> Result<Vec<FaceRecord>, ApiError> {
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut conn = self.get_conn()?;
        faces::table
            .filter(faces::id.eq_any(ids))
            .select(FaceRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB get faces by ids error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Return the user_id of the photo that owns this face (for ownership checks).
    pub fn get_photo_user_id(&self, photo_id: &str) -> Result<String, ApiError> {
        use crate::schema::photos;
        let mut conn = self.get_conn()?;
        photos::table
            .filter(photos::id.eq(photo_id))
            .select(photos::user_id)
            .first::<String>(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Photo not found"),
                _ => {
                    tracing::error!("DB get photo user_id error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn list_faces_by_photo(&self, photo_id: &str) -> Result<Vec<FaceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        faces::table
            .filter(faces::photo_id.eq(photo_id))
            .order(faces::created_at.asc())
            .select(FaceRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list faces error: {:?}", e);
                ApiError::internal("Database error")
            })
    }
}
