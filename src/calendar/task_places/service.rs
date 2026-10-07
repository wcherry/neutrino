use crate::calendar::events::repository::DbPool;
use crate::calendar::task_places::{
    dto::{ListTaskPlacesResponse, SaveTaskPlaceRequest, TaskPlaceResponse},
    model::{NewTaskPlaceRecord, TaskPlaceRecord},
};
use crate::schema::{task_places, tasks};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::Utc;
use diesel::prelude::*;
use uuid::Uuid;

/// The largest payload accepted. A v1 envelope of a place with a long name is well under 1 KB.
pub const MAX_PAYLOAD_BYTES: usize = 4096;

pub struct TaskPlacesService {
    pool: DbPool,
}

impl TaskPlacesService {
    pub fn new(pool: DbPool) -> Self {
        TaskPlacesService { pool }
    }

    fn transaction<T>(
        &self,
        f: impl FnOnce(&mut SqliteConnection) -> Result<T, ApiError>,
    ) -> Result<T, ApiError> {
        let mut conn = self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })?;
        let conn: &mut SqliteConnection = &mut conn;
        conn.transaction(f)
    }

    /// The user's saved places, oldest first, as ciphertext.
    pub fn list(&self, user: &AuthenticatedUser) -> Result<ListTaskPlacesResponse, ApiError> {
        let records = self.transaction(|conn| {
            Ok(task_places::table
                .filter(task_places::user_id.eq(&user.user_id))
                .order(task_places::created_at.asc())
                .select(TaskPlaceRecord::as_select())
                .load(conn)?)
        })?;
        Ok(ListTaskPlacesResponse {
            places: records.into_iter().map(to_response).collect(),
        })
    }

    pub fn create(
        &self,
        user: &AuthenticatedUser,
        req: SaveTaskPlaceRequest,
    ) -> Result<TaskPlaceResponse, ApiError> {
        let payload = valid_payload(req.encrypted_payload)?;
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let saved = self.transaction(|conn| {
            diesel::insert_into(task_places::table)
                .values(NewTaskPlaceRecord {
                    id: id.clone(),
                    user_id: user.user_id.clone(),
                    encrypted_payload: payload,
                    created_at: now,
                    updated_at: now,
                })
                .execute(conn)?;
            find(conn, &id, &user.user_id)
        })?;
        Ok(to_response(saved))
    }

    /// Replaces the place's envelope: a rename, or a move, sealed afresh on the client.
    pub fn update(
        &self,
        user: &AuthenticatedUser,
        id: &str,
        req: SaveTaskPlaceRequest,
    ) -> Result<TaskPlaceResponse, ApiError> {
        let payload = valid_payload(req.encrypted_payload)?;
        let now = Utc::now().naive_utc();
        let saved = self.transaction(|conn| {
            find(conn, id, &user.user_id)?;
            diesel::update(task_places::table.filter(task_places::id.eq(id)))
                .set((
                    task_places::encrypted_payload.eq(payload),
                    task_places::updated_at.eq(now),
                ))
                .execute(conn)?;
            find(conn, id, &user.user_id)
        })?;
        Ok(to_response(saved))
    }

    /// Deletes the place and takes it off every task that used it. The foreign key would clear
    /// `geo_place_id` too, but only this moves the tasks' `updated_at`, which is how other clients
    /// learn the geofence is gone.
    pub fn delete(&self, user: &AuthenticatedUser, id: &str) -> Result<(), ApiError> {
        let now = Utc::now().naive_utc();
        self.transaction(|conn| {
            find(conn, id, &user.user_id)?;
            diesel::update(
                tasks::table
                    .filter(tasks::geo_place_id.eq(id))
                    .filter(tasks::user_id.eq(&user.user_id)),
            )
            .set((
                tasks::geo_place_id.eq(None::<String>),
                tasks::updated_at.eq(now),
            ))
            .execute(conn)?;
            diesel::delete(task_places::table.filter(task_places::id.eq(id))).execute(conn)?;
            Ok(())
        })
    }
}

/// Whether `id` is one of `user_id`'s saved places: a task may only point at its owner's.
pub fn is_owned(conn: &mut SqliteConnection, id: &str, user_id: &str) -> Result<bool, ApiError> {
    let count: i64 = task_places::table
        .filter(task_places::id.eq(id))
        .filter(task_places::user_id.eq(user_id))
        .count()
        .get_result(conn)?;
    Ok(count > 0)
}

fn find(conn: &mut SqliteConnection, id: &str, user_id: &str) -> Result<TaskPlaceRecord, ApiError> {
    task_places::table
        .filter(task_places::id.eq(id))
        .filter(task_places::user_id.eq(user_id))
        .select(TaskPlaceRecord::as_select())
        .first(conn)
        .optional()?
        .ok_or_else(|| ApiError::not_found("Place not found"))
}

/// Opaque, but present and bounded. Its content is never looked at, so nothing here can leak it.
fn valid_payload(payload: String) -> Result<String, ApiError> {
    if payload.trim().is_empty() {
        return Err(ApiError::bad_request("encryptedPayload is required"));
    }
    if payload.len() > MAX_PAYLOAD_BYTES {
        return Err(ApiError::bad_request(format!(
            "encryptedPayload is larger than {MAX_PAYLOAD_BYTES} bytes"
        )));
    }
    Ok(payload)
}

