//! The sign-up gate in front of [`AuthService::register`].
//!
//! 1. Public sign-up closed and no invite token: 403 `SIGNUP_CLOSED`.
//! 2. A token is claimed first (one conditional update), so two concurrent
//!    sign-ups cannot both spend a single-use invite. While closed a bad token
//!    is the error; while open it is logged and ignored, since sign-up needs no
//!    invite.
//! 3. The sign-up guard (`signup_guard`) checks the address, the CAPTCHA and
//!    the rate limits, and reserves this sign-up's place in them. A valid
//!    invite counts as proof of a person, as a CAPTCHA does.
//! 4. `AuthService::register` runs every existing check unchanged. If it fails
//!    the claim and the reservation are released, so a typo burns neither.
//! 5. On success the invite records who signed up, the account is marked as
//!    owed the welcome wizard (`onboarding.welcome` = `pending`), and the
//!    welcome email and the email verification link go out on spawned tasks.
//!
//! The wizard mark is written here, on the account-creation paths only
//! (self-serve, invite, admin-created), and nowhere else: the preference's
//! default is `done`, so an account that predates it, or any sign-in, can never
//! show the wizard.

use std::sync::Arc;

use super::dto::{RegisterRequest, RegisterResponse};
use super::email_verification::service::EmailVerificationService;
use super::invites::service::InviteService;
use super::signup_guard::service::{SignupAttempt, SignupGuard};
use super::service::AuthService;
use super::welcome::WelcomeMailer;
use crate::preferences::catalog::WELCOME_PENDING;
use crate::preferences::repository::PreferencesRepository;
use crate::shared::ApiError;

/// Account creation: the invite gate, then registration, then the welcome email.
pub struct SignupService {
    auth: Arc<AuthService>,
    invites: Arc<InviteService>,
    welcome: Arc<WelcomeMailer>,
    preferences: Arc<PreferencesRepository>,
    public_signup_open: bool,
    /// Mails each new account its verification link. `None` sends none.
    verification: Option<Arc<EmailVerificationService>>,
    /// Address, CAPTCHA and rate-limit checks. `None` checks nothing.
    guard: Option<Arc<SignupGuard>>,
}

impl SignupService {
    pub fn new(
        auth: Arc<AuthService>,
        invites: Arc<InviteService>,
        welcome: Arc<WelcomeMailer>,
        preferences: Arc<PreferencesRepository>,
        public_signup_open: bool,
    ) -> Self {
        SignupService {
            auth,
            invites,
            welcome,
            preferences,
            public_signup_open,
            verification: None,
            guard: None,
        }
    }

    /// Put every public sign-up through the abuse guard.
    pub fn with_guard(mut self, guard: Arc<SignupGuard>) -> Self {
        self.guard = Some(guard);
        self
    }

    /// The CAPTCHA site key the sign-up form should render, if any.
    pub fn captcha_site_key(&self) -> Option<String> {
        self.guard
            .as_ref()
            .and_then(|g| g.captcha_site_key())
            .map(str::to_string)
    }

    /// Mail every new account a verification link.
    pub fn with_email_verification(mut self, verification: Arc<EmailVerificationService>) -> Self {
        self.verification = Some(verification);
        self
    }

    /// The emails every new account gets: welcome, and the verification link.
    fn send_new_account_mail(&self, user: &RegisterResponse) {
        self.welcome
            .send_later(user.email.clone(), user.name.clone());
        if let Some(verification) = &self.verification {
            verification.start_later(&user.id);
        }
    }

    /// Mark a brand-new account as owed the welcome wizard. Best effort: the account
    /// already exists, and a missed wizard must not turn a created account into an error.
    fn mark_welcome_pending(&self, user_id: &str) {
        let value = serde_json::Value::String(WELCOME_PENDING.into()).to_string();
        let now = chrono::Utc::now().format("%Y-%m-%dT%H:%M:%S%.6fZ").to_string();
        if let Err(e) = self.preferences.apply(
            user_id,
            &[("onboarding.welcome".to_string(), Some(value))],
            &now,
        ) {
            tracing::error!(%user_id, "could not mark a new account for the welcome wizard: {}", e);
        }
    }

    /// Whether anyone may sign up without an invite (`PUBLIC_SIGNUP`).
    pub fn public_signup_open(&self) -> bool {
        self.public_signup_open
    }

    /// [`Self::register_from`] for a caller with no address.
    #[cfg(test)]
    pub async fn register(&self, req: RegisterRequest) -> Result<RegisterResponse, ApiError> {
        self.register_from(req, "unknown").await
    }

    /// The sign-up gate described in the module docs, for a request from
    /// `client_ip`; on success sends the welcome email.
    pub async fn register_from(
        &self,
        req: RegisterRequest,
        client_ip: &str,
    ) -> Result<RegisterResponse, ApiError> {
        // Address checks first: they need no state, and a refused address
        // must not spend an invite.
        if let Some(guard) = &self.guard {
            guard.check_email(&req.email)?;
        }

        let token = req
            .invite_token
            .as_deref()
            .map(str::trim)
            .filter(|t| !t.is_empty())
            .map(str::to_string);

        let claim = match token {
            None if !self.public_signup_open => {
                return Err(ApiError::new(
                    403,
                    "SIGNUP_CLOSED",
                    "Sign-up on this server is by invitation only.",
                ));
            }
            None => None,
            Some(token) => match self.invites.claim(&token) {
                Ok(claim) => Some(claim),
                Err(e) if self.public_signup_open => {
                    tracing::info!("ignoring an unusable invite token at sign-up: {}", e);
                    None
                }
                Err(e) => return Err(e),
            },
        };

        let release_claim = |claim: &Option<_>| {
            if let Some(claim) = claim {
                if let Err(re) = self.invites.release(claim) {
                    tracing::error!(
                        invite_id = %claim.invite_id,
                        "could not release an invite after a failed sign-up: {}",
                        re
                    );
                }
            }
        };

        let reservation = match &self.guard {
            None => None,
            Some(guard) => {
                let attempt = SignupAttempt {
                    email: &req.email,
                    ip: client_ip,
                    captcha_token: req.turnstile_token.as_deref(),
                    invited: claim.is_some(),
                };
                match guard.admit(attempt).await {
                    Ok(r) => Some(r),
                    Err(e) => {
                        release_claim(&claim);
                        return Err(e);
                    }
                }
            }
        };

        let user = match self.auth.register(req) {
            Ok(user) => user,
            Err(e) => {
                if let (Some(guard), Some(r)) = (&self.guard, reservation) {
                    guard.release(r);
                }
                release_claim(&claim);
                return Err(e);
            }
        };

        if let (Some(guard), Some(r)) = (&self.guard, reservation) {
            guard.confirm(r, &user.id);
        }
        if let Some(claim) = &claim {
            if let Err(e) = self.invites.confirm(claim, &user.id) {
                tracing::error!(
                    invite_id = %claim.invite_id,
                    user_id = %user.id,
                    "could not record who signed up with an invite: {}",
                    e
                );
            }
        }
        self.mark_welcome_pending(&user.id);
        self.send_new_account_mail(&user);
        Ok(user)
    }

    /// For admin-created accounts: mark the account for the welcome wizard and send the
    /// welcome and verification emails.
    pub fn account_created(&self, user: &RegisterResponse) {
        self.mark_welcome_pending(&user.id);
        self.send_new_account_mail(user);
    }
}

#[cfg(test)]
#[path = "signup_tests.rs"]
mod tests;
