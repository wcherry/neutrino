use chrono::NaiveDateTime;
use diesel::prelude::*;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::share_links)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct ShareLinkRecord {
    pub id: String,
    pub resource_type: String,
    pub resource_id: String,
    pub token: String,
    pub visibility: String,
    pub role: String,
    pub expires_at: Option<NaiveDateTime>,
    pub is_active: bool,
    pub created_by: String,
    pub created_at: NaiveDateTime,
    pub updated_at: NaiveDateTime,
    /// Argon2id PHC string, or None for a link that needs no password.
    pub password_hash: Option<String>,
    /// Part of every guest session subject; bumped to end all sessions at once.
    pub session_epoch: i32,
    /// base64url X25519 public half of the link key. The private half is only in the URL fragment.
    pub public_key: Option<String>,
    /// The link key seed sealed to the owner, so the owner can rebuild the full link.
    pub sealed_seed: Option<String>,
    pub sealed_seed_key_version: Option<i32>,
}

impl ShareLinkRecord {
    /// The subject a link's file keys are sealed to: `guest:{link id}`.
    pub fn key_subject(&self) -> String {
        key_subject_for(&self.id)
    }

    /// The subject a guest session for this link carries: `guest:{link id}:{epoch}`.
    pub fn session_subject(&self) -> String {
        format!("guest:{}:{}", self.id, self.session_epoch)
    }

    /// Active and not past its expiry.
    pub fn is_live(&self, now: NaiveDateTime) -> bool {
        self.is_active && self.expires_at.map_or(true, |at| at >= now)
    }
}

pub fn key_subject_for(link_id: &str) -> String {
    format!("guest:{link_id}")
}

/// A `guest:` subject taken apart: the link it belongs to and, for a session subject, the epoch it
/// was issued at. A key subject (`guest:{id}`) has no epoch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GuestSubject {
    pub link_id: String,
    pub epoch: Option<i32>,
}

impl GuestSubject {
    /// None for anything that is not a `guest:` subject. A malformed epoch is not an epoch-less
    /// subject: it parses as None, so it can never be mistaken for a key subject and granted access.
    pub fn parse(subject: &str) -> Option<Self> {
        let rest = subject.strip_prefix("guest:")?;
        let mut parts = rest.splitn(2, ':');
        let link_id = parts.next().filter(|s| !s.is_empty())?.to_string();
        let epoch = match parts.next() {
            None => None,
            Some(e) => Some(e.parse().ok()?),
        };
        Some(GuestSubject { link_id, epoch })
    }

    pub fn key_subject(&self) -> String {
        key_subject_for(&self.link_id)
    }
}

/// The subject a file key is stored under for `user_id`: a guest session reads and writes its
/// link's key, everyone else their own.
pub fn file_key_subject(user_id: &str) -> String {
    match GuestSubject::parse(user_id) {
        Some(g) => g.key_subject(),
        None => user_id.to_string(),
    }
}

#[derive(Debug, Insertable)]
#[diesel(table_name = crate::schema::share_links)]
pub struct NewShareLinkRecord<'a> {
    pub id: &'a str,
    pub resource_type: &'a str,
    pub resource_id: &'a str,
    pub token: &'a str,
    pub visibility: &'a str,
    pub role: &'a str,
    pub expires_at: Option<NaiveDateTime>,
    pub is_active: bool,
    pub created_by: &'a str,
    pub password_hash: Option<&'a str>,
    pub session_epoch: i32,
    pub public_key: Option<&'a str>,
    pub sealed_seed: Option<&'a str>,
    pub sealed_seed_key_version: Option<i32>,
}

#[derive(Debug, AsChangeset)]
#[diesel(table_name = crate::schema::share_links)]
pub struct UpdateShareLinkRecord {
    pub visibility: Option<String>,
    pub role: Option<String>,
    pub expires_at: Option<Option<NaiveDateTime>>,
    pub is_active: Option<bool>,
    pub updated_at: NaiveDateTime,
    pub password_hash: Option<Option<String>>,
    pub session_epoch: Option<i32>,
    pub public_key: Option<Option<String>>,
    pub sealed_seed: Option<Option<String>>,
    pub sealed_seed_key_version: Option<Option<i32>>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_session_and_key_subjects() {
        assert_eq!(
            GuestSubject::parse("guest:abc:3"),
            Some(GuestSubject { link_id: "abc".into(), epoch: Some(3) })
        );
        assert_eq!(
            GuestSubject::parse("guest:abc"),
            Some(GuestSubject { link_id: "abc".into(), epoch: None })
        );
    }

    #[test]
    fn rejects_non_guest_and_malformed_subjects() {
        assert_eq!(GuestSubject::parse("user-1"), None);
        assert_eq!(GuestSubject::parse("guest:"), None);
        // A bad epoch must not degrade into an epoch-less (key) subject.
        assert_eq!(GuestSubject::parse("guest:abc:x"), None);
    }

    #[test]
    fn file_key_subject_folds_sessions_onto_their_link() {
        assert_eq!(file_key_subject("guest:abc:7"), "guest:abc");
        assert_eq!(file_key_subject("user-1"), "user-1");
    }
}
