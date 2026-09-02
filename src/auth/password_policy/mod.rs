//! The workspace's password rules.
//!
//! One row, written from the admin console and read wherever a password is
//! *set* — self-serve registration, an admin creating an account, and a
//! password change. It is never applied retroactively to a stored hash, which
//! cannot be inspected; the one rule that reaches an existing password is
//! `max_age_days`, which sign-in compares against `users.password_changed_at`.
pub mod api;
pub mod model;
pub mod repository;

pub use model::PasswordPolicyRecord;
pub use repository::PasswordPolicyRepository;

use crate::shared::ApiError;

/// The floor on `min_length`, and the rule the code enforced before the policy
/// table existed. A policy cannot go below it, so no admin can weaken passwords
/// past what every account was created under.
pub const ABSOLUTE_MIN_LENGTH: i32 = 8;

/// The ceiling on `min_length`. Argon2 will hash anything, but a minimum longer
/// than this is a lockout rather than a policy.
pub const MAX_MIN_LENGTH: i32 = 128;

/// The ceiling on `max_age_days` — a century, i.e. "effectively never" for
/// anyone who prefers a number to the 0 that means it outright.
pub const MAX_AGE_DAYS_LIMIT: i32 = 36_500;

/// The ceiling on `lockout_threshold`. Above this the counter has stopped being
/// a lockout and become a formality.
pub const MAX_LOCKOUT_THRESHOLD: i32 = 100;

/// The ceiling on `history_count`, and the number of hashes kept per account.
///
/// Rows are trimmed to this rather than to whatever the policy currently asks
/// for, so raising the count later still has something to check against.
pub const MAX_HISTORY_COUNT: i32 = 24;

/// The ceiling on how many distinct characters may be forbidden. A policy that
/// bans more than this is describing an allowed alphabet, which is not what this
/// rule is for.
pub const MAX_FORBIDDEN_CHARACTERS: usize = 64;

/// Normalise a forbidden-character list on its way into storage.
///
/// Whitespace is dropped and duplicates are collapsed, so the stored value is
/// the set the admin meant regardless of whether they typed it with separators.
/// Forbidding whitespace itself is deliberately not offered: a space is legal in
/// a passphrase and banning it invisibly would be the least explicable rejection
/// in the product.
pub fn normalize_forbidden(raw: &str) -> String {
    let mut seen = String::new();
    for c in raw.chars() {
        if !c.is_whitespace() && !seen.contains(c) {
            seen.push(c);
        }
    }
    seen
}

/// Check a password against the policy, returning every rule it breaks.
///
/// All failures are reported in one message rather than one at a time: a user
/// asked to fix a password three times in a row, learning one new rule each
/// time, has been told the policy in the worst possible order.
pub fn validate_password(password: &str, policy: &PasswordPolicyRecord) -> Result<(), ApiError> {
    let mut problems: Vec<String> = Vec::new();

    // Counted in characters, not bytes: a passphrase in a non-Latin script is
    // not shorter than it looks.
    if (password.chars().count() as i32) < policy.min_length {
        problems.push(format!("be at least {} characters", policy.min_length));
    }
    if policy.require_uppercase && !password.chars().any(|c| c.is_uppercase()) {
        problems.push("contain an uppercase letter".to_string());
    }
    if policy.require_lowercase && !password.chars().any(|c| c.is_lowercase()) {
        problems.push("contain a lowercase letter".to_string());
    }
    if policy.require_number && !password.chars().any(|c| c.is_numeric()) {
        problems.push("contain a number".to_string());
    }
    // Anything that is not a letter, a digit or whitespace counts — listing an
    // allowed set instead would refuse symbols a password manager generates.
    if policy.require_symbol
        && !password
            .chars()
            .any(|c| !c.is_alphanumeric() && !c.is_whitespace())
    {
        problems.push("contain a symbol".to_string());
    }

    // Reported as the characters that were actually used, not as the whole
    // banned set: telling someone their password may not contain any of
    // sixteen characters, when it contains one of them, is a puzzle rather than
    // an instruction. The offending characters are already in the password the
    // person just typed, so echoing them back reveals nothing they do not know.
    let used: Vec<char> = policy
        .forbidden_characters
        .chars()
        .filter(|c| password.contains(*c))
        .collect();
    if !used.is_empty() {
        let list = used
            .iter()
            .map(|c| c.to_string())
            .collect::<Vec<_>>()
            .join(" ");
        problems.push(format!("not contain {list}"));
    }

    if problems.is_empty() {
        return Ok(());
    }
    Err(ApiError::new(
        400,
        "PASSWORD_POLICY",
        format!("Password must {}", problems.join(", ")),
    ))
}

