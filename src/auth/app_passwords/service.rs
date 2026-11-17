//! App passwords: what a CalDAV client (the iPhone's Calendar and Reminders accounts, macOS,
//! Thunderbird, DAVx⁵) signs in with. HTTP Basic, the account email and one of these.
//!
//! The account password is never accepted where these are: an account with two-factor sign-in
//! would be locked out of CalDAV, and a phone holding the main password is the wrong trade.
//! A password is generated here, shown once, and kept only as an Argon2 hash.
//!
//! A CalDAV client sends its credentials on **every** request, and an Argon2 verify is tens of
//! milliseconds by design, so a verified pair is remembered for a few minutes (`VERIFIED_TTL`)
//! under a SHA-256 of the pair. Revoking clears the cache, so a revoked password stops working
//! at once. Failures are counted per address and per client IP, and a run of them locks that
//! key out for a while (`FAILURE_WINDOW`), which is what stands between Basic auth and a guess
//! per request.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chrono::Utc;
use diesel::prelude::*;
use rand::Rng;
use sha2::{Digest, Sha256};
use uuid::Uuid;

use super::dto::{AppPasswordResponse, CreateAppPasswordRequest, CreatedAppPasswordResponse};
use crate::schema::{app_passwords, users};
use crate::shared::{ApiError, AuthenticatedUser, DbPool};

/// The one scope today. A column rather than an assumption, so a later use (a mail client,
/// WebDAV for Drive) gets passwords that can't sign in to calendars.
pub const SCOPE_CALDAV: &str = "caldav";

const VERIFIED_TTL: Duration = Duration::from_secs(5 * 60);
const TOUCH_EVERY: Duration = Duration::from_secs(60);
const FAILURE_WINDOW: Duration = Duration::from_secs(15 * 60);
const MAX_FAILURES: u32 = 10;
const MAX_NAME_LEN: usize = 100;
/// How many verified pairs, and failure counters, are kept in memory before expired ones are
/// swept out.
const MAX_TRACKED: usize = 10_000;

#[allow(dead_code)]
#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = crate::schema::app_passwords)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct AppPasswordRecord {
    pub id: String,
    pub user_id: String,
    pub name: String,
    pub password_hash: String,
    pub scope: String,
    pub created_at: chrono::NaiveDateTime,
    pub last_used_at: Option<chrono::NaiveDateTime>,
    pub revoked_at: Option<chrono::NaiveDateTime>,
}

#[derive(Insertable)]
#[diesel(table_name = crate::schema::app_passwords)]
struct NewAppPassword {
    id: String,
    user_id: String,
    name: String,
    password_hash: String,
    scope: String,
    created_at: chrono::NaiveDateTime,
}

#[derive(Clone)]
struct Verified {
    user_id: String,
    email: String,
    is_admin: bool,
    password_id: String,
    until: Instant,
    touched: Instant,
}

/// Why a sign-in was refused. The DAV layer answers each differently: a wrong password is a
/// `401` with a challenge, a locked-out key a `429` with none, so a client stops retrying.
#[derive(Debug, PartialEq)]
pub enum BasicAuthError {
    Invalid,
    TooManyAttempts,
}

