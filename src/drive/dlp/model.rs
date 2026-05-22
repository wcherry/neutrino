use chrono::NaiveDateTime;
use diesel::prelude::*;
use crate::schema::{dlp_rules, dlp_violations};

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = dlp_rules)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DlpRule {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub pattern: String,
    pub pattern_type: String,
    pub action: String,
    pub severity: String,
    pub is_active: i32,
    pub created_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = dlp_rules)]
pub struct NewDlpRule<'a> {
    pub id: &'a str,
    pub name: &'a str,
    pub description: Option<&'a str>,
    pub pattern: &'a str,
    pub pattern_type: &'a str,
    pub action: &'a str,
    pub severity: &'a str,
    pub is_active: i32,
    pub created_by: &'a str,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Queryable, Selectable, Clone)]
#[diesel(table_name = dlp_violations)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct DlpViolation {
    pub id: String,
    pub file_id: String,
    pub rule_id: String,
    pub matched_at: NaiveDateTime,
    pub notified_at: Option<NaiveDateTime>,
    pub action_taken: Option<String>,
    pub dismissed_at: Option<NaiveDateTime>,
    pub dismissed_by: Option<String>,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = dlp_violations)]
pub struct NewDlpViolation<'a> {
    pub id: &'a str,
    pub file_id: &'a str,
    pub rule_id: &'a str,
    pub matched_at: NaiveDateTime,
    pub action_taken: Option<&'a str>,
}
