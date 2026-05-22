use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::event_attachments)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AttachmentRecord {
    pub id: String,
    pub event_id: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::event_attachments)]
pub struct NewAttachmentRecord {
    pub id: String,
    pub event_id: String,
    pub file_id: Option<String>,
    pub name: Option<String>,
    pub note: Option<String>,
}
