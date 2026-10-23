// ── branding::repository ──────────────────────────────────────────────────────
//
// Follows `preferences::repository`'s connection and error-mapping style.

use crate::branding::model::{AssetRecord, AssetSummary, BrandingRecord};
use crate::schema::{instance_branding, instance_branding_assets};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub struct BrandingRepository {
    pool: DbPool,
}

/// The fields an administrator sets, as stored.
pub struct BrandingFields<'a> {
    pub name: Option<&'a str>,
    pub accent: Option<&'a str>,
    pub sign_in_message: Option<&'a str>,
}

fn db_error(context: &str) -> impl Fn(diesel::result::Error) -> ApiError + '_ {
    move |e| {
        tracing::error!("DB {context} error: {:?}", e);
        ApiError::internal("Database error")
    }
}

impl BrandingRepository {
    pub fn new(pool: DbPool) -> Self {
        BrandingRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn get(&self) -> Result<Option<BrandingRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        instance_branding::table
            .select(BrandingRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_error("get branding"))
    }

    pub fn assets(&self) -> Result<Vec<AssetSummary>, ApiError> {
        let mut conn = self.get_conn()?;
        instance_branding_assets::table
            .select(instance_branding_assets::kind)
            .order(instance_branding_assets::kind.asc())
            .load::<String>(&mut conn)
            .map(|kinds| kinds.into_iter().map(|kind| AssetSummary { kind }).collect())
            .map_err(db_error("list branding assets"))
    }

    pub fn asset(&self, kind: &str) -> Result<Option<AssetRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        instance_branding_assets::table
            .filter(instance_branding_assets::kind.eq(kind))
            .select(AssetRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_error("get branding asset"))
    }

    /// Write the fields and move the version on, creating the row if there is none.
    pub fn put(&self, fields: &BrandingFields, version: &str, by: &str, now: &str) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        diesel::insert_into(instance_branding::table)
            .values((
                instance_branding::id.eq(1),
                instance_branding::name.eq(fields.name),
                instance_branding::accent.eq(fields.accent),
                instance_branding::sign_in_message.eq(fields.sign_in_message),
                instance_branding::version.eq(version),
                instance_branding::updated_by.eq(by),
                instance_branding::updated_at.eq(now),
            ))
            .on_conflict(instance_branding::id)
            .do_update()
            .set((
                instance_branding::name.eq(fields.name),
                instance_branding::accent.eq(fields.accent),
                instance_branding::sign_in_message.eq(fields.sign_in_message),
                instance_branding::version.eq(version),
                instance_branding::updated_by.eq(by),
                instance_branding::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map(|_| ())
            .map_err(db_error("put branding"))
    }

    /// Store (or, with `None`, remove) one asset and move the branding version on, in one
    /// transaction so a reader never sees the new image under the old version's URL.
    pub fn put_asset(
        &self,
        kind: &str,
        asset: Option<(&str, &[u8])>,
        version: &str,
        by: &str,
        now: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            match asset {
                Some((mime, bytes)) => {
                    diesel::insert_into(instance_branding_assets::table)
                        .values((
                            instance_branding_assets::kind.eq(kind),
                            instance_branding_assets::mime_type.eq(mime),
                            instance_branding_assets::bytes.eq(bytes),
                            instance_branding_assets::updated_at.eq(now),
                        ))
                        .on_conflict(instance_branding_assets::kind)
                        .do_update()
                        .set((
                            instance_branding_assets::mime_type.eq(mime),
                            instance_branding_assets::bytes.eq(bytes),
                            instance_branding_assets::updated_at.eq(now),
                        ))
                        .execute(conn)?;
                }
                None => {
                    diesel::delete(instance_branding_assets::table.filter(instance_branding_assets::kind.eq(kind)))
                        .execute(conn)?;
                }
            }
            // The version lives on the branding row; an asset uploaded before any text was set
            // creates an otherwise empty one.
            diesel::insert_into(instance_branding::table)
                .values((
                    instance_branding::id.eq(1),
                    instance_branding::version.eq(version),
                    instance_branding::updated_by.eq(by),
                    instance_branding::updated_at.eq(now),
                ))
                .on_conflict(instance_branding::id)
                .do_update()
                .set((
                    instance_branding::version.eq(version),
                    instance_branding::updated_by.eq(by),
                    instance_branding::updated_at.eq(now),
                ))
                .execute(conn)?;
            Ok(())
        })
        .map_err(db_error("put branding asset"))
    }
}