/// When a password set at `changed_at` expires under this policy, if it does.
///
/// `None` covers both "the policy has no maximum age" and "we do not know when
/// this password was set" — an account that predates the column. Guessing the
/// epoch for the latter would expire every such account the moment an admin
/// first sets a maximum age.
pub fn password_expiry(
    changed_at: Option<chrono::NaiveDateTime>,
    policy: &PasswordPolicyRecord,
) -> Option<chrono::NaiveDateTime> {
    if policy.max_age_days <= 0 {
        return None;
    }
    changed_at.map(|at| at + chrono::Duration::days(policy.max_age_days as i64))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn policy() -> PasswordPolicyRecord {
        PasswordPolicyRecord {
            id: "default".to_string(),
            min_length: 8,
            require_uppercase: false,
            require_lowercase: false,
            require_number: false,
            require_symbol: false,
            max_age_days: 0,
            updated_at: chrono::Utc::now().naive_utc(),
            forbidden_characters: String::new(),
            lockout_threshold: 0,
            history_count: 0,
        }
    }

    #[test]
    fn the_default_policy_accepts_any_eight_characters() {
        assert!(validate_password("password", &policy()).is_ok());
    }

    #[test]
    fn a_short_password_is_refused() {
        let err = validate_password("short", &policy()).unwrap_err();
        assert_eq!(err.status, 400);
        assert_eq!(err.code, "PASSWORD_POLICY");
    }

    #[test]
    fn length_counts_characters_rather_than_bytes() {
        // Eight characters, twenty-four bytes.
        assert!(validate_password("日本語日本語日本", &policy()).is_ok());
    }

    /// Being told one rule at a time turns fixing a password into a guessing
    /// game, so every unmet rule is in the one message.
    #[test]
    fn every_unmet_rule_is_reported_at_once() {
        let mut p = policy();
        p.require_uppercase = true;
        p.require_number = true;
        p.require_symbol = true;
        let err = validate_password("lowercaseonly", &p).unwrap_err();
        assert!(err.message.contains("uppercase"), "{}", err.message);
        assert!(err.message.contains("number"), "{}", err.message);
        assert!(err.message.contains("symbol"), "{}", err.message);
    }

    #[test]
    fn a_complex_password_satisfies_every_rule() {
        let mut p = policy();
        p.require_uppercase = true;
        p.require_lowercase = true;
        p.require_number = true;
        p.require_symbol = true;
        assert!(validate_password("Str0ng!passphrase", &p).is_ok());
    }

    #[test]
    fn a_forbidden_character_is_refused_and_named() {
        let mut p = policy();
        p.forbidden_characters = "<>&".to_string();
        let err = validate_password("pass<word>", &p).unwrap_err();
        assert!(err.message.contains('<'), "{}", err.message);
        assert!(err.message.contains('>'), "{}", err.message);
        // Only what was used — the whole banned set would be a puzzle.
        assert!(!err.message.contains('&'), "{}", err.message);
    }

    #[test]
    fn a_password_avoiding_the_forbidden_set_passes() {
        let mut p = policy();
        p.forbidden_characters = "<>&".to_string();
        assert!(validate_password("passphrase", &p).is_ok());
    }

    /// The stored list is a set of characters, however the admin typed it.
    #[test]
    fn the_forbidden_list_is_deduplicated_and_stripped_of_whitespace() {
        assert_eq!(normalize_forbidden("< > & <"), "<>&");
        assert_eq!(normalize_forbidden("   "), "");
    }

    #[test]
    fn no_maximum_age_means_no_expiry() {
        let changed = chrono::Utc::now().naive_utc() - chrono::Duration::days(3650);
        assert!(password_expiry(Some(changed), &policy()).is_none());
    }

    /// An account whose password age is unknown must not be expired by the act
    /// of an admin turning a maximum age on.
    #[test]
    fn an_unknown_change_date_never_expires() {
        let mut p = policy();
        p.max_age_days = 30;
        assert!(password_expiry(None, &p).is_none());
    }

    #[test]
    fn the_expiry_is_the_change_date_plus_the_maximum_age() {
        let mut p = policy();
        p.max_age_days = 30;
        let changed = chrono::Utc::now().naive_utc() - chrono::Duration::days(31);
        let expiry = password_expiry(Some(changed), &p).expect("expiry");
        assert!(expiry < chrono::Utc::now().naive_utc());
    }
}
