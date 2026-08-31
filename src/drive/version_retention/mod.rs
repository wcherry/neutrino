//! The workspace's file-version retention policy.
//!
//! One row, read by the background worker's sweep and written from the admin
//! console. The app never enforces it — it only stores and serves it — so that
//! there is exactly one place versions are deleted from.
pub mod api;
pub mod model;
pub mod repository;
