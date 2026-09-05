//! A team's disk quota (issue #185, phase 1's "storage quotas").
//!
//! **A team's storage is the team's problem, not the uploader's.** That sentence is the whole
//! reason this exists separately from the per-user quota in `storage::service`. Both are charged
//! for the same bytes and neither is a substitute for the other: the person who pressed upload pays
//! for the file out of their own allowance, because they chose to bring it into the deployment, and
//! the team pays for it out of theirs, because it now lives in a shared library that nobody
//! individually owns and that outlives whoever added it. A team with ten members and no quota of
//! its own is ten personal quotas pooled by accident.
//!
//! **`None` is unlimited, and it is a real answer.** Not "unset": an administrator can choose it,
//! the admin console offers it, and it means what it says. Teams created before this had it by
//! default, which is why migration 00131 backfills them rather than leaving the two states
//! indistinguishable.

use crate::shared::ApiError;

/// What a new team's limit is set to.
///
/// A number rather than `None`, because a team that starts unlimited never acquires a quota by
/// itself — somebody has to notice it and set one, and the moment they notice is usually the moment
/// the disk is full. Starting every team with a limit makes raising it a decision somebody makes on
/// purpose, which is the direction a quota should be wrong in.
///
/// Not configurable at runtime, deliberately. A default is read once, at team creation, so an
/// environment variable would be enough — and the thing an operator actually needs to change is a
/// *particular* team's limit, which is what the admin console's Teams tab is for. A second way to
/// set a quota is a second place for the answer to disagree with itself.
///
/// Migration 00131 backfills existing rows with this same number, and
/// [`crate::drive::teams::tests::the_backfilled_quota_matches_the_constant`] asserts the two agree
/// — a migration and a constant that are supposed to be the same number are exactly the pair that
/// silently drifts.
pub const DEFAULT_TEAM_QUOTA_BYTES: i64 = 10 * 1024 * 1024 * 1024; // 10 GiB

/// A team's occupancy against its limit, as the callers need to reason about it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TeamQuota {
    pub used_bytes: i64,
    /// `None` is unlimited.
    pub limit_bytes: Option<i64>,
}

impl TeamQuota {
    pub fn new(used_bytes: i64, limit_bytes: Option<i64>) -> Self {
        Self {
            used_bytes,
            limit_bytes,
        }
    }

    /// Bytes still available, or `None` when the team is unlimited.
    ///
    /// Never negative. A team can be over its limit without anyone having done anything wrong — an
    /// administrator can lower a limit below what is already stored, and that has to leave the
    /// existing files alone and simply refuse the next one. Reporting a negative remainder would
    /// put a minus sign in the progress bar rather than a full one.
    pub fn remaining_bytes(&self) -> Option<i64> {
        self.limit_bytes.map(|limit| (limit - self.used_bytes).max(0))
    }

    /// Whether `incoming` more bytes would exceed the limit.
    pub fn would_exceed(&self, incoming: i64) -> bool {
        self.limit_bytes
            .is_some_and(|limit| self.used_bytes + incoming > limit)
    }

    /// The refusal, in the shape every caller returns it.
    ///
    /// 413 rather than 403: the request is not forbidden, it is too large for the space available,
    /// and the difference is what tells a client to offer "delete something" rather than "ask for
    /// permission". `TEAM_QUOTA_EXCEEDED` rather than the personal `QUOTA_EXCEEDED`, because the
    /// two are fixed in different places by different people and a client that cannot tell them
    /// apart will send the uploader to their own storage settings to solve the team's problem.
    pub fn refuse(&self, incoming: i64) -> Result<(), ApiError> {
        if !self.would_exceed(incoming) {
            return Ok(());
        }
        Err(ApiError::new(
            413,
            "TEAM_QUOTA_EXCEEDED",
            "This team has no room left. Delete something or ask an administrator to raise the \
             team's storage limit.",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_unlimited_team_refuses_nothing() {
        let q = TeamQuota::new(1_000_000, None);
        assert_eq!(q.remaining_bytes(), None);
        assert!(!q.would_exceed(i64::MAX / 2));
        assert!(q.refuse(i64::MAX / 2).is_ok());
    }

    #[test]
    fn a_file_that_exactly_fills_the_quota_is_allowed() {
        let q = TeamQuota::new(90, Some(100));
        assert!(!q.would_exceed(10), "10 into 10 remaining is a fit, not an overflow");
        assert!(q.would_exceed(11));
        assert_eq!(q.remaining_bytes(), Some(10));
    }

    /// An administrator can lower a limit below what a team already holds. The existing files stay;
    /// the next one is refused; and the remainder reads as zero rather than as a negative number
    /// that would render as a progress bar running backwards.
    #[test]
    fn a_team_over_its_limit_reports_no_room_rather_than_negative_room() {
        let q = TeamQuota::new(500, Some(100));
        assert_eq!(q.remaining_bytes(), Some(0));
        assert!(q.would_exceed(1));
        assert_eq!(q.refuse(1).expect_err("over").status, 413);
    }

    /// The code is what tells a client whose problem this is. A personal `QUOTA_EXCEEDED` sends the
    /// uploader to their own storage settings, which cannot fix a team's limit.
    #[test]
    fn the_refusal_names_the_team_rather_than_the_uploader() {
        let err = TeamQuota::new(100, Some(100)).refuse(1).expect_err("over");
        assert_eq!(err.status, 413);
        assert_eq!(err.code, "TEAM_QUOTA_EXCEEDED");
    }

    #[test]
    fn a_zero_byte_file_fits_a_full_team() {
        assert!(TeamQuota::new(100, Some(100)).refuse(0).is_ok());
    }
}
