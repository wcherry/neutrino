//! Email verification: when links go out, what following one does, the checks
//! a link goes through, and what is refused to an unverified account under
//! each mode.
//!
//! Every test gets its own in-memory database with a single connection, so
//! nothing here may hold a connection across a call into the service.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{Duration, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::email::{compose_verify, VERIFY_SUBJECT};
use super::policy::{VerificationMode, GRACE_DAYS};
use super::repository::EmailVerificationRepository;
use super::service::*;
use crate::auth::dto::{LoginRequest, RefreshRequest, RegisterRequest};
use crate::auth::password_policy::PasswordPolicyRepository;
use crate::auth::password_reset::repository::PasswordResetRepository;
use crate::auth::password_reset::service::PasswordResetService;
use crate::auth::repository::AuthRepository;
use crate::auth::service::AuthService;
use crate::auth::tokens::TokenService;
use crate::schema::{email_verifications, users};
use crate::shared::mail::Mailer;
use crate::shared::ApiError;

// ── fixtures ──────────────────────────────────────────────────────────────────

const PASSWORD: &str = "a-password-1";

struct Fx {
    pool: crate::shared::DbPool,
    users: Arc<AuthRepository>,
    svc: Arc<EmailVerificationService>,
    outbox: PathBuf,
    ada: String,
}

/// Ada has just signed up and not verified.
fn fx(mode: VerificationMode) -> Fx {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(crate::MIGRATIONS)
        .expect("migrations");

    let users = Arc::new(AuthRepository::new(pool.clone()));
    let ada = auth(&pool, users.clone(), mode)
        .register(RegisterRequest {
            email: "ada@example.com".into(),
            password: PASSWORD.into(),
            name: "Ada Lovelace".into(),
            invite_token: None,
        })
        .expect("register")
        .id;

    let outbox = std::env::temp_dir()
        .join(format!("neutrino-verify-{}", uuid::Uuid::new_v4()))
        .join("outbox.jsonl");
    let svc = Arc::new(EmailVerificationService::new(
        Arc::new(EmailVerificationRepository::new(pool.clone())),
        users.clone(),
        Arc::new(Mailer::Outbox(outbox.clone())),
        "https://neutrino.test/".into(),
        mode,
    ));
    Fx {
        pool,
        users,
        svc,
        outbox,
        ada,
    }
}

fn auth(pool: &crate::shared::DbPool, users: Arc<AuthRepository>, mode: VerificationMode) -> AuthService {
    AuthService::new(
        users,
        Arc::new(TokenService::new_with_expiry("test-secret".into(), 900, 604800)),
        Arc::new(PasswordPolicyRepository::new(pool.clone())),
    )
    .with_email_verification(mode)
}

/// A fresh link for Ada; its plaintext token.
fn link(fx: &Fx) -> String {
    fx.svc
        .request_by_email("ada@example.com")
        .unwrap()
        .expect("a link for Ada")
        .token
}

fn code(err: ApiError) -> String {
    err.code.to_string()
}

fn verified(fx: &Fx) -> bool {
    fx.users
        .find_user_by_id(&fx.ada)
        .unwrap()
        .unwrap()
        .email_verified_at
        .is_some()
}

/// Make Ada's account `days` old.
fn age(fx: &Fx, days: i64) {
    diesel::update(users::table.filter(users::id.eq(&fx.ada)))
        .set(users::created_at.eq(Utc::now().naive_utc() - Duration::days(days)))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

fn sign_in(fx: &Fx, mode: VerificationMode) -> Result<String, ApiError> {
    auth(&fx.pool, fx.users.clone(), mode)
        .login(
            LoginRequest {
                email: "ada@example.com".into(),
                password: PASSWORD.into(),
                totp_code: None,
            },
            None,
            None,
            None,
        )
        .map(|r| r.auth.expect("no two-factor").refresh_token)
}

fn read_outbox(path: &PathBuf) -> Vec<serde_json::Value> {
    match std::fs::read_to_string(path) {
        Ok(s) => s
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str(l).expect("outbox line is JSON"))
            .collect(),
        Err(_) => Vec::new(),
    }
}

// ── the mode ──────────────────────────────────────────────────────────────────

