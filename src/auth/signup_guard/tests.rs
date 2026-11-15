//! The sign-up guard end to end through `SignupService::register_from`: the
//! address checks, every limit, the CAPTCHA buckets, reservations being given
//! back, and the admin summary and bulk delete.
//!
//! One in-memory database with a single connection; the CAPTCHA is a stand-in
//! that passes the token `"good"`, fails `"bad"`, and is unavailable for
//! `"down"`.

use std::sync::Arc;

use async_trait::async_trait;
use chrono::{Duration, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::config::SignupGuardConfig;
use super::repository::{SignupGuardRepository, UserFilter};
use super::service::SignupGuard;
use super::turnstile::{CaptchaOutcome, CaptchaVerifier};
use crate::auth::dto::RegisterRequest;
use crate::auth::invites::repository::InviteRepository;
use crate::auth::invites::service::InviteService;
use crate::auth::password_policy::PasswordPolicyRepository;
use crate::auth::repository::AuthRepository;
use crate::auth::service::AuthService;
use crate::auth::signup::SignupService;
use crate::auth::tokens::TokenService;
use crate::auth::welcome::WelcomeMailer;
use crate::preferences::repository::PreferencesRepository;
use crate::schema::{signup_events, users};
use crate::shared::mail::Mailer;
use crate::shared::{ApiError, DbPool};

struct FakeCaptcha;

#[async_trait]
impl CaptchaVerifier for FakeCaptcha {
    async fn verify(&self, token: &str, _ip: &str) -> CaptchaOutcome {
        match token {
            "good" => CaptchaOutcome::Passed,
            "down" => CaptchaOutcome::Unavailable,
            _ => CaptchaOutcome::Failed,
        }
    }
}

struct Fx {
    pool: DbPool,
    signup: SignupService,
    repo: Arc<SignupGuardRepository>,
}

fn fx(config: SignupGuardConfig, captcha: bool) -> Fx {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(crate::MIGRATIONS)
        .expect("migrations");

    let auth = Arc::new(AuthService::new(
        Arc::new(AuthRepository::new(pool.clone())),
        Arc::new(TokenService::new_with_expiry("test-secret".into(), 900, 604800)),
        Arc::new(PasswordPolicyRepository::new(pool.clone())),
    ));
    let outbox = std::env::temp_dir()
        .join(format!("neutrino-signup-guard-{}", uuid::Uuid::new_v4()))
        .join("outbox.jsonl");
    let mailer = Arc::new(Mailer::Outbox(outbox));
    let invites = Arc::new(InviteService::new(
        Arc::new(InviteRepository::new(pool.clone())),
        "test-secret".into(),
        mailer.clone(),
        "https://neutrino.test".into(),
    ));
    let repo = Arc::new(SignupGuardRepository::new(pool.clone()));
    let guard = Arc::new(SignupGuard::new(
        repo.clone(),
        config,
        captcha.then(|| Arc::new(FakeCaptcha) as Arc<dyn CaptchaVerifier>),
    ));
    let signup = SignupService::new(
        auth,
        invites,
        Arc::new(WelcomeMailer::new(mailer, "https://neutrino.test".into())),
        Arc::new(PreferencesRepository::new(pool.clone())),
        true,
    )
    .with_guard(guard);
    Fx { pool, signup, repo }
}

/// Limits wide enough that only the one under test can trip.
fn open() -> SignupGuardConfig {
    SignupGuardConfig {
        ip_hourly: 0,
        ip_daily: 0,
        global_hourly: 0,
        unverified_ip_daily: 0,
        unverified_global_hourly: 0,
        turnstile_site_key: Some("site-key".into()),
        ..SignupGuardConfig::default()
    }
}

fn req(email: &str, captcha: Option<&str>) -> RegisterRequest {
    RegisterRequest {
        email: email.into(),
        password: "password123".into(),
        name: "New Person".into(),
        invite_token: None,
        turnstile_token: captcha.map(str::to_string),
    }
}

impl Fx {
    async fn signup(&self, email: &str, ip: &str, captcha: Option<&str>) -> Result<String, ApiError> {
        self.signup.register_from(req(email, captcha), ip).await.map(|u| u.id)
    }

    fn events(&self) -> i64 {
        signup_events::table.count().get_result(&mut self.pool.get().unwrap()).unwrap()
    }
}

fn code(r: Result<String, ApiError>) -> (u16, String) {
    match r {
        Ok(_) => panic!("expected an error, got Ok"),
        Err(e) => (e.status, e.code),
    }
}

// ── address checks ────────────────────────────────────────────────────────────

#[actix_web::test]
async fn malformed_and_throwaway_addresses_are_refused_before_anything_is_counted() {
    let fx = fx(SignupGuardConfig { blocked_domains: vec!["spam.example".into()], ..open() }, false);
    assert_eq!(code(fx.signup("not-an-email", "1.1.1.1", None).await), (400, "INVALID_EMAIL".into()));
    for email in ["x@mailinator.com", "x@inbox.yopmail.com", "x@spam.example"] {
        assert_eq!(
            code(fx.signup(email, "1.1.1.1", None).await),
            (400, "EMAIL_DOMAIN_NOT_ALLOWED".into()),
            "{email}"
        );
    }
    assert_eq!(fx.events(), 0);
}

// ── limits ────────────────────────────────────────────────────────────────────

#[actix_web::test]
async fn per_ip_hourly_limit_applies_to_one_address_only() {
    let fx = fx(SignupGuardConfig { ip_hourly: 2, ..open() }, false);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    fx.signup("b@example.com", "1.1.1.1", None).await.unwrap();
    assert_eq!(
        code(fx.signup("c@example.com", "1.1.1.1", None).await),
        (429, "SIGNUP_RATE_LIMITED".into())
    );
    fx.signup("c@example.com", "2.2.2.2", None).await.unwrap();
    // The refused attempt left nothing behind.
    assert_eq!(fx.events(), 3);
}

#[actix_web::test]
async fn per_ip_daily_limit_counts_the_whole_day() {
    let fx = fx(SignupGuardConfig { ip_daily: 2, ..open() }, false);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    fx.signup("b@example.com", "1.1.1.1", None).await.unwrap();
    // Age both sign-ups past the hour but within the day.
    diesel::update(signup_events::table)
        .set(signup_events::created_at.eq(Utc::now().naive_utc() - Duration::hours(5)))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_eq!(code(fx.signup("c@example.com", "1.1.1.1", None).await).0, 429);
}

#[actix_web::test]
async fn server_wide_limit_spans_addresses() {
    let fx = fx(SignupGuardConfig { global_hourly: 2, ..open() }, false);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    fx.signup("b@example.com", "2.2.2.2", None).await.unwrap();
    assert_eq!(
        code(fx.signup("c@example.com", "3.3.3.3", None).await),
        (429, "SIGNUP_RATE_LIMITED".into())
    );
}

#[actix_web::test]
async fn a_failed_registration_gives_its_place_back() {
    let fx = fx(SignupGuardConfig { ip_hourly: 1, ..open() }, false);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    // Taken email from a fresh address: refused by registration, not the guard.
    assert_eq!(code(fx.signup("a@example.com", "2.2.2.2", None).await).0, 409);
    assert_eq!(fx.events(), 1);
    fx.signup("b@example.com", "2.2.2.2", None).await.unwrap();
}

// ── CAPTCHA ───────────────────────────────────────────────────────────────────

#[actix_web::test]
async fn without_a_captcha_token_the_tight_limits_apply_and_with_one_they_do_not() {
    let fx = fx(SignupGuardConfig { unverified_ip_daily: 1, ..open() }, true);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    assert_eq!(
        code(fx.signup("b@example.com", "1.1.1.1", None).await),
        (429, "SIGNUP_CAPTCHA_REQUIRED".into())
    );
    fx.signup("b@example.com", "1.1.1.1", Some("good")).await.unwrap();
    fx.signup("c@example.com", "1.1.1.1", Some("good")).await.unwrap();
}

#[actix_web::test]
async fn tokenless_sign_ups_are_capped_server_wide() {
    let fx = fx(SignupGuardConfig { unverified_global_hourly: 2, ..open() }, true);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    fx.signup("b@example.com", "2.2.2.2", None).await.unwrap();
    assert_eq!(code(fx.signup("c@example.com", "3.3.3.3", None).await).1, "SIGNUP_CAPTCHA_REQUIRED");
    fx.signup("c@example.com", "3.3.3.3", Some("good")).await.unwrap();
}

#[actix_web::test]
async fn a_bad_token_is_an_error_and_an_outage_counts_as_no_token() {
    let fx = fx(SignupGuardConfig { unverified_ip_daily: 1, ..open() }, true);
    assert_eq!(
        code(fx.signup("a@example.com", "1.1.1.1", Some("bad")).await),
        (400, "CAPTCHA_FAILED".into())
    );
    fx.signup("a@example.com", "1.1.1.1", Some("down")).await.unwrap();
    assert_eq!(code(fx.signup("b@example.com", "1.1.1.1", Some("down")).await).0, 429);
}

#[actix_web::test]
async fn tokenless_limits_do_not_apply_while_no_captcha_is_configured() {
    let fx = fx(SignupGuardConfig { unverified_ip_daily: 1, ..open() }, false);
    fx.signup("a@example.com", "1.1.1.1", None).await.unwrap();
    fx.signup("b@example.com", "1.1.1.1", None).await.unwrap();
    assert_eq!(fx.signup.captcha_site_key(), None);
}

#[actix_web::test]
async fn the_site_key_is_published_only_with_a_verifier() {
    let fx = fx(open(), true);
    assert_eq!(fx.signup.captcha_site_key().as_deref(), Some("site-key"));
}

// ── admin ─────────────────────────────────────────────────────────────────────

fn verify(pool: &DbPool, id: &str) {
    diesel::update(users::table.filter(users::id.eq(id)))
        .set(users::email_verified_at.eq(Some(Utc::now().naive_utc())))
        .execute(&mut pool.get().unwrap())
        .unwrap();
}

fn make_admin(pool: &DbPool, id: &str) {
    diesel::update(users::table.filter(users::id.eq(id)))
        .set(users::role.eq("admin"))
        .execute(&mut pool.get().unwrap())
        .unwrap();
}

fn live(pool: &DbPool, id: &str) -> bool {
    users::table
        .filter(users::id.eq(id))
        .select(users::deleted_at)
        .first::<Option<chrono::NaiveDateTime>>(&mut pool.get().unwrap())
        .unwrap()
        .is_none()
}

#[actix_web::test]
async fn summary_groups_recent_sign_ups_by_ip_and_domain() {
    let fx = fx(open(), false);
    for i in 0..3 {
        fx.signup(&format!("bot{i}@bots.example"), "6.6.6.6", None).await.unwrap();
    }
    let real = fx.signup("ann@example.com", "1.1.1.1", None).await.unwrap();
    verify(&fx.pool, &real);

    let since = Utc::now().naive_utc() - Duration::hours(1);
    let ips = fx.repo.top_ips(since, 10).unwrap();
    assert_eq!((ips[0].key.as_str(), ips[0].total, ips[0].unverified), ("6.6.6.6", 3, 3));
    let domains = fx.repo.top_domains(since, 10).unwrap();
    assert_eq!((domains[0].key.as_str(), domains[0].total), ("bots.example", 3));
    assert_eq!(fx.repo.created_since(since).unwrap(), (4, 3));
}

#[actix_web::test]
async fn bulk_delete_takes_only_unverified_non_admin_matches_and_spares_the_caller() {
    let fx = fx(open(), false);
    let bot1 = fx.signup("bot1@bots.example", "6.6.6.6", None).await.unwrap();
    let bot2 = fx.signup("bot2@bots.example", "6.6.6.6", None).await.unwrap();
    let verified = fx.signup("real@bots.example", "6.6.6.6", None).await.unwrap();
    verify(&fx.pool, &verified);
    let admin = fx.signup("admin@bots.example", "6.6.6.6", None).await.unwrap();
    make_admin(&fx.pool, &admin);
    let caller = fx.signup("me@bots.example", "6.6.6.6", None).await.unwrap();
    let elsewhere = fx.signup("ann@example.com", "1.1.1.1", None).await.unwrap();

    let by_ip = UserFilter { ip: Some("6.6.6.6".into()), ..Default::default() };
    let (n, sample) = fx.repo.match_users(&by_ip, &caller, 100).unwrap();
    assert_eq!(n, 2);
    assert!(sample.iter().all(|u| u.ip.as_deref() == Some("6.6.6.6")));

    let deleted = fx.repo.soft_delete_matching(&by_ip, &caller, Utc::now().naive_utc()).unwrap();
    assert_eq!(deleted, 2);
    assert!(!live(&fx.pool, &bot1) && !live(&fx.pool, &bot2));
    for id in [&verified, &admin, &caller, &elsewhere] {
        assert!(live(&fx.pool, id));
    }

    // A domain filter reaches accounts with no sign-up event too, and
    // `include_verified` widens it.
    diesel::delete(signup_events::table).execute(&mut fx.pool.get().unwrap()).unwrap();
    let by_domain = UserFilter {
        email_domain: Some("bots.example".into()),
        include_verified: true,
        ..Default::default()
    };
    assert_eq!(fx.repo.match_users(&by_domain, &caller, 100).unwrap().0, 1);
    fx.repo.soft_delete_matching(&by_domain, &caller, Utc::now().naive_utc()).unwrap();
    assert!(!live(&fx.pool, &verified));
}
