//! The checks every public sign-up passes before its account is written.
//!
//! The order matters. Cheap checks that need no state come first (address
//! shape and domain), then the CAPTCHA, then the limits. A limit is taken by
//! *reserving* a `signup_events` row first and only then counting, so two
//! concurrent requests both see each other and neither slips past a limit
//! together. A reservation is released if the account is not created, so a
//! typo or a taken email costs nothing.

use std::sync::Arc;

use chrono::{Duration, NaiveDateTime, Utc};
use uuid::Uuid;

use super::config::SignupGuardConfig;
use super::domains;
use super::repository::{NewSignupEvent, SignupGuardRepository};
use super::turnstile::{CaptchaOutcome, CaptchaVerifier};
use crate::shared::ApiError;

/// A sign-up's place in the limits, held while its account is created.
#[derive(Debug)]
pub struct Reservation {
    id: String,
}

/// What the guard knows about one sign-up request.
pub struct SignupAttempt<'a> {
    pub email: &'a str,
    pub ip: &'a str,
    pub captcha_token: Option<&'a str>,
    /// The request spent a valid invite, which is proof enough of a person.
    pub invited: bool,
}

pub struct SignupGuard {
    repo: Arc<SignupGuardRepository>,
    config: SignupGuardConfig,
    captcha: Option<Arc<dyn CaptchaVerifier>>,
}

fn rate_limited(message: impl Into<String>) -> ApiError {
    ApiError::new(429, "SIGNUP_RATE_LIMITED", message)
}

impl SignupGuard {
    pub fn new(
        repo: Arc<SignupGuardRepository>,
        config: SignupGuardConfig,
        captcha: Option<Arc<dyn CaptchaVerifier>>,
    ) -> Self {
        SignupGuard { repo, config, captcha }
    }

    /// The site key the web app renders the CAPTCHA with, when one is configured.
    pub fn captcha_site_key(&self) -> Option<&str> {
        self.captcha
            .as_ref()
            .and(self.config.turnstile_site_key.as_deref())
    }

    /// Refuses addresses that are malformed or on a blocked domain. Runs before
    /// anything is claimed or counted.
    pub fn check_email(&self, email: &str) -> Result<String, ApiError> {
        let domain = domains::email_domain(email).ok_or_else(|| {
            ApiError::new(400, "INVALID_EMAIL", "Enter a valid email address.")
        })?;
        if domains::is_blocked(&domain, &self.config.blocked_domains) {
            tracing::info!(%domain, "refused a sign-up from a blocked email domain");
            return Err(ApiError::new(
                400,
                "EMAIL_DOMAIN_NOT_ALLOWED",
                "Sign-up with this email provider isn't allowed. Please use a different address.",
            ));
        }
        Ok(domain)
    }

    /// Whether the request proved a person is behind it. An invalid token is
    /// an error, so the web app can reset its widget; no token at all is just
    /// "not verified", which is how the native apps sign up today.
    async fn human_verified(&self, attempt: &SignupAttempt<'_>) -> Result<bool, ApiError> {
        if attempt.invited {
            return Ok(true);
        }
        let Some(captcha) = &self.captcha else {
            return Ok(false);
        };
        let Some(token) = attempt.captcha_token.map(str::trim).filter(|t| !t.is_empty()) else {
            return Ok(false);
        };
        match captcha.verify(token, attempt.ip).await {
            CaptchaOutcome::Passed => Ok(true),
            CaptchaOutcome::Unavailable => Ok(false),
            CaptchaOutcome::Failed => Err(ApiError::new(
                400,
                "CAPTCHA_FAILED",
                "We couldn't confirm you're human. Please try the check again.",
            )),
        }
    }

    /// Runs every check and reserves a place in the limits. Call
    /// [`Self::confirm`] once the account exists, or [`Self::release`] if it
    /// was not created.
    pub async fn admit(&self, attempt: SignupAttempt<'_>) -> Result<Reservation, ApiError> {
        let domain = self.check_email(attempt.email)?;
        let verified = self.human_verified(&attempt).await?;

        let now = Utc::now().naive_utc();
        let reservation = Reservation { id: Uuid::new_v4().to_string() };
        self.repo.insert(NewSignupEvent {
            id: &reservation.id,
            user_id: None,
            ip: attempt.ip,
            email_domain: &domain,
            human_verified: verified as i32,
            created_at: now,
        })?;

        if let Err(e) = self.check_limits(attempt.ip, verified, now) {
            self.release(reservation);
            return Err(e);
        }
        Ok(reservation)
    }

    fn check_limits(&self, ip: &str, verified: bool, now: NaiveDateTime) -> Result<(), ApiError> {
        let c = &self.config;
        let hour = now - Duration::hours(1);
        let day = now - Duration::days(1);
        // Counts include this request's own reservation, hence `>`.
        let over = |limit: i64, since, ip: Option<&str>, unverified: bool| -> Result<bool, ApiError> {
            Ok(limit > 0 && self.repo.count_since(since, ip, unverified)? > limit)
        };

        if over(c.ip_hourly, hour, Some(ip), false)? || over(c.ip_daily, day, Some(ip), false)? {
            tracing::warn!(%ip, "sign-up refused: per-IP limit reached");
            return Err(rate_limited(
                "Too many accounts have been created from your network recently. Please try again later.",
            ));
        }
        if self.captcha.is_some() && !verified {
            if over(c.unverified_ip_daily, day, Some(ip), true)?
                || over(c.unverified_global_hourly, hour, None, true)?
            {
                tracing::warn!(%ip, "sign-up refused: limit for sign-ups without a CAPTCHA reached");
                return Err(ApiError::new(
                    429,
                    "SIGNUP_CAPTCHA_REQUIRED",
                    "Sign-up from this app is busy right now. Please create your account on the web, \
                     then sign in here.",
                ));
            }
        }
        if over(c.global_hourly, hour, None, false)? {
            tracing::warn!("sign-up refused: server-wide hourly limit reached");
            return Err(rate_limited(
                "Sign-up is very busy right now. Please try again in a little while.",
            ));
        }
        Ok(())
    }

    /// Ties the reservation to the account it produced.
    pub fn confirm(&self, reservation: Reservation, user_id: &str) {
        if let Err(e) = self.repo.attach_user(&reservation.id, user_id) {
            tracing::error!(%user_id, "could not record a sign-up event: {}", e);
        }
    }

    /// Gives back a reservation whose account was not created.
    pub fn release(&self, reservation: Reservation) {
        if let Err(e) = self.repo.delete(&reservation.id) {
            tracing::error!("could not release a sign-up reservation: {}", e);
        }
    }

    pub fn repo(&self) -> &SignupGuardRepository {
        &self.repo
    }
}
