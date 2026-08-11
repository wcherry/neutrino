//! Spreadsheet-specific concerns only.
//!
//! Sheet CRUD used to live here as a thin pass-through to `DriveClient`; it now
//! goes straight to the generic drive file endpoints, with
//! `application/x-neutrino-sheet` (see `drive::storage::native_types`) marking
//! a file as a spreadsheet. What remains is what drive has no notion of:
//! named ranges, the AI features, and the editor presence socket.

pub mod ai;
pub mod named_ranges;
pub mod presence;