#[test]
fn unset_mode_enforces_only_when_mail_really_goes_out() {
    assert_eq!(VerificationMode::parse(None, true), Ok(VerificationMode::Enforce));
    assert_eq!(VerificationMode::parse(None, false), Ok(VerificationMode::Off));
    assert_eq!(VerificationMode::parse(Some(" "), true), Ok(VerificationMode::Enforce));
    assert_eq!(VerificationMode::parse(Some("Soft"), true), Ok(VerificationMode::Soft));
    assert_eq!(VerificationMode::parse(Some("off"), true), Ok(VerificationMode::Off));
    assert_eq!(VerificationMode::parse(Some("enforce"), false), Ok(VerificationMode::Enforce));
    assert!(VerificationMode::parse(Some("strict"), true).is_err());
}

#[test]
fn off_sends_nothing_and_refuses_nothing() {
    let fx = fx(VerificationMode::Off);
    assert!(fx.svc.request_by_email("ada@example.com").unwrap().is_none());
    assert_eq!(code(fx.svc.resend(&fx.ada).unwrap_err()), "BAD_REQUEST");
    assert!(fx.svc.require_verified(&fx.ada, "share files").is_ok());
    age(&fx, GRACE_DAYS + 1);
    assert!(sign_in(&fx, VerificationMode::Off).is_ok());
}

// ── following a link ──────────────────────────────────────────────────────────

#[test]
fn following_a_link_verifies_the_address_once() {
    let fx = fx(VerificationMode::Soft);
    let token = link(&fx);
    assert!(!verified(&fx));

    assert_eq!(fx.svc.verify(&token).unwrap(), "ada@example.com");
    assert!(verified(&fx));
    let status = fx.svc.status(&fx.ada).unwrap();
    assert!(status.verified_at.is_some());
    assert_eq!(status.block_at, None);

    assert_eq!(code(fx.svc.verify(&token).unwrap_err()), "VERIFY_USED");
}

#[test]
fn only_the_newest_link_works() {
    let fx = fx(VerificationMode::Soft);
    let first = link(&fx);
    let second = link(&fx);
    assert_eq!(code(fx.svc.verify(&first).unwrap_err()), "VERIFY_REVOKED");
    assert!(fx.svc.verify(&second).is_ok());
}

#[test]
fn unknown_and_expired_links_are_refused() {
    let fx = fx(VerificationMode::Soft);
    assert_eq!(code(fx.svc.verify("nope").unwrap_err()), "VERIFY_NOT_FOUND");
    assert_eq!(code(fx.svc.verify("  ").unwrap_err()), "VERIFY_NOT_FOUND");

    let token = link(&fx);
    diesel::update(email_verifications::table)
        .set(email_verifications::expires_at.eq(Utc::now().naive_utc() - Duration::minutes(1)))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_eq!(code(fx.svc.verify(&token).unwrap_err()), "VERIFY_EXPIRED");
    assert!(!verified(&fx));
}

#[test]
fn a_link_cannot_verify_an_address_the_account_no_longer_has() {
    let fx = fx(VerificationMode::Soft);
    let token = link(&fx);
    diesel::update(users::table.filter(users::id.eq(&fx.ada)))
        .set(users::email.eq("ada@elsewhere.example"))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_eq!(code(fx.svc.verify(&token).unwrap_err()), "VERIFY_REVOKED");
    assert!(!verified(&fx));
}

// ── asking for another ────────────────────────────────────────────────────────

#[test]
fn resending_is_capped_and_stops_once_verified() {
    let fx = fx(VerificationMode::Soft);
    for _ in 0..MAX_LINKS_PER_HOUR {
        assert!(matches!(fx.svc.resend(&fx.ada).unwrap(), Resend::Send(_)));
    }
    assert_eq!(code(fx.svc.resend(&fx.ada).unwrap_err()), "TOO_MANY_REQUESTS");
    // Past the cap, the public form says nothing and sends nothing.
    assert!(fx.svc.request_by_email("ada@example.com").unwrap().is_none());

    diesel::update(users::table.filter(users::id.eq(&fx.ada)))
        .set(users::email_verified_at.eq(Some(Utc::now().naive_utc())))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_eq!(fx.svc.resend(&fx.ada).unwrap(), Resend::AlreadyVerified);
}

#[test]
fn the_public_form_reveals_nothing_about_unknown_or_verified_addresses() {
    let fx = fx(VerificationMode::Enforce);
    assert!(fx.svc.request_by_email("nobody@example.com").unwrap().is_none());
    fx.svc.verify(&link(&fx)).unwrap();
    assert!(fx.svc.request_by_email("ada@example.com").unwrap().is_none());
    assert_eq!(code(fx.svc.request_by_email(" ").unwrap_err()), "BAD_REQUEST");
}

