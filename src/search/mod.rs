//! Encrypted search-index snapshot sync.
//!
//! There is no server-side search: the index lives in the browser (IndexedDB,
//! see `web/packages/search`) and every query is answered locally. What this
//! module adds is *multi-device consistency* — a client periodically uploads
//! its whole index, encrypted, so a second device can restore it instead of
//! re-fetching and re-decrypting every document the user owns.
//!
//! The server stores ciphertext and nothing else. The snapshot's data key
//! arrives already sealed to the uploading user's own public key, exactly as
//! file DEKs do, so the server can hand the blob back but never open it.

pub mod api;
pub mod dto;
pub mod model;
pub mod repository;
pub mod service;
