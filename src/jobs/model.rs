#![allow(dead_code)]

use chrono::NaiveDateTime;
use diesel::prelude::*;

use crate::schema::{worker_jobs, worker_registrations};

#[derive(Debug, Clone, Queryable, Selectable, QueryableByName)]
#[diesel(table_name = worker_jobs)]
pub struct WorkerJobRecord {
    pub id: String,
    pub job_type: String,
    pub payload: String,
    pub status: String,
    pub error_message: Option<String>,
    pub worker_id: Option<String>,
    pub timeout_secs: i32,
    pub started_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = worker_jobs)]
pub struct NewWorkerJobRecord<'a> {
    pub id: &'a str,
    pub job_type: &'a str,
    pub payload: &'a str,
    pub status: &'a str,
    pub timeout_secs: i32,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
}

/// Mutable columns for updating an existing job. `None` fields are left as-is;
/// `error_message` uses a nested option so it can be set to `NULL` explicitly.
#[derive(Debug, AsChangeset)]
#[diesel(table_name = worker_jobs)]
pub struct WorkerJobChanges<'a> {
    pub job_type: Option<&'a str>,
    pub payload: Option<&'a str>,
    pub status: Option<&'a str>,
    pub timeout_secs: Option<i32>,
    pub error_message: Option<Option<&'a str>>,
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = worker_registrations)]
pub struct WorkerRegistrationRecord {
    pub id: String,
    pub callback_url: String,
    pub registered_at: NaiveDateTime,
    pub last_seen_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = worker_registrations)]
pub struct NewWorkerRegistrationRecord<'a> {
    pub id: &'a str,
    pub callback_url: &'a str,
    pub registered_at: NaiveDateTime,
    pub last_seen_at: NaiveDateTime,
}
