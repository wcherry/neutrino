use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::albums)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AlbumRecord {
    pub id: String,
    pub user_id: String,
    pub title: String,
    pub description: Option<String>,
    pub is_auto: bool,
    pub person_id: Option<String>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::albums)]
pub struct NewAlbumRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub title: &'a str,
    pub description: Option<&'a str>,
    pub is_auto: bool,
    pub person_id: Option<&'a str>,
}

#[derive(Debug, AsChangeset, Default)]
#[diesel(table_name = crate::schema::albums)]
pub struct UpdateAlbumRecord {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub updated_at: NaiveDateTime,
}

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::album_photos)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AlbumPhotoRecord {
    pub album_id: String,
    pub photo_id: String,
    pub added_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::album_photos)]
pub struct NewAlbumPhotoRecord<'a> {
    pub album_id: &'a str,
    pub photo_id: &'a str,
}
