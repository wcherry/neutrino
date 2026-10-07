//! Saved places for task geofences, stored as ciphertext only. See issue #243 and the calendar
//! repo's `agent_docs/task-geofencing.md`; the envelope is in `agent_docs/end-to-end-encryption.md`.

pub mod api;
pub mod dto;
pub mod model;
pub mod service;
