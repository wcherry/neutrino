use crate::shared::ApiError;
use crate::slides::slides::model::{
    NewSlideRecord, SlideRecord, UpdateSlideRecord,
    NewThemeRecord, ThemeRecord, UpdateThemeRecord,
};
use crate::schema::{slides, slide_themes};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct SlidesRepository {
    pool: DbPool,
}

impl SlidesRepository {
    pub fn new(pool: DbPool) -> Self {
        SlidesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn insert_slide(&self, new_slide: NewSlideRecord) -> Result<SlideRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(slides::table)
            .values(&new_slide)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert slide error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        slides::table
            .filter(slides::file_id.eq(new_slide.file_id))
            .select(SlideRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after slide insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_slide(&self, file_id: &str) -> Result<SlideRecord, ApiError> {
        let mut conn = self.get_conn()?;
        slides::table
            .filter(slides::file_id.eq(file_id))
            .select(SlideRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Presentation not found"),
                _ => {
                    tracing::error!("DB get slide error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_slide(
        &self,
        file_id: &str,
        changes: UpdateSlideRecord,
    ) -> Result<SlideRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::update(slides::table.filter(slides::file_id.eq(file_id)))
            .set(&changes)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB update slide error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        self.get_slide(file_id)
    }

    // ── Theme methods ───────────────────────────────────────────────────────

    pub fn insert_theme(&self, new_theme: NewThemeRecord) -> Result<ThemeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(slide_themes::table)
            .values(&new_theme)
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB insert theme error: {:?}", e);
                ApiError::internal("Database error")
            })?;
        slide_themes::table
            .filter(slide_themes::id.eq(new_theme.id))
            .select(ThemeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB query after theme insert error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn list_themes_for_user(&self, user_id: &str) -> Result<Vec<ThemeRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        slide_themes::table
            .filter(
                slide_themes::is_system
                    .eq(true)
                    .or(slide_themes::user_id.eq(user_id)),
            )
            .order((slide_themes::is_system.desc(), slide_themes::created_at.asc()))
            .select(ThemeRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB list themes error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    pub fn get_theme(&self, theme_id: &str, user_id: &str) -> Result<ThemeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        slide_themes::table
            .filter(slide_themes::id.eq(theme_id))
            .filter(slide_themes::user_id.eq(user_id))
            .select(ThemeRecord::as_select())
            .first(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::NotFound => ApiError::not_found("Theme not found"),
                _ => {
                    tracing::error!("DB get theme error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })
    }

    pub fn update_theme(
        &self,
        theme_id: &str,
        user_id: &str,
        changes: UpdateThemeRecord,
    ) -> Result<ThemeRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let rows = diesel::update(
            slide_themes::table
                .filter(slide_themes::id.eq(theme_id))
                .filter(slide_themes::user_id.eq(user_id)),
        )
        .set(&changes)
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB update theme error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if rows == 0 {
            return Err(ApiError::not_found("Theme not found"));
        }
        self.get_theme(theme_id, user_id)
    }

    pub fn delete_theme(&self, theme_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        let rows = diesel::delete(
            slide_themes::table
                .filter(slide_themes::id.eq(theme_id))
                .filter(slide_themes::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB delete theme error: {:?}", e);
            ApiError::internal("Database error")
        })?;
        if rows == 0 {
            return Err(ApiError::not_found("Theme not found"));
        }
        Ok(())
    }
}
