//! Password reset: who is sent a link, the checks a link goes through, what a
//! reset changes about the account, and the two emails.
//!
//! Every test gets its own in-memory database with a single connection, so
//! nothing here may hold a connection across a call into the service.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{Duration, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;
use totp_rs::{Algorithm, Secret, TOTP};

use super::email::{compose_changed, compose_reset, CHANGED_SUBJECT, RESET_SUBJECT};
use super::repository::PasswordResetRepository;
use super::service::*;
use crate::auth::dto::{LoginRequest, RegisterRequest};
use crate::auth::password_policy::PasswordPolicyRepository;
use crate::auth::repository::AuthRepository;
use crate::auth::service::AuthService;
use crate::auth::tokens::TokenService;
use crate::schema::password_resets;
use crate::shared::mail::Mailer;
use crate::shared::ApiError;

// ── fixtures ──────────────────────────────────────────────────────────────────

const OLD: &str = "old-password-1";
const NEW: &str = "new-password-2";

struct Fx {
    pool: crate::shared::DbPool,
    users: Arc<AuthRepository>,
    auth: Arc<AuthService>,
    svc: PasswordResetService,
    outbox: PathBuf,
}

/// Ada exists, with password [`OLD`].
fn fx() -> Fx {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(crate::MIGRATIONS)
        .expect("migrations");

    let users = Arc::new(AuthRepository::new(pool.clone()));
    let auth = Arc::new(AuthService::new(
        users.clone(),
        Arc::new(TokenService::new_with_expiry("test-secret".into(), 900, 604800)),
        Arc::new(PasswordPolicyRepository::new(pool.clone())),
    ));
    auth.register(RegisterRequest {
        email: "ada@example.com".into(),
        password: OLD.into(),
        name: "Ada Lovelace".into(),
        invite_token: None,
    })
    .expect("register");

    let outbox = std::env::temp_dir()
        .join(format!("neutrino-resets-{}", uuid::Uuid::new_v4()))
        .join("outbox.jsonl");
    let svc = PasswordResetService::new(
        Arc::new(PasswordResetRepository::new(pool.clone())),
        users.clone(),
        auth.clone(),
        Arc::new(Mailer::Outbox(outbox.clone())),
        "https://neutrino.test/".into(),
    );
    Fx {
        pool,
        users,
        auth,
        svc,
        outbox,
    }
}

fn ada_id(fx: &Fx) -> String {
    fx.users
        .find_user_by_email("ada@example.com")
        .unwrap()
        .unwrap()
        .id
}

/// A fresh link for Ada; its plaintext token.
fn link(fx: &Fx) -> String {
    fx.svc
        .create("ada@example.com")
        .unwrap()
        .expect("a link for Ada")
        .token
}

fn sign_in(fx: &Fx, password: &str) -> Result<(), ApiError> {
    fx.auth
        .login(
            LoginRequest {
                email: "ada@example.com".into(),
                password: password.into(),
                totp_code: None,
            },
            None,
            None,
            None,
        )
        .map(|_| ())
}

fn code(err: ApiError) -> String {
    err.code.to_string()
}

