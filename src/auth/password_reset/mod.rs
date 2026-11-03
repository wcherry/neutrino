//! Self-serve password reset: "Forgot password?" on the sign-in page emails a
//! single-use link, and the link's page sets a new password.
//!
//! Encryption is unaffected. Identity keys live only on the user's devices and
//! are never derived from the password (`agent_docs/client-only-key-architecture.md`),
//! so a reset changes how the account signs in and nothing about what it can
//! decrypt.

pub mod api;
pub mod email;
pub mod model;
pub mod repository;
pub mod service;

#[cfg(test)]
mod tests;
