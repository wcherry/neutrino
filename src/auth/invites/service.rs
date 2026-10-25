//! What an invite is allowed to do: minting and resetting the personal link,
//! validating and rate-limiting emailed invites, and the claim / confirm /
//! release cycle a sign-up puts a token through.

use std::collections::HashSet;
use std::sync::Arc;

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use chrono::{Duration, NaiveDateTime, Utc};
use hmac::{Hmac, Mac};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::model::{InviteRecord, NewInvite, KIND_EMAIL, KIND_LINK};
use super::repository::InviteRepository;
use crate::shared::mail::{Mailer, Message};
use crate::shared::ApiError;

/// How long an emailed invite, or a freshly minted personal link, works.
pub const INVITE_TTL_DAYS: i64 = 14;
/// Emailed invites one user may create in a rolling 24 hours.
pub const MAX_EMAIL_INVITES_PER_DAY: i64 = 20;
/// Addresses accepted in one request.
pub const MAX_ADDRESSES_PER_REQUEST: usize = 20;
/// Longest note, in characters.
pub const MAX_NOTE_CHARS: usize = 500;

/// Domain separation for the personal link's HMAC.
const LINK_TOKEN_CONTEXT: &str = "neutrino-invite-link:";

/// SHA-256 of the token, lower-case hex (64 chars).
pub fn hash_invite_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

/// What an invite row reports to its inviter.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum InviteStatus {
    Pending,
    Accepted,
    Expired,
    Revoked,
}

impl InviteRecord {
    /// revoked > accepted (email kind) > expired (now >= expires_at) > pending.
    /// A personal link that has been used stays pending: it is reusable.
    pub fn status(&self, now: NaiveDateTime) -> InviteStatus {
        if self.revoked_at.is_some() {
            InviteStatus::Revoked
        } else if self.kind == KIND_EMAIL && self.accepted_at.is_some() {
            InviteStatus::Accepted
        } else if now >= self.expires_at {
            InviteStatus::Expired
        } else {
            InviteStatus::Pending
        }
    }
}

/// A user's live personal link, with its plaintext token.
#[derive(Debug, Clone)]
pub struct PersonalLink {
    /// The row id. The HTTP layer has no use for it; tests and future callers do.
    #[allow(dead_code)]
    pub id: String,
    pub token: String,
    pub expires_at: NaiveDateTime,
    pub use_count: i32,
}

/// A token that passed [`InviteService::validate`].
#[derive(Debug, Clone)]
pub struct ValidatedInvite {
    pub record: InviteRecord,
    pub inviter_name: String,
}

/// A token spent by [`InviteService::claim`], pending the sign-up it is for.
#[derive(Debug, Clone)]
pub struct InviteClaim {
    pub invite_id: String,
    pub kind: String,
}

/// Invites: storage rules, the daily cap and the invitation mail.
pub struct InviteService {
    repo: Arc<InviteRepository>,
    link_secret: String,
    mailer: Arc<Mailer>,
    base_url: String,
}

fn invalid_email(message: impl Into<String>) -> ApiError {
    ApiError::new(400, "INVALID_EMAIL", message)
}

fn not_found() -> ApiError {
    ApiError::new(404, "INVITE_NOT_FOUND", "This invite does not exist.")
}

fn used() -> ApiError {
    ApiError::new(410, "INVITE_USED", "This invite has already been used.")
}

/// A plausible address: one `@`, something either side, a dot inside the
/// domain, no whitespace. Deliverability is the mail server's business.
fn looks_like_email(addr: &str) -> bool {
    if addr.is_empty() || addr.len() > 254 || addr.chars().any(char::is_whitespace) {
        return false;
    }
    let Some((local, domain)) = addr.split_once('@') else {
        return false;
    };
    !local.is_empty()
        && !domain.is_empty()
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains("..")
}

impl InviteService {
    pub fn new(
        repo: Arc<InviteRepository>,
        link_secret: String,
        mailer: Arc<Mailer>,
        base_url: String,
    ) -> Self {
        InviteService {
            repo,
            link_secret,
            mailer,
            base_url,
        }
    }

    /// `{base_url}/register?invite={token}`.
    pub fn invite_url(&self, token: &str) -> String {
        format!(
            "{}/register?invite={}",
            self.base_url.trim_end_matches('/'),
            token
        )
    }

    /// The personal link's token: `base64url(HMAC-SHA256(secret, context + id))`.
    fn link_token(&self, id: &str) -> String {
        // HMAC takes a key of any length, so this cannot fail.
        let mut mac = <Hmac<Sha256> as Mac>::new_from_slice(self.link_secret.as_bytes())
            .expect("HMAC accepts any key length");
        mac.update(LINK_TOKEN_CONTEXT.as_bytes());
        mac.update(id.as_bytes());
        URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
    }

    fn random_token() -> String {
        let mut bytes = [0u8; 32];
        rand::rngs::OsRng.fill_bytes(&mut bytes);
        URL_SAFE_NO_PAD.encode(bytes)
    }

