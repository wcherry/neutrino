use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::faces)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct FaceRecord {
    pub id: String,
    pub photo_id: String,
    /// JSON-encoded FaceBoundingBox
    pub bounding_box: String,
    /// Base64-encoded JPEG thumbnail of the cropped face
    pub thumbnail: Option<String>,
    pub thumbnail_mime_type: Option<String>,
    pub person_id: Option<String>,
    /// JSON-encoded embedding vector (reserved for phase 2)
    pub embedding: Option<String>,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::faces)]
pub struct NewFaceRecord<'a> {
    pub id: &'a str,
    pub photo_id: &'a str,
    pub bounding_box: &'a str,
    pub thumbnail: Option<&'a str>,
    pub thumbnail_mime_type: Option<&'a str>,
    pub person_id: Option<&'a str>,
    pub embedding: Option<&'a str>,
    pub created_at: NaiveDateTime,
}
