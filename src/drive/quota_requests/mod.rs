//! Storage-increase requests — the admin console's work queue (issue #144).
//!
//! A user who has run out of room asks for a bigger limit from the storage
//! meter; the ask lands here as a pending row, an admin approves or denies it,
//! and approving is what writes the new limit. The table is the record of the
//! ask and the decision, never the limit itself, so a quota an admin changes by
//! hand afterwards does not have to be reconciled with it.
pub mod api;
pub mod model;
pub mod repository;

/// The states a request moves through. A row leaves `PENDING` exactly once.
pub const STATUS_PENDING: &str = "pending";
pub const STATUS_APPROVED: &str = "approved";
pub const STATUS_DENIED: &str = "denied";

/// The largest limit a user may ask for: 100 TB. Not a policy about what an
/// admin may grant — they set limits directly — only a bound on what arrives
/// from a browser, so a mistyped figure is refused at the door rather than
/// sitting in the queue as an obvious absurdity.
pub const MAX_REQUESTABLE_BYTES: i64 = 100 * 1024 * 1024 * 1024 * 1024;
