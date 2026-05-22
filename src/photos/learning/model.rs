use chrono::NaiveDateTime;
use diesel::prelude::*;

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::training_signals)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TrainingSignalRecord {
    pub id: String,
    pub user_id: String,
    pub face_id: String,
    pub person_id: String,
    /// 'accepted' | 'rejected'
    pub action: String,
    pub processed: bool,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::training_signals)]
pub struct NewTrainingSignalRecord<'a> {
    pub id: &'a str,
    pub user_id: &'a str,
    pub face_id: &'a str,
    pub person_id: &'a str,
    pub action: &'a str,
    pub processed: bool,
    pub created_at: NaiveDateTime,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::user_recognition_thresholds)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct UserThresholdRecord {
    pub user_id: String,
    pub auto_tag_threshold: f32,
    pub suggest_threshold: f32,
    pub total_accepts: i32,
    pub total_rejects: i32,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::user_recognition_thresholds)]
pub struct NewUserThresholdRecord<'a> {
    pub user_id: &'a str,
    pub auto_tag_threshold: f32,
    pub suggest_threshold: f32,
    pub total_accepts: i32,
    pub total_rejects: i32,
    pub updated_at: NaiveDateTime,
}
