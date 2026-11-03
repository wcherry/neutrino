//! Issuing verification links, following them, and answering "is this address
//! verified?" for the rest of the server.

use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, NaiveDateTime, Utc};
use rand::RngCore;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::model::NewEmailVerification;
use super::policy::VerificationMode;
use super::repository::EmailVerificationRepository;
use crate::auth::repository::{AuthRepository, User};
use crate::shared::mail::{Mailer, Message};
use crate::shared::ApiError;

/// How long a verification link works. Longer than a reset link: nothing is
/// at stake in following it late, and the grace period is a month.
pub const VERIFY_TTL_DAYS: i64 = 7;
/// Links one account may be sent in a rolling hour.
pub const MAX_LINKS_PER_HOUR: i64 = 3;

/// SHA-256 of the token, lower-case hex (64 chars).
pub fn hash_verify_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn not_found() -> ApiError {
    ApiError::new(
        404,
        "VERIFY_NOT_FOUND",
        "This verification link isn't valid. Ask for a new one.",
    )
}

/// A link that was stored and still has to be mailed.
#[derive(Debug, Clone, PartialEq)]
pub struct PendingVerification {
    pub to: String,
    pub name: String,
    pub token: String,
    /// Whole days left before sign-in is refused, when that is enforced.
    pub block_days: Option<i64>,
}

/// Where an account stands, for the banner and the settings page.
#[derive(Debug, Clone, PartialEq)]
pub struct VerificationStatus {
    pub email: String,
    pub verified_at: Option<NaiveDateTime>,
    pub mode: VerificationMode,
    /// When sign-in will be refused, if the address stays unverified.
    pub block_at: Option<NaiveDateTime>,
}

/// What asking for another link from the app did.
#[derive(Debug, Clone, PartialEq)]
pub enum Resend {
    /// A link was stored; mail it.
    Send(PendingVerification),
    /// The address is verified already; nothing to send.
    AlreadyVerified,
}

pub struct EmailVerificationService {
    repo: Arc<EmailVerificationRepository>,
    users: Arc<AuthRepository>,
    mailer: Arc<Mailer>,
    base_url: String,
    mode: VerificationMode,
}

impl EmailVerificationService {
    pub fn new(
        repo: Arc<EmailVerificationRepository>,
        users: Arc<AuthRepository>,
        mailer: Arc<Mailer>,
        base_url: String,
        mode: VerificationMode,
    ) -> Self {
        EmailVerificationService {
            repo,
            users,
            mailer,
            base_url,
            mode,
        }
    }

