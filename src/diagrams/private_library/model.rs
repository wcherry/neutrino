use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::diagram_third_party_libraries)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ThirdPartyLibraryRecord {
    pub id: String,
    pub name: String,
    pub url: String,
    pub private_path: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::diagram_third_party_libraries)]
pub struct NewThirdPartyLibraryRecord<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub url: &'a str,
    pub private_path: &'a str,
}
