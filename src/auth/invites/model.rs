use chrono::NaiveDateTime;
use diesel::prelude::*;

use crate::schema::invites;

/// `kind` of an invite sent to one address; works once.
pub const KIND_EMAIL: &str = "email";
/// `kind` of a user's reusable personal link.
pub const KIND_LINK: &str = "link";

/// One row of `invites`. Timestamps are naive UTC.
#[derive(Debug, Clone, PartialEq, Queryable, Selectable)]
#[diesel(table_name = invites)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct InviteRecord {
    pub id: String,
    pub inviter_id: String,
    /// `"email"` or `"link"`.
    pub kind: String,
    /// SHA-256 of the token, lower-case hex. The token itself is never stored.
    pub token_hash: String,
    /// The invited address, lower-cased; emailed invites only.
    pub invitee_email: Option<String>,
    pub note: Option<String>,
    pub created_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
    /// Emailed invite: when it was used. Personal link: when it was last used.
    pub accepted_at: Option<NaiveDateTime>,
    pub accepted_user_id: Option<String>,
    pub revoked_at: Option<NaiveDateTime>,
    pub use_count: i32,
}

/// A row to insert into `invites`.
#[derive(Debug, Clone, Insertable)]
#[diesel(table_name = invites)]
pub struct NewInvite {
    pub id: String,
    pub inviter_id: String,
    pub kind: String,
    pub token_hash: String,
    pub invitee_email: Option<String>,
    pub note: Option<String>,
    pub created_at: NaiveDateTime,
    pub expires_at: NaiveDateTime,
}

impl From<NewInvite> for InviteRecord {
    /// The row as it reads back straight after insert.
    fn from(n: NewInvite) -> Self {
        InviteRecord {
            id: n.id,
            inviter_id: n.inviter_id,
            kind: n.kind,
            token_hash: n.token_hash,
            invitee_email: n.invitee_email,
            note: n.note,
            created_at: n.created_at,
            expires_at: n.expires_at,
            accepted_at: None,
            accepted_user_id: None,
            revoked_at: None,
            use_count: 0,
        }
    }
}
