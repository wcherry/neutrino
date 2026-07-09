// Mirrors tables from the main app's schema that the worker reads or writes.

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

// Detected faces are written here, keyed by the photo they belong to.
diesel::table! {
    faces (id) {
        id -> Text,
        photo_id -> Text,
        bounding_box -> Text,
        thumbnail -> Nullable<Text>,
        thumbnail_mime_type -> Nullable<Text>,
        person_id -> Nullable<Text>,
        embedding -> Nullable<Text>,
        created_at -> Timestamp,
    }
}
