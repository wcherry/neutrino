// ── branding::model ───────────────────────────────────────────────────────────

use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::instance_branding)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct BrandingRecord {
    pub id: i32,
    pub name: Option<String>,
    /// `#rrggbb`, checked for contrast before it was stored.
    pub accent: Option<String>,
    pub sign_in_message: Option<String>,
    /// Changes on every write to the branding or to an asset; cache-busts the asset URLs.
    pub version: String,
    pub updated_by: Option<String>,
    pub updated_at: String,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::instance_branding_assets)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AssetRecord {
    pub kind: String,
    pub mime_type: String,
    pub bytes: Vec<u8>,
    pub updated_at: String,
}

/// Which assets exist, without their bytes — what every HTML page needs to know.
#[derive(Debug, Clone)]
pub struct AssetSummary {
    pub kind: String,
}
