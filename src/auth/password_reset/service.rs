//! What a reset link is allowed to do: who gets one, how often, and the checks
//! it goes through before it sets a password.

use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::model::{NewPasswordReset, PasswordResetRecord};
use super::repository::PasswordResetRepository;
use crate::auth::email_verification::policy::VerificationMode;
use crate::auth::repository::{AuthRepository, User};
use crate::auth::service::AuthService;
use crate::auth::totp::verify_totp;
use crate::shared::mail::{Mailer, Message};
use crate::shared::ApiError;

/// How long a reset link works.
pub const RESET_TTL_MINUTES: i64 = 60;
/// Links one account may be sent in a rolling hour. Requests past it are
/// answered exactly like any other and send nothing, so the form cannot be
/// used to flood someone's inbox.
pub const MAX_RESETS_PER_HOUR: i64 = 3;

/// SHA-256 of the token, lower-case hex (64 chars).
pub fn hash_reset_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn not_found() -> ApiError {
    ApiError::new(
        404,
        "RESET_NOT_FOUND",
        "This reset link isn't valid. Ask for a new one.",
    )
}

/// A link that was stored and still has to be mailed.
#[derive(Debug, Clone)]
pub struct PendingReset {
    pub to: String,
    pub name: String,
    pub token: String,
}

/// What the reset page needs to know before asking for a password.
#[derive(Debug, Clone, PartialEq)]
pub struct ResetCheck {
    /// The account's address, so a password manager saves the new password
    /// against the right username. The token proves the mailbox already.
    pub email: String,
    pub requires_two_factor: bool,
}

/// Password reset: issuing links, checking them and spending them.
pub struct PasswordResetService {
    repo: Arc<PasswordResetRepository>,
    users: Arc<AuthRepository>,
    auth: Arc<AuthService>,
    mailer: Arc<Mailer>,
    base_url: String,
    /// Under `Enforce`, an account that has not verified its address is sent
    /// no reset link.
    verification: VerificationMode,
}

impl PasswordResetService {
    pub fn new(
        repo: Arc<PasswordResetRepository>,
        users: Arc<AuthRepository>,
        auth: Arc<AuthService>,
        mailer: Arc<Mailer>,
        base_url: String,
    ) -> Self {
        PasswordResetService {
            repo,
            users,
            auth,
            mailer,
            base_url,
            verification: VerificationMode::Off,
        }
    }

    /// Send reset links only to verified addresses when `mode` enforces it.
    pub fn with_email_verification(mut self, mode: VerificationMode) -> Self {
        self.verification = mode;
        self
    }

