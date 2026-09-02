use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::ConnectionManager;

use super::model::PasswordPolicyRecord;
use super::{
    normalize_forbidden, ABSOLUTE_MIN_LENGTH, MAX_AGE_DAYS_LIMIT, MAX_FORBIDDEN_CHARACTERS,
    MAX_HISTORY_COUNT, MAX_LOCKOUT_THRESHOLD, MAX_MIN_LENGTH,
};
use crate::schema::password_policies as policies;
use crate::shared::{ApiError, DbPool};

/// The id of the one row. The policy is workspace-wide, so there is nothing to
/// look it up by; a fixed key keeps a second policy from being created by
/// accident and lets the row be recreated if it is ever lost.
pub const POLICY_ID: &str = "default";

/// The fields of one policy edit. `None` keeps the stored value, so the console
/// can send only what changed.
///
/// A struct rather than nine positional `Option`s: at this width a call site
/// reading `update(Some(12), None, None, Some(true), None, None, None, None,
/// None)` says nothing about which rule is which.
#[derive(Debug, Default)]
pub struct PasswordPolicyUpdate {
    pub min_length: Option<i32>,
    pub require_uppercase: Option<bool>,
    pub require_lowercase: Option<bool>,
    pub require_number: Option<bool>,
    pub require_symbol: Option<bool>,
    pub max_age_days: Option<i32>,
    pub forbidden_characters: Option<String>,
    pub lockout_threshold: Option<i32>,
    pub history_count: Option<i32>,
}

pub struct PasswordPolicyRepository {
    pool: DbPool,
}

