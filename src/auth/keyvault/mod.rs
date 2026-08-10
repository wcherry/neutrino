//! Server-side storage for the user's wrapped E2EE identity key.
//!
//! Every value here is opaque ciphertext. The server stores and returns blobs
//! so a client on a new device can bootstrap, but holds nothing that opens
//! them — see `migrations/00105_auth__2026-08-10-000000_create_key_vault`.

pub mod api;
pub mod model;
pub mod repository;
pub mod service;
