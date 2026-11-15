//! Protection against scripted mass sign-up.
//!
//! Every public sign-up passes through [`service::SignupGuard`] before an
//! account row is written:
//!
//! 1. **Address checks.** The email must look like an address, and its domain
//!    must not be a known throwaway-mail provider or one an operator has
//!    blocked (`SIGNUP_BLOCKED_EMAIL_DOMAINS`).
//! 2. **CAPTCHA.** When `TURNSTILE_SECRET_KEY` is set, a Cloudflare Turnstile
//!    token sent with the request is checked with Cloudflare. A request with a
//!    valid token, or a valid invite, counts as *human-verified*.
//! 3. **Rate limits.** Counted from `signup_events`, so they survive restarts:
//!    sign-ups per client IP per hour and per day, sign-ups server-wide per
//!    hour, and — while Turnstile is configured — much tighter per-IP and
//!    server-wide limits for requests that are not human-verified. That last
//!    bucket is what the native apps use until they show a CAPTCHA, so they
//!    keep working while a script without a token is held to a trickle.
//!
//! The admin side ([`api`]) shows where recent sign-ups came from and soft
//! deletes a batch of accounts by IP, email domain and creation window.

pub mod api;
pub mod client_ip;
pub mod config;
pub mod domains;
pub mod repository;
pub mod service;
pub mod turnstile;

#[cfg(test)]
mod tests;
