use chrono::NaiveDateTime;
use diesel::prelude::*;

// ── Diagram record ────────────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::diagrams)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DiagramRecord {
    pub file_id: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::diagrams)]
pub struct NewDiagramRecord<'a> {
    pub file_id: &'a str,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::diagrams)]
pub struct UpdateDiagramRecord {
    pub updated_at: NaiveDateTime,
}

// ── Diagram comment record ────────────────────────────────────────────────────

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::diagram_comments)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DiagramCommentRecord {
    pub id: String,
    pub file_id: String,
    pub user_id: String,
    pub content: String,
    pub parent_id: Option<String>,
    pub shape_id: Option<String>,
    pub resolved: bool,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::diagram_comments)]
pub struct NewDiagramCommentRecord<'a> {
    pub id: &'a str,
    pub file_id: &'a str,
    pub user_id: &'a str,
    pub content: &'a str,
    pub parent_id: Option<&'a str>,
    pub shape_id: Option<&'a str>,
    pub resolved: bool,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::diagram_comments)]
pub struct UpdateDiagramCommentRecord {
    pub content: Option<String>,
    pub resolved: Option<bool>,
    pub updated_at: NaiveDateTime,
}