fn to_response(r: TaskPlaceRecord) -> TaskPlaceResponse {
    TaskPlaceResponse {
        id: r.id,
        encrypted_payload: r.encrypted_payload,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        updated_at: r.updated_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    const ENVELOPE: &str = r#"{"v":1,"keyVersion":1,"key":"k","data":"d"}"#;

    fn service() -> (TaskPlacesService, DbPool) {
        let pool = Pool::builder()
            .max_size(1)
            .build(ConnectionManager::<SqliteConnection>::new(":memory:"))
            .expect("pool");
        {
            let mut conn = pool.get().unwrap();
            conn.run_pending_migrations(crate::MIGRATIONS)
                .expect("migrations");
            for id in ["alice", "bob"] {
                diesel::sql_query(format!(
                    "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
                     VALUES ('{id}', '{id}@example.com', '{id}', 'hash', datetime('now'), 'user', 0)"
                ))
                .execute(&mut conn)
                .expect("user");
            }
        }
        (TaskPlacesService::new(pool.clone()), pool)
    }

    fn user(id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: id.into(),
            email: format!("{id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
    }

    fn save(payload: &str) -> SaveTaskPlaceRequest {
        SaveTaskPlaceRequest {
            encrypted_payload: payload.into(),
        }
    }

    #[test]
    fn creates_lists_updates_and_deletes_a_place() {
        let (svc, _) = service();
        let alice = user("alice");
        let made = svc.create(&alice, save(ENVELOPE)).unwrap();
        assert_eq!(made.encrypted_payload, ENVELOPE);

        let listed = svc.list(&alice).unwrap().places;
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, made.id);

        let renamed = r#"{"v":1,"keyVersion":1,"key":"k2","data":"d2"}"#;
        assert_eq!(
            svc.update(&alice, &made.id, save(renamed))
                .unwrap()
                .encrypted_payload,
            renamed
        );

        svc.delete(&alice, &made.id).unwrap();
        assert!(svc.list(&alice).unwrap().places.is_empty());
        assert_eq!(svc.delete(&alice, &made.id).unwrap_err().status, 404);
    }

    #[test]
    fn another_users_place_is_not_found_and_not_listed() {
        let (svc, _) = service();
        let place = svc.create(&user("alice"), save(ENVELOPE)).unwrap();
        let bob = user("bob");
        assert!(svc.list(&bob).unwrap().places.is_empty());
        assert_eq!(
            svc.update(&bob, &place.id, save(ENVELOPE))
                .unwrap_err()
                .status,
            404
        );
        assert_eq!(svc.delete(&bob, &place.id).unwrap_err().status, 404);
    }

    #[test]
    fn an_oversize_or_empty_payload_is_refused() {
        let (svc, _) = service();
        let alice = user("alice");
        let big = "x".repeat(MAX_PAYLOAD_BYTES + 1);
        assert_eq!(svc.create(&alice, save(&big)).unwrap_err().status, 400);
        assert_eq!(svc.create(&alice, save("  ")).unwrap_err().status, 400);
        assert!(svc
            .create(&alice, save(&"x".repeat(MAX_PAYLOAD_BYTES)))
            .is_ok());
    }

    #[test]
    fn deleting_a_place_clears_it_from_its_tasks_only() {
        let (svc, pool) = service();
        let alice = user("alice");
        let home = svc.create(&alice, save(ENVELOPE)).unwrap();
        let work = svc.create(&alice, save(ENVELOPE)).unwrap();
        {
            let mut conn = pool.get().unwrap();
            for (task, place) in [("t-home", &home.id), ("t-work", &work.id)] {
                diesel::sql_query(format!(
                    "INSERT INTO tasks (id, user_id, title, done, position, created_at, updated_at, geo_place_id) \
                     VALUES ('{task}', 'alice', 't', 0, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00', '{place}')"
                ))
                .execute(&mut conn)
                .unwrap();
            }
        }

        svc.delete(&alice, &home.id).unwrap();

        let mut conn = pool.get().unwrap();
        let rows: Vec<(String, Option<String>, chrono::NaiveDateTime)> = tasks::table
            .order(tasks::id.asc())
            .select((tasks::id, tasks::geo_place_id, tasks::updated_at))
            .load(&mut conn)
            .unwrap();
        assert_eq!(rows[0].0, "t-home");
        assert_eq!(rows[0].1, None);
        assert!(
            rows[0].2.and_utc().timestamp() > 1_767_225_600,
            "updated_at moved, so clients see it"
        );
        assert_eq!(rows[1].1.as_deref(), Some(work.id.as_str()));
    }

    #[test]
    fn a_place_belongs_only_to_its_owner() {
        let (svc, pool) = service();
        let place = svc.create(&user("alice"), save(ENVELOPE)).unwrap();
        let mut conn = pool.get().unwrap();
        assert!(is_owned(&mut conn, &place.id, "alice").unwrap());
        assert!(!is_owned(&mut conn, &place.id, "bob").unwrap());
        assert!(!is_owned(&mut conn, "nope", "alice").unwrap());
    }

    #[test]
    fn the_request_never_prints_its_payload() {
        let printed = format!("{:?}", save("SECRET-CIPHERTEXT"));
        assert!(!printed.contains("SECRET"));
    }
}
