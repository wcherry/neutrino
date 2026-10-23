// ── preferences::repository ───────────────────────────────────────────────────
//
// Follows `themes::repository`'s connection and error-mapping style.

use crate::preferences::model::{
    NewPreferenceRecord, OrgPreferenceRecord, PreferenceRecord, TeamPreferenceRecord, VaultRecord,
};
use crate::schema::{org_preferences, team_members, team_preferences, user_preference_vault, user_preferences};
use crate::shared::ApiError;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel::SqliteConnection;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// What a vault write found. `Conflict` carries the version that is actually stored.
#[derive(Debug, PartialEq)]
pub enum VaultWrite {
    Written(String),
    Conflict(Option<String>),
}

pub struct PreferencesRepository {
    pool: DbPool,
}

fn db_error(context: &str) -> impl Fn(diesel::result::Error) -> ApiError + '_ {
    move |e| {
        tracing::error!("DB {context} error: {:?}", e);
        ApiError::internal("Database error")
    }
}

impl PreferencesRepository {
    pub fn new(pool: DbPool) -> Self {
        PreferencesRepository { pool }
    }

    fn get_conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    pub fn list(&self, user_id: &str) -> Result<Vec<PreferenceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        user_preferences::table
            .filter(user_preferences::user_id.eq(user_id))
            .order(user_preferences::key.asc())
            .select(PreferenceRecord::as_select())
            .load(&mut conn)
            .map_err(db_error("list preferences"))
    }

    /// Apply one PATCH in one transaction: `Some` upserts the JSON text, `None` deletes the row.
    pub fn apply(
        &self,
        user_id: &str,
        changes: &[(String, Option<String>)],
        now: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            for (key, value) in changes {
                match value {
                    Some(value) => {
                        diesel::insert_into(user_preferences::table)
                            .values(NewPreferenceRecord { user_id, key, value, updated_at: now })
                            .on_conflict((user_preferences::user_id, user_preferences::key))
                            .do_update()
                            .set((user_preferences::value.eq(value), user_preferences::updated_at.eq(now)))
                            .execute(conn)?;
                    }
                    None => {
                        diesel::delete(
                            user_preferences::table
                                .filter(user_preferences::user_id.eq(user_id))
                                .filter(user_preferences::key.eq(key)),
                        )
                        .execute(conn)?;
                    }
                }
            }
            Ok(())
        })
        .map_err(db_error("apply preferences"))
    }

    pub fn get_vault(&self, user_id: &str) -> Result<Option<VaultRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        user_preference_vault::table
            .filter(user_preference_vault::user_id.eq(user_id))
            .select(VaultRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_error("get vault"))
    }

    /// Replace the vault if, and only if, the stored version is the one the client last saw.
    pub fn put_vault(
        &self,
        user_id: &str,
        blob: &str,
        base: Option<&str>,
        now: &str,
    ) -> Result<VaultWrite, ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            let current: Option<String> = user_preference_vault::table
                .filter(user_preference_vault::user_id.eq(user_id))
                .select(user_preference_vault::updated_at)
                .first(conn)
                .optional()?;
            if current.as_deref() != base {
                return Ok(VaultWrite::Conflict(current));
            }
            match current {
                Some(_) => {
                    diesel::update(user_preference_vault::table.filter(user_preference_vault::user_id.eq(user_id)))
                        .set((user_preference_vault::blob.eq(blob), user_preference_vault::updated_at.eq(now)))
                        .execute(conn)?;
                }
                None => {
                    diesel::insert_into(user_preference_vault::table)
                        .values((
                            user_preference_vault::user_id.eq(user_id),
                            user_preference_vault::blob.eq(blob),
                            user_preference_vault::updated_at.eq(now),
                        ))
                        .execute(conn)?;
                }
            }
            Ok(VaultWrite::Written(now.to_string()))
        })
        .map_err(db_error("put vault"))
    }

    // ── Organisation ──────────────────────────────────────────────────────────

    pub fn list_org(&self) -> Result<Vec<OrgPreferenceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        org_preferences::table
            .order(org_preferences::key.asc())
            .select(OrgPreferenceRecord::as_select())
            .load(&mut conn)
            .map_err(db_error("list org preferences"))
    }

    /// Apply one admin PATCH in one transaction: `Some((value, locked))` upserts, `None` deletes.
    pub fn apply_org(
        &self,
        changes: &[(String, Option<(String, bool)>)],
        by: &str,
        now: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            for (key, change) in changes {
                match change {
                    Some((value, locked)) => {
                        diesel::insert_into(org_preferences::table)
                            .values((
                                org_preferences::key.eq(key),
                                org_preferences::value.eq(value),
                                org_preferences::locked.eq(locked),
                                org_preferences::updated_by.eq(by),
                                org_preferences::updated_at.eq(now),
                            ))
                            .on_conflict(org_preferences::key)
                            .do_update()
                            .set((
                                org_preferences::value.eq(value),
                                org_preferences::locked.eq(locked),
                                org_preferences::updated_by.eq(by),
                                org_preferences::updated_at.eq(now),
                            ))
                            .execute(conn)?;
                    }
                    None => {
                        diesel::delete(org_preferences::table.filter(org_preferences::key.eq(key))).execute(conn)?;
                    }
                }
            }
            Ok(())
        })
        .map_err(db_error("apply org preferences"))
    }

    // ── Teams ─────────────────────────────────────────────────────────────────

    pub fn list_team(&self, team_id: &str) -> Result<Vec<TeamPreferenceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        team_preferences::table
            .filter(team_preferences::team_id.eq(team_id))
            .order(team_preferences::key.asc())
            .select(TeamPreferenceRecord::as_select())
            .load(&mut conn)
            .map_err(db_error("list team preferences"))
    }

    /// The defaults of every team `user_id` is a member of, for the caller's own preference read.
    pub fn list_teams_for_member(&self, user_id: &str) -> Result<Vec<TeamPreferenceRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        team_preferences::table
            .filter(
                team_preferences::team_id.eq_any(
                    team_members::table.filter(team_members::user_id.eq(user_id)).select(team_members::team_id),
                ),
            )
            .order((team_preferences::team_id.asc(), team_preferences::key.asc()))
            .select(TeamPreferenceRecord::as_select())
            .load(&mut conn)
            .map_err(db_error("list member team preferences"))
    }

    /// Who belongs to `team_id` — the users a change to its defaults is signalled to.
    pub fn team_member_ids(&self, team_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.get_conn()?;
        team_members::table
            .filter(team_members::team_id.eq(team_id))
            .select(team_members::user_id)
            .load(&mut conn)
            .map_err(db_error("list team member ids"))
    }

    pub fn apply_team(
        &self,
        team_id: &str,
        changes: &[(String, Option<String>)],
        by: &str,
        now: &str,
    ) -> Result<(), ApiError> {
        let mut conn = self.get_conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            for (key, value) in changes {
                match value {
                    Some(value) => {
                        diesel::insert_into(team_preferences::table)
                            .values((
                                team_preferences::team_id.eq(team_id),
                                team_preferences::key.eq(key),
                                team_preferences::value.eq(value),
                                team_preferences::updated_by.eq(by),
                                team_preferences::updated_at.eq(now),
                            ))
                            .on_conflict((team_preferences::team_id, team_preferences::key))
                            .do_update()
                            .set((
                                team_preferences::value.eq(value),
                                team_preferences::updated_by.eq(by),
                                team_preferences::updated_at.eq(now),
                            ))
                            .execute(conn)?;
                    }
                    None => {
                        diesel::delete(
                            team_preferences::table
                                .filter(team_preferences::team_id.eq(team_id))
                                .filter(team_preferences::key.eq(key)),
                        )
                        .execute(conn)?;
                    }
                }
            }
            Ok(())
        })
        .map_err(db_error("apply team preferences"))
    }
}