fn rows(fx: &Fx) -> i64 {
    password_resets::table
        .count()
        .get_result(&mut fx.pool.get().unwrap())
        .unwrap()
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

/// The current code for a base32 secret, as an authenticator would show it.
fn totp_now(secret: &str) -> String {
    let bytes = Secret::Encoded(secret.to_string()).to_bytes().unwrap();
    TOTP::new(Algorithm::SHA1, 6, 1, 30, bytes, None, "user".into())
        .unwrap()
        .generate_current()
        .unwrap()
}

// ── asking for a link ─────────────────────────────────────────────────────────

#[test]
fn an_unknown_address_gets_nothing_and_stores_nothing() {
    let fx = fx();
    assert!(fx.svc.create("nobody@example.com").unwrap().is_none());
    assert_eq!(rows(&fx), 0);
}

#[test]
fn an_empty_address_is_refused() {
    let fx = fx();
    assert_eq!(fx.svc.create("  ").unwrap_err().status, 400);
}

#[test]
fn the_token_is_stored_only_as_its_hash() {
    let fx = fx();
    let token = link(&fx);
    let stored: String = password_resets::table
        .select(password_resets::token_hash)
        .first(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_ne!(stored, token);
    assert_eq!(stored, hash_reset_token(&token));
}

#[test]
fn surrounding_spaces_in_the_address_are_ignored() {
    let fx = fx();
    assert!(fx.svc.create("  ada@example.com ").unwrap().is_some());
}

#[test]
fn a_new_link_replaces_the_one_before() {
    let fx = fx();
    let first = link(&fx);
    let second = link(&fx);
    assert_eq!(code(fx.svc.check(&first).unwrap_err()), "RESET_REVOKED");
    assert!(fx.svc.check(&second).is_ok());
}

#[test]
fn an_account_is_sent_at_most_the_hourly_cap() {
    let fx = fx();
    for _ in 0..MAX_RESETS_PER_HOUR {
        link(&fx);
    }
    assert!(fx.svc.create("ada@example.com").unwrap().is_none());
    assert_eq!(rows(&fx), MAX_RESETS_PER_HOUR);
}

#[test]
fn a_disabled_account_is_sent_nothing() {
    let fx = fx();
    fx.users.set_user_disabled(&ada_id(&fx), true).unwrap();
    assert!(fx.svc.create("ada@example.com").unwrap().is_none());
}

// ── checking a link ───────────────────────────────────────────────────────────

#[test]
fn a_live_link_names_its_account() {
    let fx = fx();
    let check = fx.svc.check(&link(&fx)).unwrap();
    assert_eq!(
        check,
        ResetCheck {
            email: "ada@example.com".into(),
            requires_two_factor: false
        }
    );
}

#[test]
fn an_unknown_token_is_not_found() {
    let fx = fx();
    assert_eq!(code(fx.svc.check("nope").unwrap_err()), "RESET_NOT_FOUND");
    assert_eq!(code(fx.svc.check("").unwrap_err()), "RESET_NOT_FOUND");
}

#[test]
fn an_expired_link_is_refused() {
    let fx = fx();
    let token = link(&fx);
    diesel::update(password_resets::table)
        .set(password_resets::expires_at.eq(Utc::now().naive_utc() - Duration::seconds(1)))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_eq!(code(fx.svc.check(&token).unwrap_err()), "RESET_EXPIRED");
    assert_eq!(
        code(fx.svc.reset(&token, NEW, None).unwrap_err()),
        "RESET_EXPIRED"
    );
}

#[test]
fn a_link_for_an_account_disabled_since_is_refused() {
    let fx = fx();
    let token = link(&fx);
    fx.users.set_user_disabled(&ada_id(&fx), true).unwrap();
    assert_eq!(code(fx.svc.reset(&token, NEW, None).unwrap_err()), "ACCOUNT_DISABLED");
}

#[test]
fn a_link_for_an_account_deleted_since_is_not_found() {
    let fx = fx();
    let token = link(&fx);
    fx.users.soft_delete_user(&ada_id(&fx)).unwrap();
    assert_eq!(code(fx.svc.check(&token).unwrap_err()), "RESET_NOT_FOUND");
}

// ── resetting ─────────────────────────────────────────────────────────────────

#[test]
fn the_new_password_works_and_the_old_one_does_not() {
    let fx = fx();
    fx.svc.reset(&link(&fx), NEW, None).unwrap();
    assert!(sign_in(&fx, NEW).is_ok());
    assert_eq!(sign_in(&fx, OLD).unwrap_err().status, 401);
}

#[test]
fn a_link_works_once() {
    let fx = fx();
    let token = link(&fx);
    fx.svc.reset(&token, NEW, None).unwrap();
    assert_eq!(
        code(fx.svc.reset(&token, "third-password-3", None).unwrap_err()),
        "RESET_USED"
    );
}

#[test]
fn a_reset_signs_every_device_out() {
    let fx = fx();
    sign_in(&fx, OLD).unwrap();
    sign_in(&fx, OLD).unwrap();
    let id = ada_id(&fx);
    assert_eq!(fx.auth.list_sessions(&id).unwrap().sessions.len(), 2);

    fx.svc.reset(&link(&fx), NEW, None).unwrap();
    assert!(fx.auth.list_sessions(&id).unwrap().sessions.is_empty());
}

#[test]
fn a_reset_ends_a_lockout() {
    let fx = fx();
    fx.users.lock_out_user(&ada_id(&fx)).unwrap();
    assert_eq!(code(sign_in(&fx, OLD).unwrap_err()), "ACCOUNT_LOCKED");

    fx.svc.reset(&link(&fx), NEW, None).unwrap();
    assert!(sign_in(&fx, NEW).is_ok());
}

#[test]
fn a_reset_clears_a_forced_expiry() {
    let fx = fx();
    fx.users.set_password_expired(&ada_id(&fx), true).unwrap();
    fx.svc.reset(&link(&fx), NEW, None).unwrap();
    assert!(sign_in(&fx, NEW).is_ok());
}

#[test]
fn a_refused_password_leaves_the_link_working() {
    let fx = fx();
    let token = link(&fx);
    assert_eq!(fx.svc.reset(&token, "short", None).unwrap_err().status, 400);
    fx.svc.reset(&token, NEW, None).unwrap();
}

#[test]
fn the_current_password_cannot_be_chosen_again() {
    let fx = fx();
    let token = link(&fx);
    assert_eq!(fx.svc.reset(&token, OLD, None).unwrap_err().status, 400);
    assert!(fx.svc.check(&token).is_ok());
}

#[test]
fn two_factor_is_asked_for_when_the_account_has_it() {
    let fx = fx();
    let secret = crate::auth::totp::generate_secret();
    fx.users
        .update_user_totp(&ada_id(&fx), Some(&secret), true)
        .unwrap();
    let token = link(&fx);

    assert!(fx.svc.check(&token).unwrap().requires_two_factor);
    assert_eq!(fx.svc.reset(&token, NEW, None).unwrap_err().status, 401);
    assert_eq!(
        fx.svc.reset(&token, NEW, Some("000000")).unwrap_err().status,
        401
    );
    fx.svc.reset(&token, NEW, Some(&totp_now(&secret))).unwrap();
}

// ── mail ──────────────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_mailed_link_resets_the_password_and_the_owner_is_told() {
    let fx = fx();
    let pending = fx.svc.create("ada@example.com").unwrap().unwrap();
    fx.svc.send(pending).await;

    let sent = read_outbox(&fx.outbox);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0]["to"], "ada@example.com");
    assert_eq!(sent[0]["subject"], RESET_SUBJECT);
    let body = sent[0]["body"].as_str().unwrap();
    let marker = "https://neutrino.test/reset-password?token=";
    let start = body.find(marker).expect("reset link in body") + marker.len();
    let token: String = body[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();

    let user = fx.svc.reset(&token, NEW, None).unwrap();
    fx.svc.send_changed_notice(&user).await;
    let sent = read_outbox(&fx.outbox);
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[1]["to"], "ada@example.com");
    assert_eq!(sent[1]["subject"], CHANGED_SUBJECT);
}

#[test]
fn the_reset_mail_carries_the_link_and_its_expiry() {
    let mail = compose_reset("https://n.test/", "Ada <b>", "tok_en-1");
    let link = "https://n.test/reset-password?token=tok_en-1";
    assert!(mail.text.contains(link));
    assert!(mail.html.contains(link));
    assert!(mail.text.contains(&format!("{RESET_TTL_MINUTES} minutes")));
    assert!(mail.text.starts_with("Hi Ada <b>,"));
    assert!(mail.html.contains("Hi Ada &lt;b&gt;,"));
}

#[test]
fn the_changed_notice_links_to_sign_in() {
    let mail = compose_changed("https://n.test", "");
    assert!(mail.text.starts_with("Hi,"));
    assert!(mail.text.contains("https://n.test/sign-in"));
}