#[tokio::test]
async fn a_new_account_is_mailed_its_link() {
    let fx = fx(VerificationMode::Enforce);
    fx.svc.start_later(&fx.ada);
    let mut mail = Vec::new();
    for _ in 0..100 {
        mail = read_outbox(&fx.outbox);
        if !mail.is_empty() {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
    }
    assert_eq!(mail.len(), 1);
    assert_eq!(mail[0]["to"], "ada@example.com");
    assert_eq!(mail[0]["subject"], VERIFY_SUBJECT);
    let body = mail[0]["body"].as_str().unwrap();
    let token = body
        .split("/verify-email?token=")
        .nth(1)
        .and_then(|rest| rest.split_whitespace().next())
        .expect("a link in the email");
    assert!(body.contains(&format!("Verify within {GRACE_DAYS} days")), "{body}");
    fx.svc.verify(token).unwrap();
    assert!(verified(&fx));
}

// ── what is refused ───────────────────────────────────────────────────────────

#[test]
fn enforce_holds_back_sharing_until_verified_and_soft_never_does() {
    let fx = fx(VerificationMode::Enforce);
    let err = fx.svc.require_verified(&fx.ada, "share files").unwrap_err();
    assert_eq!((err.status, err.code.as_str()), (403, "EMAIL_NOT_VERIFIED"));
    assert_eq!(err.message, "Verify your email address to share files.");
    fx.svc.verify(&link(&fx)).unwrap();
    assert!(fx.svc.require_verified(&fx.ada, "share files").is_ok());

    let soft = super::tests::fx(VerificationMode::Soft);
    assert!(soft.svc.require_verified(&soft.ada, "share files").is_ok());
}

#[test]
fn sign_in_and_refresh_are_refused_after_the_grace_period() {
    let fx = fx(VerificationMode::Enforce);
    age(&fx, GRACE_DAYS - 1);
    let refresh = sign_in(&fx, VerificationMode::Enforce).expect("still in the grace period");
    let status = fx.svc.status(&fx.ada).unwrap();
    assert!(status.block_at.is_some_and(|at| at > Utc::now().naive_utc()));

    age(&fx, GRACE_DAYS);
    assert_eq!(code(sign_in(&fx, VerificationMode::Enforce).unwrap_err()), "EMAIL_NOT_VERIFIED");
    let err = auth(&fx.pool, fx.users.clone(), VerificationMode::Enforce)
        .refresh(RefreshRequest { refresh_token: refresh })
        .unwrap_err();
    assert_eq!(code(err), "EMAIL_NOT_VERIFIED");
    // Soft never blocks.
    assert!(sign_in(&fx, VerificationMode::Soft).is_ok());

    // A link still works for a blocked account, and lifts the block.
    fx.svc.verify(&link(&fx)).unwrap();
    assert!(sign_in(&fx, VerificationMode::Enforce).is_ok());
}

#[test]
fn enforce_sends_no_reset_link_to_an_unverified_address() {
    let fx = fx(VerificationMode::Enforce);
    let resets = |mode| {
        PasswordResetService::new(
            Arc::new(PasswordResetRepository::new(fx.pool.clone())),
            fx.users.clone(),
            Arc::new(auth(&fx.pool, fx.users.clone(), mode)),
            Arc::new(Mailer::Outbox(fx.outbox.clone())),
            "https://neutrino.test".into(),
        )
        .with_email_verification(mode)
    };
    assert!(resets(VerificationMode::Enforce).create("ada@example.com").unwrap().is_none());
    assert!(resets(VerificationMode::Soft).create("ada@example.com").unwrap().is_some());

    fx.svc.verify(&link(&fx)).unwrap();
    assert!(resets(VerificationMode::Enforce).create("ada@example.com").unwrap().is_some());
}

// ── the email ─────────────────────────────────────────────────────────────────

#[test]
fn the_email_links_to_the_verify_page_and_says_when_sign_in_stops() {
    let c = compose_verify("https://neutrino.test/", "Ada", "tok", Some(12));
    assert_eq!(c.subject, VERIFY_SUBJECT);
    assert!(c.text.contains("Hi Ada,"));
    assert!(c.text.contains("https://neutrino.test/verify-email?token=tok"));
    assert!(c.text.contains("Verify within 12 days to keep signing in."));
    assert!(c.html.contains("Verify email address"));

    let soft = compose_verify("https://neutrino.test", "", "tok", None);
    assert!(soft.text.starts_with("Hi,"));
    assert!(!soft.text.contains("keep signing in"));
    assert!(compose_verify("https://x", "A", "t", Some(0)).text.contains("won't be able to sign in"));
}
