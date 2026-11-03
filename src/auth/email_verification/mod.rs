//! Email verification: a new account is mailed a single-use link that proves it
//! owns its address.
//!
//! How strict that is depends on [`policy::VerificationMode`]:
//!
//! - `off` — nothing is sent and nothing is asked.
//! - `soft` — the link is sent and the web app shows a banner until it is
//!   followed. Nothing is refused.
//! - `enforce` — as `soft`, and sharing and password reset wait for a verified
//!   address, and an account still unverified [`policy::GRACE_DAYS`] days after
//!   it was created cannot sign in until it verifies.
//!
//! Accounts that existed before migration 152 count as verified.

pub mod api;
pub mod email;
pub mod model;
pub mod policy;
pub mod repository;
pub mod service;

#[cfg(test)]
mod tests;