    fn random_token() -> String {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    /// Store a fresh link for `user`, revoking older ones, under the hourly
    /// cap. `None` when no link should go out: verification is off, the
    /// address is verified, or the cap is reached.
    fn issue(&self, user: &User) -> Result<Option<PendingVerification>, ApiError> {
        if !self.mode.sends() || user.email_verified_at.is_some() {
            return Ok(None);
        }
        let now = Utc::now().naive_utc();
        if self.repo.count_since(&user.id, now - Duration::hours(1))? >= MAX_LINKS_PER_HOUR {
            tracing::warn!(user_id = %user.id, "email verification cap reached; not sent");
            return Ok(None);
        }
        let token = Self::random_token();
        self.repo.replace_with(
            &NewEmailVerification {
                id: Uuid::new_v4().to_string(),
                user_id: user.id.clone(),
                email: user.email.clone(),
                token_hash: hash_verify_token(&token),
                created_at: now,
                expires_at: now + Duration::days(VERIFY_TTL_DAYS),
            },
            now,
        )?;
        Ok(Some(PendingVerification {
            to: user.email.clone(),
            name: user.name.clone(),
            token,
            block_days: self
                .mode
                .block_at(user)
                // Rounded up: a fresh account has the whole grace period left.
                .map(|at| ((at - now).num_hours().max(0) + 23) / 24),
        }))
    }

    /// For a brand-new account: store a link and mail it on a spawned task.
    /// Best effort — the account already exists, and a missed email is what
    /// "Resend" is for.
    pub fn start_later(self: &Arc<Self>, user_id: &str) {
        if !self.mode.sends() {
            return;
        }
        let this = self.clone();
        let user_id = user_id.to_string();
        tokio::spawn(async move {
            let pending = match this.users.find_user_by_id(&user_id) {
                Ok(Some(user)) => this.issue(&user),
                Ok(None) => return,
                Err(e) => Err(e),
            };
            match pending {
                Ok(Some(pending)) => this.send(pending).await,
                Ok(None) => {}
                Err(e) => tracing::error!(%user_id, "could not start email verification: {}", e),
            }
        });
    }

    /// Another link for a signed-in account.
    pub fn resend(&self, user_id: &str) -> Result<Resend, ApiError> {
        if !self.mode.sends() {
            return Err(ApiError::bad_request(
                "Email verification is not in use on this server",
            ));
        }
        let user = self
            .users
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        if user.email_verified_at.is_some() {
            return Ok(Resend::AlreadyVerified);
        }
        self.issue(&user)?.map(Resend::Send).ok_or_else(|| {
            ApiError::new(
                429,
                "TOO_MANY_REQUESTS",
                "Several verification emails were sent in the last hour. Check your inbox, or try again later.",
            )
        })
    }

    /// Another link for whoever holds `email`, asked from the sign-in page by
    /// an account that can no longer sign in to ask. `None` for every reason
    /// not to send, and the caller answers all of them alike, so the form
    /// reveals nothing about which addresses have accounts.
    pub fn request_by_email(&self, email: &str) -> Result<Option<PendingVerification>, ApiError> {
        let email = email.trim();
        if email.is_empty() {
            return Err(ApiError::bad_request("Email is required"));
        }
        let Some(user) = self.users.find_user_by_email(email)? else {
            return Ok(None);
        };
        if user.disabled_at.is_some() {
            return Ok(None);
        }
        self.issue(&user)
    }

    /// Mail a stored link. A failed send is logged, not returned.
    pub async fn send(&self, pending: PendingVerification) {
        let content = super::email::compose_verify(
            &self.base_url,
            &pending.name,
            &pending.token,
            pending.block_days,
        );
        let message = Message {
            to: pending.to,
            subject: content.subject,
            body: content.text,
            html: Some(content.html),
            headers: Vec::new(),
        };
        if let Err(e) = self.mailer.send(message).await {
            tracing::error!("could not send a verification email: {}", e);
        }
    }

    /// Follow a link: mark its account verified and return the address.
    ///
    /// 404 VERIFY_NOT_FOUND, 410 VERIFY_REVOKED, 410 VERIFY_USED, 410
    /// VERIFY_EXPIRED — checked in that order. A link to an address the account
    /// has since changed counts as revoked.
    pub fn verify(&self, token: &str) -> Result<String, ApiError> {
        let token = token.trim();
        if token.is_empty() {
            return Err(not_found());
        }
        let record = self
            .repo
            .find_by_token_hash(&hash_verify_token(token))?
            .ok_or_else(not_found)?;
        let user = self
            .users
            .find_user_by_id(&record.user_id)?
            .ok_or_else(not_found)?;
        let revoked = || {
            ApiError::new(
                410,
                "VERIFY_REVOKED",
                "A newer verification link has replaced this one. Use the link in the latest email.",
            )
        };
        if record.revoked_at.is_some() || record.email != user.email {
            return Err(revoked());
        }
        if record.used_at.is_some() {
            return Err(ApiError::new(
                410,
                "VERIFY_USED",
                "This link has already been used, and your email address is verified.",
            ));
        }
        let now = Utc::now().naive_utc();
        if now >= record.expires_at {
            return Err(ApiError::new(
                410,
                "VERIFY_EXPIRED",
                "This verification link has expired. Ask for a new one.",
            ));
        }
        if !self.repo.verify(&record, now)? {
            // Spent or replaced between the read and the write.
            return Err(revoked());
        }
        Ok(record.email)
    }

    pub fn status(&self, user_id: &str) -> Result<VerificationStatus, ApiError> {
        let user = self
            .users
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        Ok(VerificationStatus {
            block_at: self.mode.block_at(&user),
            email: user.email,
            verified_at: user.email_verified_at,
            mode: self.mode,
        })
    }

    /// 403 `EMAIL_NOT_VERIFIED` when verification is enforced and the account
    /// has not verified. `action` finishes "Verify your email address to …".
    pub fn require_verified(&self, user_id: &str, action: &str) -> Result<(), ApiError> {
        if self.mode != VerificationMode::Enforce {
            return Ok(());
        }
        let user = self
            .users
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        self.mode.require_verified(&user, action)
    }
}