pub struct AppPasswordsService {
    pool: DbPool,
    verified: Mutex<HashMap<[u8; 32], Verified>>,
    failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl AppPasswordsService {
    pub fn new(pool: DbPool) -> Self {
        AppPasswordsService {
            pool,
            verified: Mutex::new(HashMap::new()),
            failures: Mutex::new(HashMap::new()),
        }
    }

    fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<diesel::r2d2::ConnectionManager<SqliteConnection>>, ApiError>
    {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database error")
        })
    }

    pub fn list(&self, user: &AuthenticatedUser) -> Result<Vec<AppPasswordResponse>, ApiError> {
        let mut conn = self.conn()?;
        let rows = app_passwords::table
            .filter(app_passwords::user_id.eq(&user.user_id))
            .filter(app_passwords::revoked_at.is_null())
            .order(app_passwords::created_at.desc())
            .select(AppPasswordRecord::as_select())
            .load(&mut conn)
            .map_err(db_error)?;
        Ok(rows.into_iter().map(to_response).collect())
    }

    /// Makes a password and returns it in the clear, the only time it is ever available.
    pub fn create(
        &self,
        user: &AuthenticatedUser,
        req: CreateAppPasswordRequest,
    ) -> Result<CreatedAppPasswordResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Give the device a name"));
        }
        if name.chars().count() > MAX_NAME_LEN {
            return Err(ApiError::bad_request("That name is too long"));
        }
        let password = generate_password();
        let salt = SaltString::generate(&mut OsRng);
        let hash = Argon2::default()
            .hash_password(normalize(&password).as_bytes(), &salt)
            .map_err(|e| {
                tracing::error!("App password hashing error: {:?}", e);
                ApiError::internal("Failed to create the password")
            })?
            .to_string();
        let record = NewAppPassword {
            id: Uuid::new_v4().to_string(),
            user_id: user.user_id.clone(),
            name,
            password_hash: hash,
            scope: SCOPE_CALDAV.to_string(),
            created_at: Utc::now().naive_utc(),
        };
        let mut conn = self.conn()?;
        diesel::insert_into(app_passwords::table)
            .values(&record)
            .execute(&mut conn)
            .map_err(db_error)?;
        let saved = app_passwords::table
            .filter(app_passwords::id.eq(&record.id))
            .select(AppPasswordRecord::as_select())
            .first(&mut conn)
            .map_err(db_error)?;
        Ok(CreatedAppPasswordResponse {
            app_password: to_response(saved),
            password,
        })
    }

    pub fn revoke(&self, user: &AuthenticatedUser, id: &str) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        let n = diesel::update(
            app_passwords::table
                .filter(app_passwords::id.eq(id))
                .filter(app_passwords::user_id.eq(&user.user_id))
                .filter(app_passwords::revoked_at.is_null()),
        )
        .set(app_passwords::revoked_at.eq(Some(Utc::now().naive_utc())))
        .execute(&mut conn)
        .map_err(db_error)?;
        if n == 0 {
            return Err(ApiError::not_found("App password not found"));
        }
        self.forget_password(id);
        Ok(())
    }

    /// Revokes every app password the user has: "Sign out everywhere" and account deletion.
    pub fn revoke_all(&self, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::update(
            app_passwords::table
                .filter(app_passwords::user_id.eq(user_id))
                .filter(app_passwords::revoked_at.is_null()),
        )
        .set(app_passwords::revoked_at.eq(Some(Utc::now().naive_utc())))
        .execute(&mut conn)
        .map_err(db_error)?;
        self.verified
            .lock()
            .unwrap()
            .retain(|_, v| v.user_id != user_id);
        Ok(())
    }

    /// Checks HTTP Basic credentials for `scope`. `client` is the caller's address, for the
    /// per-IP failure count.
    pub fn verify_basic(
        &self,
        email: &str,
        password: &str,
        scope: &str,
        client: &str,
    ) -> Result<AuthenticatedUser, BasicAuthError> {
        let email_key = format!("email:{}", email.trim().to_lowercase());
        let ip_key = format!("ip:{client}");
        if self.locked_out(&email_key) || self.locked_out(&ip_key) {
            return Err(BasicAuthError::TooManyAttempts);
        }
        let key = cache_key(email, password, scope);
        if let Some(user) = self.cached(&key) {
            return Ok(user);
        }
        match self.verify_uncached(email, password, scope) {
            Ok(Some(entry)) => {
                self.touch(&entry.password_id);
                let user = AuthenticatedUser {
                    user_id: entry.user_id.clone(),
                    email: entry.email.clone(),
                    token: String::new(),
                    is_admin: entry.is_admin,
                };
                let mut verified = self.verified.lock().unwrap();
                if verified.len() >= MAX_TRACKED {
                    let now = Instant::now();
                    verified.retain(|_, v| v.until > now);
                }
                verified.insert(key, entry);
                drop(verified);
                self.failures.lock().unwrap().remove(&email_key);
                Ok(user)
            }
            Ok(None) => {
                self.fail(&email_key);
                self.fail(&ip_key);
                Err(BasicAuthError::Invalid)
            }
            Err(e) => {
                tracing::error!("App password check failed: {:?}", e);
                Err(BasicAuthError::Invalid)
            }
        }
    }

    fn verify_uncached(&self, email: &str, password: &str, scope: &str) -> Result<Option<Verified>, ApiError> {
        let mut conn = self.conn()?;
        let user: Option<(String, String, String)> = users::table
            .filter(users::email.eq(email.trim()))
            .filter(users::deleted_at.is_null())
            .filter(users::disabled_at.is_null())
            .filter(users::locked_out_at.is_null())
            .select((users::id, users::email, users::role))
            .first(&mut conn)
            .optional()
            .map_err(db_error)?;
        let Some((user_id, email, role)) = user else {
            return Ok(None);
        };
        let candidates = app_passwords::table
            .filter(app_passwords::user_id.eq(&user_id))
            .filter(app_passwords::scope.eq(scope))
            .filter(app_passwords::revoked_at.is_null())
            .select(AppPasswordRecord::as_select())
            .load(&mut conn)
            .map_err(db_error)?;
        let typed = normalize(password);
        let now = Instant::now();
        for candidate in candidates {
            let Ok(parsed) = PasswordHash::new(&candidate.password_hash) else {
                continue;
            };
            if Argon2::default().verify_password(typed.as_bytes(), &parsed).is_ok() {
                return Ok(Some(Verified {
                    user_id,
                    email,
                    is_admin: role == "admin",
                    password_id: candidate.id,
                    until: now + VERIFIED_TTL,
                    // Already in the past, so the first use is recorded.
                    touched: now.checked_sub(TOUCH_EVERY).unwrap_or(now),
                }));
            }
        }
        Ok(None)
    }

    fn cached(&self, key: &[u8; 32]) -> Option<AuthenticatedUser> {
        let mut verified = self.verified.lock().unwrap();
        let now = Instant::now();
        let entry = verified.get_mut(key)?;
        if entry.until <= now {
            verified.remove(key);
            return None;
        }
        let user = AuthenticatedUser {
            user_id: entry.user_id.clone(),
            email: entry.email.clone(),
            token: String::new(),
            is_admin: entry.is_admin,
        };
        if now.duration_since(entry.touched) >= TOUCH_EVERY {
            entry.touched = now;
            let id = entry.password_id.clone();
            drop(verified);
            self.touch(&id);
        }
        Some(user)
    }

    fn touch(&self, password_id: &str) {
        let Ok(mut conn) = self.conn() else { return };
        if let Err(e) = diesel::update(app_passwords::table.filter(app_passwords::id.eq(password_id)))
            .set(app_passwords::last_used_at.eq(Some(Utc::now().naive_utc())))
            .execute(&mut conn)
        {
            tracing::warn!("Could not record app password use: {:?}", e);
        }
    }

    fn forget_password(&self, password_id: &str) {
        self.verified
            .lock()
            .unwrap()
            .retain(|_, v| v.password_id != password_id);
    }

    fn locked_out(&self, key: &str) -> bool {
        let mut failures = self.failures.lock().unwrap();
        match failures.get(key) {
            Some((_, since)) if since.elapsed() >= FAILURE_WINDOW => {
                failures.remove(key);
                false
            }
            Some((count, _)) => *count >= MAX_FAILURES,
            None => false,
        }
    }

    fn fail(&self, key: &str) {
        let mut failures = self.failures.lock().unwrap();
        // Bounded: under a spray of addresses, forget the runs that have already expired.
        if failures.len() >= MAX_TRACKED {
            failures.retain(|_, (_, since)| since.elapsed() < FAILURE_WINDOW);
        }
        let entry = failures.entry(key.to_string()).or_insert((0, Instant::now()));
        entry.0 += 1;
    }
}

