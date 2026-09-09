//! The columns of the main app's schema this tool reads.
//!
//! A subset, deliberately: `src/schema.rs` is thousands of lines and this
//! process touches five tables read-only. Only the columns named below are
//! ever put in a query, so the subset cannot generate SQL for a column it does
//! not declare.

diesel::table! {
    files (id) {
        id -> Text,
        user_id -> Text,
        name -> Text,
        size_bytes -> BigInt,
        mime_type -> Text,
        storage_path -> Text,
        /// The `{name, mimeType}` JSON sealed to the file's DEK, base64url.
        /// NULL for a file uploaded before E2EE, which is plaintext on disk.
        encrypted_metadata -> Nullable<Text>,
        deleted_at -> Nullable<Timestamp>,
    }
}

diesel::table! {
    file_key_refs (id) {
        id -> Text,
        file_id -> Text,
        user_id -> Text,
        /// The DEK, sealed to `key_version`'s public key, base64url.
        encrypted_file_key -> Text,
        key_version -> Integer,
    }
}

diesel::table! {
    file_versions (id) {
        id -> Text,
        file_id -> Text,
        version_number -> Integer,
        size_bytes -> BigInt,
        storage_path -> Text,
        label -> Nullable<Text>,
        created_at -> Timestamp,
    }
}

diesel::table! {
    user_public_keys (user_id, version) {
        user_id -> Text,
        version -> Integer,
        public_key -> Text,
        retired_at -> Nullable<Timestamp>,
    }
}

diesel::table! {
    users (id) {
        id -> Text,
        email -> Text,
    }
}
