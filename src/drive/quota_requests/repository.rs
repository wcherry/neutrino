use chrono::{NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::ConnectionManager;
use uuid::Uuid;

use super::model::{NewQuotaRequest, QuotaRequestRecord};
use super::{STATUS_APPROVED, STATUS_DENIED, STATUS_PENDING};
use crate::schema::{quota_requests as requests, users};
use crate::shared::{ApiError, DbPool};

/// A queue row with the asker attached.
///
/// The console shows who asked, and looking each name up per row is a query per
/// row; the join is what makes the queue one read.
pub struct QuotaRequestWithUser {
    pub request: QuotaRequestRecord,
    pub user_email: String,
    pub user_name: String,
}

pub struct QuotaRequestsRepository {
    pool: DbPool,
}

impl QuotaRequestsRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    /// File a request, unless this user already has one waiting.
    ///
    /// The database enforces "one pending per user" with a partial unique
    /// index, so a duplicate is caught even when two tabs submit at once; the
    /// check below is only what turns that into a legible 409 instead of a
    /// constraint error.
    pub fn create(
        &self,
        user_id: &str,
        requested_bytes: i64,
        reason: Option<&str>,
    ) -> Result<QuotaRequestRecord, ApiError> {
        let mut conn = self.get_conn()?;
        let id = Uuid::new_v4().to_string();

        diesel::insert_into(requests::table)
            .values(NewQuotaRequest {
                id: &id,
                user_id,
                requested_bytes,
                reason,
                status: STATUS_PENDING,
                created_at: Utc::now().naive_utc(),
            })
            .execute(&mut conn)
            .map_err(|e| match e {
                diesel::result::Error::DatabaseError(
                    diesel::result::DatabaseErrorKind::UniqueViolation,
                    _,
                ) => ApiError::conflict("You already have a storage request awaiting review"),
                _ => {
                    tracing::error!("DB quota request insert error: {:?}", e);
                    ApiError::internal("Database error")
                }
            })?;

        requests::table
            .filter(requests::id.eq(&id))
            .select(QuotaRequestRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB quota request re-read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// One user's own requests, newest first.
    pub fn list_for_user(&self, user_id: &str) -> Result<Vec<QuotaRequestRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        requests::table
            .filter(requests::user_id.eq(user_id))
            .order(requests::created_at.desc())
            .select(QuotaRequestRecord::as_select())
            .load(&mut conn)
            .map_err(|e| {
                tracing::error!("DB quota request list error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// The queue. `status` narrows it; `None` returns everything, decided rows
    /// included, so an admin can see what was done as well as what is waiting.
    ///
    /// Ordered oldest-first: a work queue is worked from the front, and the
    /// longest wait is the one that most needs answering.
    pub fn list(&self, status: Option<&str>) -> Result<Vec<QuotaRequestWithUser>, ApiError> {
        let mut conn = self.get_conn()?;

        // Diesel's builder types diverge the moment a filter is applied
        // conditionally, so the two shapes are spelled out rather than boxed.
        let rows: Vec<(QuotaRequestRecord, String, String)> = match status {
            Some(s) => requests::table
                .inner_join(users::table)
                .filter(requests::status.eq(s))
                .order(requests::created_at.asc())
                .select((
                    QuotaRequestRecord::as_select(),
                    users::email,
                    users::name,
                ))
                .load(&mut conn),
            None => requests::table
                .inner_join(users::table)
                .order(requests::created_at.asc())
                .select((
                    QuotaRequestRecord::as_select(),
                    users::email,
                    users::name,
                ))
                .load(&mut conn),
        }
        .map_err(|e| {
            tracing::error!("DB quota request queue error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        Ok(rows
            .into_iter()
            .map(|(request, user_email, user_name)| QuotaRequestWithUser {
                request,
                user_email,
                user_name,
            })
            .collect())
    }

    pub fn find(&self, id: &str) -> Result<Option<QuotaRequestRecord>, ApiError> {
        let mut conn = self.get_conn()?;
        requests::table
            .filter(requests::id.eq(id))
            .select(QuotaRequestRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(|e| {
                tracing::error!("DB quota request read error: {:?}", e);
                ApiError::internal("Database error")
            })
    }

    /// Record a decision, but only on a row that is still pending.
    ///
    /// The `status = 'pending'` in the filter is what makes deciding a request
    /// idempotent under two admins pressing Approve at once: the second update
    /// matches nothing and is reported as a conflict rather than overwriting
    /// the first decision — and, since the caller writes the quota only after
    /// this succeeds, only one of them grants the storage.
    pub fn decide(
        &self,
        id: &str,
        status: &str,
        granted_bytes: Option<i64>,
        note: Option<&str>,
        decided_by: &str,
        decided_at: NaiveDateTime,
    ) -> Result<QuotaRequestRecord, ApiError> {
        debug_assert!(status == STATUS_APPROVED || status == STATUS_DENIED);
        let mut conn = self.get_conn()?;

        let updated = diesel::update(
            requests::table
                .filter(requests::id.eq(id))
                .filter(requests::status.eq(STATUS_PENDING)),
        )
        .set((
            requests::status.eq(status),
            requests::granted_bytes.eq(granted_bytes),
            requests::decision_note.eq(note),
            requests::decided_by.eq(decided_by),
            requests::decided_at.eq(decided_at),
        ))
        .execute(&mut conn)
        .map_err(|e| {
            tracing::error!("DB quota request decide error: {:?}", e);
            ApiError::internal("Database error")
        })?;

        if updated == 0 {
            // Re-read on the connection already in hand rather than through
            // `find`, which would ask the pool for a second one while this is
            // still checked out — a deadlock on a single-connection pool.
            let exists = diesel::select(diesel::dsl::exists(
                requests::table.filter(requests::id.eq(id)),
            ))
            .get_result::<bool>(&mut conn)
            .map_err(|e| {
                tracing::error!("DB quota request existence check error: {:?}", e);
                ApiError::internal("Database error")
            })?;
            return Err(if exists {
                ApiError::conflict("This request has already been decided")
            } else {
                ApiError::not_found("Request not found")
            });
        }

        requests::table
            .filter(requests::id.eq(id))
            .select(QuotaRequestRecord::as_select())
            .first(&mut conn)
            .map_err(|e| {
                tracing::error!("DB quota request re-read error: {:?}", e);
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

    fn test_repo() -> QuotaRequestsRepository {
        use crate::MIGRATIONS;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        {
            let mut conn = pool.get().expect("conn");
            conn.run_pending_migrations(MIGRATIONS).expect("migrations");
            for (id, email) in [("user-1", "one@test.com"), ("user-2", "two@test.com")] {
                diesel::insert_into(users::table)
                    .values((
                        users::id.eq(id),
                        users::email.eq(email),
                        users::name.eq(id),
                        users::password_hash.eq("x"),
                    ))
                    .execute(&mut conn)
                    .expect("seed user");
            }
        }
        QuotaRequestsRepository::new(pool)
    }

    #[test]
    fn a_request_starts_pending_and_undecided() {
        let repo = test_repo();
        let req = repo.create("user-1", 1024, Some("more room")).expect("create");
        assert_eq!(req.status, STATUS_PENDING);
        assert_eq!(req.requested_bytes, 1024);
        assert!(req.granted_bytes.is_none());
        assert!(req.decided_at.is_none());
    }

    /// A second ask while the first is unanswered is the same ask sent twice.
    #[test]
    fn a_second_pending_request_from_one_user_is_refused() {
        let repo = test_repo();
        repo.create("user-1", 1024, None).expect("first");
        let err = repo.create("user-1", 2048, None).unwrap_err();
        assert_eq!(err.status, 409);
    }

    #[test]
    fn deciding_a_request_frees_the_user_to_ask_again() {
        let repo = test_repo();
        let req = repo.create("user-1", 1024, None).expect("create");
        repo.decide(
            &req.id,
            STATUS_APPROVED,
            Some(1024),
            None,
            "admin-1",
            Utc::now().naive_utc(),
        )
        .expect("decide");
        repo.create("user-1", 4096, None)
            .expect("a decided request no longer blocks a new one");
    }

    /// Two admins pressing Approve at once must not both grant the storage.
    #[test]
    fn a_request_can_only_be_decided_once() {
        let repo = test_repo();
        let req = repo.create("user-1", 1024, None).expect("create");
        let now = Utc::now().naive_utc();
        repo.decide(&req.id, STATUS_APPROVED, Some(1024), None, "admin-1", now)
            .expect("first decision");
        let err = repo
            .decide(&req.id, STATUS_DENIED, None, None, "admin-2", now)
            .unwrap_err();
        assert_eq!(err.status, 409);
        assert_eq!(
            repo.find(&req.id).expect("find").expect("row").status,
            STATUS_APPROVED,
            "the first decision must stand",
        );
    }

    #[test]
    fn the_queue_filters_by_status_and_carries_the_asker() {
        let repo = test_repo();
        let one = repo.create("user-1", 1024, None).expect("create");
        repo.create("user-2", 2048, None).expect("create");
        repo.decide(
            &one.id,
            STATUS_DENIED,
            None,
            Some("not now"),
            "admin-1",
            Utc::now().naive_utc(),
        )
        .expect("decide");

        let pending = repo.list(Some(STATUS_PENDING)).expect("list");
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].user_email, "two@test.com");
        assert_eq!(repo.list(None).expect("list").len(), 2);
    }

    #[test]
    fn a_users_own_requests_are_theirs_alone() {
        let repo = test_repo();
        repo.create("user-1", 1024, None).expect("create");
        repo.create("user-2", 2048, None).expect("create");
        let mine = repo.list_for_user("user-1").expect("list");
        assert_eq!(mine.len(), 1);
        assert_eq!(mine[0].user_id, "user-1");
    }
}