    fn new_link_row(&self, inviter_id: &str, now: NaiveDateTime) -> (NewInvite, String) {
        let id = Uuid::new_v4().to_string();
        let token = self.link_token(&id);
        let row = NewInvite {
            id,
            inviter_id: inviter_id.to_string(),
            kind: KIND_LINK.to_string(),
            token_hash: hash_invite_token(&token),
            invitee_email: None,
            note: None,
            created_at: now,
            expires_at: now + Duration::days(INVITE_TTL_DAYS),
        };
        (row, token)
    }

    fn link_of(&self, row: &InviteRecord) -> PersonalLink {
        PersonalLink {
            id: row.id.clone(),
            token: self.link_token(&row.id),
            expires_at: row.expires_at,
            use_count: row.use_count,
        }
    }

    fn require_user(&self, user_id: &str) -> Result<(String, String), ApiError> {
        self.repo
            .user_name_and_email(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))
    }

    /// The live personal link, minting one when none is live (none yet, expired
    /// or revoked). Same token on every call while it lives.
    pub fn personal_link(&self, inviter_id: &str) -> Result<PersonalLink, ApiError> {
        let now = Utc::now().naive_utc();
        if let Some(row) = self.repo.live_link(inviter_id, now)? {
            return Ok(self.link_of(&row));
        }
        self.require_user(inviter_id)?;
        let (row, token) = self.new_link_row(inviter_id, now);
        self.repo.insert(&row)?;
        Ok(PersonalLink {
            id: row.id,
            token,
            expires_at: row.expires_at,
            use_count: 0,
        })
    }

    /// Revoke the live link and mint a new one; the old token then fails
    /// validation with 410 INVITE_REVOKED.
    pub fn reset_personal_link(&self, inviter_id: &str) -> Result<PersonalLink, ApiError> {
        self.require_user(inviter_id)?;
        let now = Utc::now().naive_utc();
        let (row, token) = self.new_link_row(inviter_id, now);
        self.repo.replace_links(inviter_id, Some(&row), now)?;
        Ok(PersonalLink {
            id: row.id,
            token,
            expires_at: row.expires_at,
            use_count: 0,
        })
    }

    /// Validate + rate-limit + store; returns each new row with its plaintext
    /// token. Sends no mail.
    pub fn create_email_invites(
        &self,
        inviter_id: &str,
        emails: &[String],
        note: Option<&str>,
    ) -> Result<Vec<(InviteRecord, String)>, ApiError> {
        let note = note.map(str::trim).filter(|n| !n.is_empty());
        if note.is_some_and(|n| n.chars().count() > MAX_NOTE_CHARS) {
            return Err(ApiError::new(
                400,
                "NOTE_TOO_LONG",
                format!("The note can be at most {MAX_NOTE_CHARS} characters."),
            ));
        }

        let (_, own_email) = self.require_user(inviter_id)?;
        let own_email = own_email.trim().to_lowercase();

        let mut seen = HashSet::new();
        let mut addresses = Vec::new();
        for raw in emails {
            let addr = raw.trim().to_lowercase();
            if !looks_like_email(&addr) {
                return Err(invalid_email(format!(
                    "\"{}\" doesn't look like an email address.",
                    raw.trim()
                )));
            }
            if addr == own_email {
                return Err(invalid_email("You can't invite yourself."));
            }
            if seen.insert(addr.clone()) {
                addresses.push(addr);
            }
        }
        if addresses.is_empty() {
            return Err(invalid_email("Add at least one email address."));
        }
        if addresses.len() > MAX_ADDRESSES_PER_REQUEST {
            return Err(invalid_email(format!(
                "You can invite at most {MAX_ADDRESSES_PER_REQUEST} people at a time."
            )));
        }

        let now = Utc::now().naive_utc();
        let recent = self
            .repo
            .count_emailed_since(inviter_id, now - Duration::hours(24))?;
        if recent + addresses.len() as i64 > MAX_EMAIL_INVITES_PER_DAY {
            let left = (MAX_EMAIL_INVITES_PER_DAY - recent).max(0);
            return Err(ApiError::new(
                429,
                "INVITE_LIMIT_EXCEEDED",
                format!(
                    "You can send {MAX_EMAIL_INVITES_PER_DAY} invites a day; {left} left for now."
                ),
            ));
        }

        let expires_at = now + Duration::days(INVITE_TTL_DAYS);
        let mut rows = Vec::with_capacity(addresses.len());
        let mut tokens = Vec::with_capacity(addresses.len());
        for addr in addresses {
            let token = Self::random_token();
            rows.push(NewInvite {
                id: Uuid::new_v4().to_string(),
                inviter_id: inviter_id.to_string(),
                kind: KIND_EMAIL.to_string(),
                token_hash: hash_invite_token(&token),
                invitee_email: Some(addr),
                note: note.map(str::to_string),
                created_at: now,
                expires_at,
            });
            tokens.push(token);
        }
        self.repo
            .replace_and_insert_emailed(inviter_id, &rows, now)?;

        Ok(rows
            .into_iter()
            .map(InviteRecord::from)
            .zip(tokens)
            .collect())
    }

    /// [`Self::create_email_invites`], then send each invitation (awaited; a
    /// failed send is logged, not returned).
    pub async fn send_email_invites(
        &self,
        inviter_id: &str,
        emails: &[String],
        note: Option<&str>,
    ) -> Result<Vec<InviteRecord>, ApiError> {
        let created = self.create_email_invites(inviter_id, emails, note)?;
        let (inviter_name, _) = self.require_user(inviter_id)?;

        let mut out = Vec::with_capacity(created.len());
        for (row, token) in created {
            if let Some(to) = row.invitee_email.clone() {
                let content = super::email::compose(
                    &self.base_url,
                    &inviter_name,
                    row.note.as_deref(),
                    &token,
                );
                let message = Message {
                    to,
                    subject: content.subject,
                    body: content.text,
                    html: Some(content.html),
                    headers: Vec::new(),
                };
                if let Err(e) = self.mailer.send(message).await {
                    tracing::error!(invite_id = %row.id, "could not send an invitation: {}", e);
                }
            }
            out.push(row);
        }
        Ok(out)
    }

    /// Emailed invites only, newest first.
    pub fn list_mine(&self, inviter_id: &str) -> Result<Vec<InviteRecord>, ApiError> {
        self.repo.list_emailed(inviter_id)
    }

    /// 404 INVITE_NOT_FOUND if not the caller's; 409 INVITE_USED if already
    /// accepted; idempotent if revoked.
    pub fn revoke(&self, inviter_id: &str, invite_id: &str) -> Result<(), ApiError> {
        let row = self
            .repo
            .find_by_id(invite_id)?
            .filter(|r| r.inviter_id == inviter_id)
            .ok_or_else(not_found)?;
        if row.revoked_at.is_some() {
            return Ok(());
        }
        if row.kind == KIND_EMAIL && row.accepted_at.is_some() {
            return Err(ApiError::new(
                409,
                "INVITE_USED",
                "This invite has already been used.",
            ));
        }
        self.repo.set_revoked(&row.id, Utc::now().naive_utc())
    }

    /// 404 INVITE_NOT_FOUND, 410 INVITE_REVOKED, 410 INVITE_USED (email kind,
    /// accepted), 410 INVITE_EXPIRED — checked in that order.
    pub fn validate(&self, token: &str) -> Result<ValidatedInvite, ApiError> {
        let token = token.trim();
        if token.is_empty() {
            return Err(not_found());
        }
        let record = self
            .repo
            .find_by_token_hash(&hash_invite_token(token))?
            .ok_or_else(not_found)?;
        if record.revoked_at.is_some() {
            return Err(ApiError::new(
                410,
                "INVITE_REVOKED",
                "This invite was withdrawn.",
            ));
        }
        if record.kind == KIND_EMAIL && record.accepted_at.is_some() {
            return Err(used());
        }
        if Utc::now().naive_utc() >= record.expires_at {
            return Err(ApiError::new(
                410,
                "INVITE_EXPIRED",
                "This invite has expired.",
            ));
        }
        let inviter_name = self
            .repo
            .user_name_and_email(&record.inviter_id)?
            .map(|(name, _)| name)
            .unwrap_or_default();
        Ok(ValidatedInvite {
            record,
            inviter_name,
        })
    }

    /// Validate, then atomically spend it: an emailed invite is accepted only if
    /// still unused (a lost race is 410 INVITE_USED); a link counts one more use.
    pub fn claim(&self, token: &str) -> Result<InviteClaim, ApiError> {
        let record = self.validate(token)?.record;
        let now = Utc::now().naive_utc();
        let won = if record.kind == KIND_EMAIL {
            self.repo.claim_emailed(&record.id, now)?
        } else {
            self.repo.claim_link(&record.id, now)?
        };
        if !won {
            // Something changed between the read and the write; report what.
            self.validate(token)?;
            return Err(used());
        }
        Ok(InviteClaim {
            invite_id: record.id,
            kind: record.kind,
        })
    }

    /// Record who signed up with the claim.
    pub fn confirm(&self, claim: &InviteClaim, user_id: &str) -> Result<(), ApiError> {
        self.repo.set_accepted_user(&claim.invite_id, user_id)
    }

    /// Undo a claim whose sign-up then failed.
    pub fn release(&self, claim: &InviteClaim) -> Result<(), ApiError> {
        if claim.kind == KIND_EMAIL {
            self.repo.release_emailed(&claim.invite_id)
        } else {
            self.repo.release_link(&claim.invite_id)
        }
    }
}

#[cfg(test)]
mod unit {
    use super::looks_like_email;

    #[test]
    fn address_shapes() {
        for good in ["a@b.co", "first.last+tag@sub.example.com"] {
            assert!(looks_like_email(good), "{good}");
        }
        for bad in [
            "a@",
            "@b.com",
            "a b@c.com",
            "",
            "not-an-email",
            "a@b",
            "a@@b.com",
            "a@b..com",
        ] {
            assert!(!looks_like_email(bad), "{bad}");
        }
    }
}
