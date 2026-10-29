//! Friend invites: emailed, single-use invitations and a reusable personal
//! link, either of which lets someone sign up while public sign-up is closed.
//!
//! See `agent_docs/plans/feature-onboarding-invites.md`.

pub mod api;
pub mod email;
pub mod model;
pub mod repository;
pub mod service;

#[cfg(test)]
mod tests;
