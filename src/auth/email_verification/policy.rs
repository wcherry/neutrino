//! The verification rules every other module asks about: whether an address
//! has to be verified, by when, and what is refused until it is. Pure, so the
//! sign-in, refresh, sharing and reset paths all agree without a database.

use chrono::{Duration, NaiveDateTime};

use crate::auth::repository::User;
use crate::shared::ApiError;

/// Days an unverified account may still sign in, counted from its creation.
pub const GRACE_DAYS: i64 = 30;

/// How strictly addresses are verified (`EMAIL_VERIFICATION`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum VerificationMode {
    /// No link is sent and nothing is refused.
    #[default]
    Off,
    /// A link is sent and the web app nags, but nothing is refused.
    Soft,
    /// As `Soft`, plus sharing and password reset need a verified address and
    /// sign-in is refused after [`GRACE_DAYS`].
    Enforce,
}

impl VerificationMode {
    /// Reads `EMAIL_VERIFICATION` (`off`, `soft` or `enforce`). Unset means
    /// `enforce` when mail really leaves the server, and `off` when it only goes
    /// to the outbox file: nobody could follow a link no one received.
    pub fn parse(value: Option<&str>, mail_delivers: bool) -> Result<Self, String> {
        match value.map(str::trim).map(str::to_ascii_lowercase).as_deref() {
            None | Some("") => Ok(if mail_delivers { Self::Enforce } else { Self::Off }),
            Some("off") => Ok(Self::Off),
            Some("soft") => Ok(Self::Soft),
            Some("enforce") => Ok(Self::Enforce),
            Some(other) => Err(format!(
                "EMAIL_VERIFICATION must be `off`, `soft` or `enforce`, not `{other}`"
            )),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Off => "off",
            Self::Soft => "soft",
            Self::Enforce => "enforce",
        }
    }

    /// Whether verification links are sent at all.
    pub fn sends(self) -> bool {
        self != Self::Off
    }

    /// When an unverified account stops being able to sign in. `None` when it
    /// never will: the address is verified, or nothing is enforced.
    pub fn block_at(self, user: &User) -> Option<NaiveDateTime> {
        (self == Self::Enforce && user.email_verified_at.is_none())
            .then(|| user.created_at + Duration::days(GRACE_DAYS))
    }

    /// Whether sign-in and refresh must refuse this account now.
    pub fn is_blocked(self, user: &User, now: NaiveDateTime) -> bool {
        self.block_at(user).is_some_and(|at| now >= at)
    }

    /// 403 `EMAIL_NOT_VERIFIED` when the account is past its grace period.
    pub fn check_sign_in(self, user: &User, now: NaiveDateTime) -> Result<(), ApiError> {
        if self.is_blocked(user, now) {
            return Err(ApiError::new(
                403,
                "EMAIL_NOT_VERIFIED",
                "Verify your email address to keep using this account. \
                 Follow the link in the verification email, or ask for a new one.",
            ));
        }
        Ok(())
    }

    /// 403 `EMAIL_NOT_VERIFIED` when `action` needs a verified address and the
    /// account has none. `action` finishes the sentence "Verify your email
    /// address to …".
    pub fn require_verified(self, user: &User, action: &str) -> Result<(), ApiError> {
        if self == Self::Enforce && user.email_verified_at.is_none() {
            return Err(ApiError::new(
                403,
                "EMAIL_NOT_VERIFIED",
                format!("Verify your email address to {action}."),
            ));
        }
        Ok(())
    }
}