    fn random_token() -> String {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Store a fresh link for the account at `email`, revoking any earlier one,
    /// and return what to mail. Sends no mail.
    ///
    /// `None` covers every reason not to send — no such account, a disabled
    /// one, the hourly cap — and the caller must answer all of them the same
    /// way it answers a link that was sent, or the form tells anyone who asks
    /// which addresses have accounts.
    pub fn create(&self, email: &str) -> Result<Option<PendingReset>, ApiError> {
        let email = email.trim();
        if email.is_empty() {
            return Err(ApiError::bad_request("Email is required"));
        }
        let Some(user) = self.users.find_user_by_email(email)? else {
            return Ok(None);
        };
        // A reset must not be a way back into an account an admin has shut.
        if user.disabled_at.is_some() {
            tracing::info!(user_id = %user.id, "password reset asked for a disabled account; not sent");
            return Ok(None);
        }
        // An unproved address may not be the account holder's, so it must not
        // be able to take the account over.
        if self.verification.require_verified(&user, "reset your password").is_err() {
            tracing::info!(user_id = %user.id, "password reset asked for an unverified address; not sent");
            return Ok(None);
        }

        let now = Utc::now().naive_utc();
        if self.repo.count_since(&user.id, now - Duration::hours(1))? >= MAX_RESETS_PER_HOUR {
            tracing::warn!(user_id = %user.id, "password reset cap reached; not sent");
            return Ok(None);
        }

        let token = Self::random_token();
        self.repo.replace_with(
            &NewPasswordReset {
                id: Uuid::new_v4().to_string(),
                user_id: user.id.clone(),
                token_hash: hash_reset_token(&token),
                created_at: now,
                expires_at: now + Duration::minutes(RESET_TTL_MINUTES),
            },
            now,
        )?;
        Ok(Some(PendingReset {
            to: user.email,
            name: user.name,
            token,
        }))
    }

    /// Mail a link [`Self::create`] stored. A failed send is logged, not
    /// returned: the caller has already answered.
    pub async fn send(&self, pending: PendingReset) {
        let content = super::email::compose_reset(&self.base_url, &pending.name, &pending.token);
        self.deliver(pending.to, content).await;
    }

    async fn deliver(&self, to: String, content: crate::auth::welcome::Content) {
        let message = Message {
            to,
            subject: content.subject,
            body: content.text,
            html: Some(content.html),
            headers: Vec::new(),
        };
        if let Err(e) = self.mailer.send(message).await {
            tracing::error!("could not send a password reset email: {}", e);
        }
    }

    /// The link's row and its account, if the link can still be used.
    ///
    /// 404 RESET_NOT_FOUND, 410 RESET_REVOKED, 410 RESET_USED, 410
    /// RESET_EXPIRED, 403 ACCOUNT_DISABLED — checked in that order.
    fn validate(&self, token: &str) -> Result<(PasswordResetRecord, User), ApiError> {
        let token = token.trim();
        if token.is_empty() {
            return Err(not_found());
        }
        let record = self
            .repo
            .find_by_token_hash(&hash_reset_token(token))?
            .ok_or_else(not_found)?;
        if record.revoked_at.is_some() {
            return Err(ApiError::new(
                410,
                "RESET_REVOKED",
                "A newer reset link has replaced this one. Use the link in the latest email.",
            ));
        }
        if record.used_at.is_some() {
            return Err(ApiError::new(
                410,
                "RESET_USED",
                "This reset link has already been used. Ask for a new one if you need to.",
            ));
        }
        if Utc::now().naive_utc() >= record.expires_at {
            return Err(ApiError::new(
                410,
                "RESET_EXPIRED",
                "This reset link has expired. Ask for a new one.",
            ));
        }
        // A deleted account is gone as far as every other lookup is concerned.
        let user = self
            .users
            .find_user_by_id(&record.user_id)?
            .ok_or_else(not_found)?;
        if user.disabled_at.is_some() {
            return Err(ApiError::new(
                403,
                "ACCOUNT_DISABLED",
                "This account has been disabled. Contact an administrator.",
            ));
        }
        Ok((record, user))
    }

    /// Whether `token` can still set a password, and what the page should ask
    /// for alongside it.
    pub fn check(&self, token: &str) -> Result<ResetCheck, ApiError> {
        let (_, user) = self.validate(token)?;
        Ok(ResetCheck {
            email: user.email,
            requires_two_factor: user.totp_enabled == 1,
        })
    }

    /// Set the account's password through the link, then spend the link.
    ///
    /// The two-factor code is asked for exactly as `change_password` asks for
    /// it: the mailbox alone must not be enough to sign the owner out of every
    /// device and change how they sign in. The password is checked before the
    /// link is spent, so a policy refusal leaves the link working.
    pub fn reset(
        &self,
        token: &str,
        new_password: &str,
        totp_code: Option<&str>,
    ) -> Result<User, ApiError> {
        let (record, user) = self.validate(token)?;

        if user.totp_enabled == 1 {
            let code = totp_code
                .map(str::trim)
                .filter(|c| !c.is_empty())
                .ok_or_else(|| ApiError::unauthorized("Two-factor code required"))?;
            let secret = user
                .totp_secret
                .as_deref()
                .ok_or_else(|| ApiError::internal("TOTP configuration error"))?;
            if !verify_totp(secret, code) {
                return Err(ApiError::unauthorized("Invalid two-factor code"));
            }
        }

        let password_hash = self.auth.prepare_reset_password(&user, new_password)?;

        let now = Utc::now().naive_utc();
        if !self.repo.claim(&record.id, now)? {
            // Spent, revoked or expired between the read and the write; say which.
            self.validate(token)?;
            return Err(ApiError::new(
                410,
                "RESET_USED",
                "This reset link has already been used. Ask for a new one if you need to.",
            ));
        }
        if let Err(e) = self.auth.apply_reset_password(&user.id, &password_hash) {
            // The password did not change, so the link should still work.
            if let Err(release) = self.repo.release(&record.id) {
                tracing::error!("could not release a password reset link: {}", release);
            }
            return Err(e);
        }
        // Any other link in the inbox would reset the password just set.
        self.repo.revoke_all(&user.id, now)?;
        Ok(user)
    }

    /// Tell the owner their password was reset. Logged, not returned, on failure.
    pub async fn send_changed_notice(&self, user: &User) {
        let content = super::email::compose_changed(&self.base_url, &user.name);
        self.deliver(user.email.clone(), content).await;
    }
}
