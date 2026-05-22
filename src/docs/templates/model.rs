use diesel::prelude::*;

#[derive(Queryable, Selectable, Debug, Clone)]
#[diesel(table_name = crate::schema::doc_templates)]
pub struct DocTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system: i32,
    pub is_default: i32,
    pub category: Option<String>,
    pub content_json: String,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(Insertable, Debug)]
#[diesel(table_name = crate::schema::doc_templates)]
pub struct NewDocTemplate {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub is_system: i32,
    pub is_default: i32,
    pub category: Option<String>,
    pub content_json: String,
    pub created_at: chrono::NaiveDateTime,
    pub updated_at: chrono::NaiveDateTime,
}

#[derive(AsChangeset, Debug, Default)]
#[diesel(table_name = crate::schema::doc_templates)]
pub struct UpdateDocTemplate {
    pub name: Option<String>,
    pub description: Option<Option<String>>,
    pub is_default: Option<i32>,
    pub category: Option<Option<String>>,
    pub updated_at: Option<chrono::NaiveDateTime>,
}
