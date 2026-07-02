// Mirrors the `worker_jobs` table from the main app's schema.
// The worker reads its tasks from this shared table.
diesel::table! {
    worker_jobs (id) {
        id -> Text,
        job_type -> Text,
        payload -> Text,
        status -> Text,
        error_message -> Nullable<Text>,
        worker_id -> Nullable<Text>,
        timeout_secs -> Integer,
        started_at -> Nullable<Timestamp>,
        created_at -> Timestamp,
        updated_at -> Timestamp,
    }
}
