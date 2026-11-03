//! The weekly email: once a week, each account hears what happened to it, what
//! happened in its Team Spaces, and what an administrator announced.
//!
//! - **Your week** — files and folders shared with you, mentions, replies,
//!   action items and access requests, from the notifications stored that
//!   week, and how much of your storage is used. Needs "General" email on.
//! - **Your teams** — how many changes how many people made to each Team
//!   Space's files. Counts only: team files are end-to-end encrypted, so their
//!   names never go into an email. Needs "General" email on.
//! - **What's new** — product updates an administrator published that week.
//!   Needs "Product updates" email on.
//!
//! It goes out from Monday 09:00 UTC and covers the seven days before that
//! Monday. An account with nothing to report is sent nothing. `weekly_emails`
//! holds one row per account per week, written before sending, so a restart or
//! a second instance never sends a week twice.

pub mod api;
pub mod compose;
pub mod model;
pub mod repository;
pub mod service;

#[cfg(test)]
mod tests;
