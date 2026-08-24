//! The caller's *key file* — the retired identity keys a client stashes so it
//! can still open files sealed to a version it has rotated away from.
//!
//! Two things live here, and they answer the two halves of a rotation:
//!
//!   * `key-file` stores the keys themselves. The blob is client-encrypted, as
//!     everything E2EE on this server is: the entries arrive already wrapped
//!     and the server only ever files them away under the user's private
//!     storage (`.Private/keys/{user_id}/.keyfile`), never in the Drive tree
//!     and never in a table.
//!   * `key-versions` reports which of the caller's files are still sealed to
//!     which version, so a client can tell whether an old key is still load
//!     bearing before it drops it — and how much re-sealing it is signing up
//!     for if it wants to retire one.

pub mod api;
pub mod dto;
pub mod service;