/// Sixteen letters in four groups, `abcd-efgh-ijkl-mnop`: about 75 bits, and easy to read off
/// one screen and type on another. Lowercase only, so a phone's auto-capitalisation is harmless.
fn generate_password() -> String {
    const ALPHABET: &[u8] = b"abcdefghijkmnopqrstuvwxyz"; // no `l`, which reads as `1` or `I`
    let mut rng = rand::thread_rng();
    (0..4)
        .map(|_| {
            (0..4)
                .map(|_| ALPHABET[rng.gen_range(0..ALPHABET.len())] as char)
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("-")
}

/// What is hashed and compared: the letters alone, lowercased, so `ABCD EFGH…` typed with
/// spaces, or without the dashes, still signs in.
fn normalize(password: &str) -> String {
    password
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect()
}

fn cache_key(email: &str, password: &str, scope: &str) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(email.trim().to_lowercase().as_bytes());
    hasher.update([0]);
    hasher.update(normalize(password).as_bytes());
    hasher.update([0]);
    hasher.update(scope.as_bytes());
    hasher.finalize().into()
}

fn to_response(r: AppPasswordRecord) -> AppPasswordResponse {
    AppPasswordResponse {
        id: r.id,
        name: r.name,
        created_at: r.created_at.format("%Y-%m-%dT%H:%M:%SZ").to_string(),
        last_used_at: r.last_used_at.map(|t| t.format("%Y-%m-%dT%H:%M:%SZ").to_string()),
    }
}

fn db_error(e: diesel::result::Error) -> ApiError {
    tracing::error!("App passwords DB error: {:?}", e);
    ApiError::internal("Database error")
}

#[cfg(test)]
mod tests {
    use super::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    fn pool() -> DbPool {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn user(pool: &DbPool, id: &str, email: &str) -> AuthenticatedUser {
        let mut conn = pool.get().unwrap();
        diesel::sql_query(format!(
            "INSERT INTO users (id, email, name, password_hash, created_at, role) \
             VALUES ('{id}', '{email}', 'Test', 'x', CURRENT_TIMESTAMP, 'user')"
        ))
        .execute(&mut conn)
        .unwrap();
        AuthenticatedUser {
            user_id: id.into(),
            email: email.into(),
            token: String::new(),
            is_admin: false,
        }
    }

    fn create(service: &AppPasswordsService, user: &AuthenticatedUser) -> CreatedAppPasswordResponse {
        service
            .create(user, CreateAppPasswordRequest { name: "iPhone".into() })
            .unwrap()
    }

    #[test]
    fn a_new_password_is_sixteen_letters_in_four_groups() {
        let p = generate_password();
        assert_eq!(p.len(), 19);
        assert!(p.split('-').all(|g| g.len() == 4 && g.chars().all(|c| c.is_ascii_lowercase())));
        assert_ne!(generate_password(), p);
    }

    #[test]
    fn the_password_is_shown_once_and_signs_in() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        let created = create(&service, &ada);
        let listed = service.list(&ada).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "iPhone");
        let signed_in = service
            .verify_basic("ada@example.com", &created.password, SCOPE_CALDAV, "1.2.3.4")
            .unwrap();
        assert_eq!(signed_in.user_id, "u1");
        // Typed on a phone: capitals and spaces instead of dashes.
        let typed = created.password.to_uppercase().replace('-', " ");
        assert!(service.verify_basic("ada@example.com", &typed, SCOPE_CALDAV, "1.2.3.4").is_ok());
    }

    #[test]
    fn the_account_password_and_a_wrong_one_are_refused() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        create(&service, &ada);
        assert_eq!(
            service.verify_basic("ada@example.com", "x", SCOPE_CALDAV, "1.2.3.4").err(),
            Some(BasicAuthError::Invalid)
        );
        assert_eq!(
            service.verify_basic("nobody@example.com", "abcd-efgh-ijkm-nopq", SCOPE_CALDAV, "1.2.3.4").err(),
            Some(BasicAuthError::Invalid)
        );
    }

    #[test]
    fn a_revoked_password_stops_working_at_once() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        let created = create(&service, &ada);
        // Signed in, so the pair is cached.
        service
            .verify_basic("ada@example.com", &created.password, SCOPE_CALDAV, "1.2.3.4")
            .unwrap();
        service.revoke(&ada, &created.app_password.id).unwrap();
        assert!(service
            .verify_basic("ada@example.com", &created.password, SCOPE_CALDAV, "1.2.3.4")
            .is_err());
        assert!(service.list(&ada).unwrap().is_empty());
    }

    #[test]
    fn revoke_all_signs_every_device_out() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        let one = create(&service, &ada);
        let two = create(&service, &ada);
        service.verify_basic("ada@example.com", &one.password, SCOPE_CALDAV, "ip").unwrap();
        service.revoke_all("u1").unwrap();
        assert!(service.verify_basic("ada@example.com", &one.password, SCOPE_CALDAV, "ip").is_err());
        assert!(service.verify_basic("ada@example.com", &two.password, SCOPE_CALDAV, "ip").is_err());
    }

    #[test]
    fn another_users_password_cannot_be_revoked() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        let bob = user(&pool, "u2", "bob@example.com");
        let created = create(&service, &ada);
        assert_eq!(service.revoke(&bob, &created.app_password.id).unwrap_err().status, 404);
    }

    #[test]
    fn a_run_of_failures_locks_the_address_out_even_for_the_right_password() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        let created = create(&service, &ada);
        for _ in 0..MAX_FAILURES {
            let _ = service.verify_basic("ada@example.com", "wrong", SCOPE_CALDAV, "9.9.9.9");
        }
        assert_eq!(
            service.verify_basic("ada@example.com", &created.password, SCOPE_CALDAV, "1.1.1.1").err(),
            Some(BasicAuthError::TooManyAttempts)
        );
    }

    #[test]
    fn a_disabled_account_cannot_sign_in() {
        let pool = pool();
        let service = AppPasswordsService::new(pool.clone());
        let ada = user(&pool, "u1", "ada@example.com");
        let created = create(&service, &ada);
        diesel::sql_query("UPDATE users SET disabled_at = CURRENT_TIMESTAMP WHERE id = 'u1'")
            .execute(&mut pool.get().unwrap())
            .unwrap();
        assert!(service
            .verify_basic("ada@example.com", &created.password, SCOPE_CALDAV, "ip")
            .is_err());
    }
}
