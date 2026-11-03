use chrono::NaiveDateTime;
use diesel::prelude::*;

use crate::schema::product_updates;

/// One row of `product_updates`: an announcement an administrator wrote.
#[derive(Debug, Clone, PartialEq, Queryable, Selectable)]
#[diesel(table_name = product_updates)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ProductUpdateRecord {
    pub id: String,
    pub title: String,
    /// Plain text. Blank lines separate paragraphs.
    pub body: String,
    pub created_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    /// `None` while it is a draft. The weekly email carries the updates
    /// published during its week.
    pub published_at: Option<NaiveDateTime>,
}

#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = product_updates)]
pub struct NewProductUpdate {
    pub id: String,
    pub title: String,
    pub body: String,
    pub created_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Someone the weekly email may go to, and which parts they asked for.
#[derive(Debug, Clone, PartialEq)]
pub struct Recipient {
    pub id: String,
    pub email: String,
    pub name: String,
    /// "General" email: their own activity and their teams'.
    pub general: bool,
    /// "Product updates" email.
    pub updates: bool,
}

/// What a Team Space's members did to its files during the week, by people
/// other than the recipient.
#[derive(Debug, Clone, PartialEq)]
pub struct TeamActivity {
    pub team_id: String,
    pub team_name: String,
    pub changes: i64,
    pub people: i64,
    pub files: i64,
}
