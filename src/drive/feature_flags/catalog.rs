//! The list of feature flag keys the product declares.
//!
//! This exists because of the specific way the old flag system failed. Four keys the web client's
//! `FeatureFlags` type declared — `docsPresence`, `docsTrackChanges`, `docsCompare` and
//! `docsMobileEditor` — had no row in `feature_flags` at all. Reading one gave `undefined`, which
//! is falsy, so each rendered as a feature that was off. Not off because an admin had turned it
//! off: off because nothing anywhere knew it was supposed to exist. Two of them gated real, working
//! code that had therefore never once run in production, and nobody found out until #183 deleted
//! the system and the code went live.
//!
//! Nothing in the database could have caught that. A table cannot know what its readers expect to
//! find in it. So the expectation is written here instead, and the repository refuses to serve a
//! flag list that does not match: a declared key with no row is a 500 with the key named in it, not
//! a feature that quietly renders as absent. [`declared_keys_are_seeded`] then asserts the same
//! thing at build time against the real migrations, so the mistake is a failing test long before it
//! is a failing request.
//!
//! Adding a flag means adding it in three places, and the tests fail until all three agree: a row
//! in a new migration, an entry here, and a key in `web/apps/web/src/lib/featureFlags.ts`.

/// One flag the product knows about.
///
/// `owner` and `removal` are not decoration. A flag that nobody owns and that has no stated
/// condition for coming out is how fifteen keys accumulated last time, and the admin panel renders
/// both next to the toggle so the question "can this go yet?" has an answer where it is asked.
pub struct DeclaredFlag {
    pub key: &'static str,
    pub owner: &'static str,
    pub removal: &'static str,
}

/// Every key the server will serve, and the only keys it will accept a row for.
///
/// **Empty, and it stays empty while Neutrino is in beta.** Feature flags are for after a stable
/// public release: until then a feature ships unconditionally, and work that is not ready stays on
/// a branch. The four flags this list held (`teamSpaces`, `teamFileTransfers`, `e2eeChunkedWrites`,
/// `folderLinkEditing`) were removed together with every check that read them, and migration 156
/// dropped their rows. The mechanism — the table, the endpoints, the admin tab, `FeatureGate` — is
/// kept, so that after the release a flag is an entry here, a migration and a `FLAG_KEYS` key.
pub const DECLARED_FLAGS: &[DeclaredFlag] = &[];

/// Which declared keys are missing from `present`, in declaration order.
///
/// Keys in `present` that are *not* declared are left alone rather than reported. A row for a
/// retired key is inert — nothing reads it — and refusing to start over one would turn removing a
/// flag from the code into a migration that has to land in the same deploy.
pub fn missing_keys(present: &[String]) -> Vec<&'static str> {
    missing_from(DECLARED_FLAGS, present)
}

/// [`missing_keys`] against any declared list, so the rule is testable while the real list is
/// empty.
fn missing_from(declared: &[DeclaredFlag], present: &[String]) -> Vec<&'static str> {
    declared
        .iter()
        .map(|f| f.key)
        .filter(|key| !present.iter().any(|p| p == key))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::feature_flags;
    use diesel::prelude::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    /// The check that would have caught the four phantom keys.
    ///
    /// Runs the real migrations and asserts every declared key has a row. A key added to
    /// `DECLARED_FLAGS` without a migration fails here, at build time, rather than as a feature
    /// that silently never appears.
    #[test]
    fn declared_keys_are_seeded() {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        let mut conn = pool.get().expect("conn");
        conn.run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");

        let present: Vec<String> = feature_flags::table
            .select(feature_flags::key)
            .load(&mut conn)
            .expect("load flags");

        assert_eq!(
            missing_keys(&present),
            Vec::<&str>::new(),
            "every key in DECLARED_FLAGS needs a row seeded by a migration"
        );
    }

    const SAMPLE: &[DeclaredFlag] = &[
        DeclaredFlag { key: "alpha", owner: "test", removal: "never" },
        DeclaredFlag { key: "beta", owner: "test", removal: "never" },
    ];

    #[test]
    fn missing_keys_reports_only_what_is_absent() {
        let all: Vec<String> = SAMPLE.iter().map(|f| f.key.to_string()).collect();
        assert!(missing_from(SAMPLE, &all).is_empty());
        assert_eq!(missing_from(SAMPLE, &["alpha".to_string()]), vec!["beta"]);
        assert_eq!(missing_from(SAMPLE, &[]), vec!["alpha", "beta"]);
        // A table holding only unrelated keys is missing everything declared.
        assert_eq!(
            missing_from(SAMPLE, &["somethingElse".to_string()]),
            vec!["alpha", "beta"]
        );
    }

    /// A row for a key nobody declares any more is not an error — removing a flag from the code
    /// should not have to land in the same deploy as the migration that drops its row.
    #[test]
    fn undeclared_rows_are_not_missing_keys() {
        let mut present: Vec<String> = SAMPLE.iter().map(|f| f.key.to_string()).collect();
        present.push("someRetiredFlag".to_string());
        assert!(missing_from(SAMPLE, &present).is_empty());
    }

    /// No flags during the beta. Adding one here is a decision to be made after the public
    /// release, and this is where it has to be made deliberately.
    #[test]
    fn no_feature_is_flagged_during_the_beta() {
        assert!(DECLARED_FLAGS.is_empty());
    }
}