impl PasswordPolicyRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// Read the policy, seeding the row if it has gone missing.
    ///
    /// Registration and sign-in both read this, so a store with no row must
    /// fall back to the shipped defaults rather than failing every password
    /// check with a 500.
    pub fn get(&self) -> Result<PasswordPolicyRecord, ApiError> {
        let mut conn = self.get_conn()?;

        let existing = policies::table
            .filter(policies::id.eq(POLICY_ID))
            .select(PasswordPolicyRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB password policy read error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        if let Some(record) = existing {
            return Ok(record);
        }

        diesel::insert_into(policies::table)
            .values((
                policies::id.eq(POLICY_ID),
                policies::min_length.eq(ABSOLUTE_MIN_LENGTH),
                policies::require_uppercase.eq(false),
                policies::require_lowercase.eq(false),
                policies::require_number.eq(false),
                policies::require_symbol.eq(false),
                policies::max_age_days.eq(0),
                policies::updated_at.eq(Utc::now().naive_utc()),
                policies::forbidden_characters.eq(""),
                policies::lockout_threshold.eq(0),
                policies::history_count.eq(0),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password policy seed error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        policies::table
            .filter(policies::id.eq(POLICY_ID))
            .select(PasswordPolicyRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password policy re-read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Write the policy. Fields left as `None` keep their current value, so the
    /// admin page can send only what changed.
    ///
    /// Every range is checked before the first write, so a rejected edit leaves
    /// the stored policy exactly as it was rather than half-applied.
    pub fn update(&self, changes: PasswordPolicyUpdate) -> Result<PasswordPolicyRecord, ApiError> {
        if let Some(len) = changes.min_length {
            if !(ABSOLUTE_MIN_LENGTH..=MAX_MIN_LENGTH).contains(&len) {
                return Err(ApiError::bad_request(format!(
                    "minLength must be between {ABSOLUTE_MIN_LENGTH} and {MAX_MIN_LENGTH}"
                )));
            }
        }
        if let Some(days) = changes.max_age_days {
            if !(0..=MAX_AGE_DAYS_LIMIT).contains(&days) {
                return Err(ApiError::bad_request(format!(
                    "maxAgeDays must be between 0 and {MAX_AGE_DAYS_LIMIT}"
                )));
            }
        }
        if let Some(threshold) = changes.lockout_threshold {
            if !(0..=MAX_LOCKOUT_THRESHOLD).contains(&threshold) {
                return Err(ApiError::bad_request(format!(
                    "lockoutThreshold must be between 0 and {MAX_LOCKOUT_THRESHOLD}"
                )));
            }
        }
        if let Some(count) = changes.history_count {
            if !(0..=MAX_HISTORY_COUNT).contains(&count) {
                return Err(ApiError::bad_request(format!(
                    "historyCount must be between 0 and {MAX_HISTORY_COUNT}"
                )));
            }
        }
        // Normalised first, so the length limit is on the set that will be
        // stored rather than on however many separators were typed around it.
        let forbidden = changes
            .forbidden_characters
            .as_deref()
            .map(normalize_forbidden);
        if let Some(ref chars) = forbidden {
            if chars.chars().count() > MAX_FORBIDDEN_CHARACTERS {
                return Err(ApiError::bad_request(format!(
                    "forbiddenCharacters must be at most {MAX_FORBIDDEN_CHARACTERS} characters"
                )));
            }
        }

        // Seeds the row if it is missing, so an update never has nothing to
        // write to.
        let current = self.get()?;
        let mut conn = self.get_conn()?;

        diesel::update(policies::table.filter(policies::id.eq(POLICY_ID)))
            .set((
                policies::min_length.eq(changes.min_length.unwrap_or(current.min_length)),
                policies::require_uppercase
                    .eq(changes.require_uppercase.unwrap_or(current.require_uppercase)),
                policies::require_lowercase
                    .eq(changes.require_lowercase.unwrap_or(current.require_lowercase)),
                policies::require_number
                    .eq(changes.require_number.unwrap_or(current.require_number)),
                policies::require_symbol
                    .eq(changes.require_symbol.unwrap_or(current.require_symbol)),
                policies::max_age_days.eq(changes.max_age_days.unwrap_or(current.max_age_days)),
                policies::updated_at.eq(Utc::now().naive_utc()),
                policies::forbidden_characters
                    .eq(forbidden.unwrap_or(current.forbidden_characters)),
                policies::lockout_threshold
                    .eq(changes.lockout_threshold.unwrap_or(current.lockout_threshold)),
                policies::history_count.eq(changes.history_count.unwrap_or(current.history_count)),
            ))
            .execute(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password policy update error: {:?}", e);
                ApiError::internal("Database error")
            })?;

        policies::table
            .filter(policies::id.eq(POLICY_ID))
            .select(PasswordPolicyRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB password policy re-read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database error")
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::Pool;

    fn test_repo() -> PasswordPolicyRepository {
        use crate::MIGRATIONS;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        PasswordPolicyRepository::new(pool)
    }

    /// The seeded row must be the rule the code enforced before the table
    /// existed, or installing the migration would invalidate live passwords.
    #[test]
    fn the_seeded_policy_matches_the_old_hard_coded_rule() {
        let policy = test_repo().get().expect("get");
        assert_eq!(policy.min_length, ABSOLUTE_MIN_LENGTH);
        assert!(!policy.require_uppercase);
        assert!(!policy.require_number);
        assert_eq!(policy.max_age_days, 0);
    }

    #[test]
    fn an_update_leaves_omitted_fields_alone() {
        let repo = test_repo();
        let updated = repo
            .update(PasswordPolicyUpdate {
                min_length: Some(12),
                require_number: Some(true),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(updated.min_length, 12);
        assert!(updated.require_number);
        assert!(!updated.require_symbol);
    }

    /// Nothing may take the minimum below what every existing account was
    /// created under.
    #[test]
    fn a_minimum_below_the_floor_is_refused() {
        let repo = test_repo();
        assert!(repo
            .update(PasswordPolicyUpdate {
                min_length: Some(4),
                ..Default::default()
            })
            .is_err());
        assert!(repo
            .update(PasswordPolicyUpdate {
                max_age_days: Some(-1),
                ..Default::default()
            })
            .is_err());
        assert_eq!(
            repo.get().expect("get").min_length,
            ABSOLUTE_MIN_LENGTH,
            "a refused update must not have written anything",
        );
    }

    /// However the admin types the list, what is stored is the set.
    #[test]
    fn a_forbidden_list_is_normalised_on_the_way_in() {
        let repo = test_repo();
        let updated = repo
            .update(PasswordPolicyUpdate {
                forbidden_characters: Some("< > & <".to_string()),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(updated.forbidden_characters, "<>&");
    }

    #[test]
    fn the_lockout_and_history_counts_are_range_checked() {
        let repo = test_repo();
        assert!(repo
            .update(PasswordPolicyUpdate {
                lockout_threshold: Some(MAX_LOCKOUT_THRESHOLD + 1),
                ..Default::default()
            })
            .is_err());
        assert!(repo
            .update(PasswordPolicyUpdate {
                history_count: Some(MAX_HISTORY_COUNT + 1),
                ..Default::default()
            })
            .is_err());

        let updated = repo
            .update(PasswordPolicyUpdate {
                lockout_threshold: Some(5),
                history_count: Some(3),
                ..Default::default()
            })
            .expect("update");
        assert_eq!(updated.lockout_threshold, 5);
        assert_eq!(updated.history_count, 3);
    }
}
