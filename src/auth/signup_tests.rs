//! The sign-up gate (closed sign-up, invite tokens, releasing a claim when the
//! registration itself fails) and the welcome email that follows a new
//! account, plus the welcome email's copy.
//!
//! The auth service, the invite service and the outbox share one in-memory
//! database with a single connection.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{Duration, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::SignupService;
use crate::auth::dto::{LoginRequest, RegisterRequest, RegisterResponse};
use crate::auth::invites::repository::InviteRepository;
use crate::auth::invites::service::InviteService;
use crate::auth::password_policy::PasswordPolicyRepository;
use crate::auth::repository::AuthRepository;
use crate::auth::service::AuthService;
use crate::auth::tokens::TokenService;
use crate::auth::welcome::{self, WelcomeMailer};
use crate::schema::{invites, users};
use crate::shared::mail::Mailer;
use crate::shared::ApiError;

// ── fixtures ──────────────────────────────────────────────────────────────────

struct Fx {
    pool: crate::shared::DbPool,
    auth: Arc<AuthService>,
    invites: Arc<InviteService>,
    signup: SignupService,
    outbox: PathBuf,
}

fn fx(public_signup_open: bool) -> Fx {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(crate::MIGRATIONS)
        .expect("migrations");

    let token_service = Arc::new(TokenService::new_with_expiry(
        "test-secret-key".to_string(),
        900,
        604800,
    ));
    let auth = Arc::new(AuthService::new(
        Arc::new(AuthRepository::new(pool.clone())),
        token_service,
        Arc::new(PasswordPolicyRepository::new(pool.clone())),
    ));

    let outbox = std::env::temp_dir()
        .join(format!("neutrino-signup-{}", uuid::Uuid::new_v4()))
        .join("outbox.jsonl");
    let mailer = Arc::new(Mailer::Outbox(outbox.clone()));
    let invites = Arc::new(InviteService::new(
        Arc::new(InviteRepository::new(pool.clone())),
        "test-secret".into(),
        mailer.clone(),
        "https://neutrino.test".into(),
    ));
    let welcome = Arc::new(WelcomeMailer::new(mailer, "https://neutrino.test".into()));
    let signup = SignupService::new(auth.clone(), invites.clone(), welcome, public_signup_open);

    Fx {
        pool,
        auth,
        invites,
        signup,
        outbox,
    }
}

fn req(email: &str, password: &str, name: &str, invite_token: Option<&str>) -> RegisterRequest {
    RegisterRequest {
        email: email.to_string(),
        password: password.to_string(),
        name: name.to_string(),
        invite_token: invite_token.map(str::to_string),
    }
}

fn ok_req(email: &str, invite_token: Option<&str>) -> RegisterRequest {
    req(email, "password123", "New Person", invite_token)
}

/// An inviter created directly through the auth service — an existing user,
/// who must never be sent a welcome email.
fn inviter(fx: &Fx) -> RegisterResponse {
    fx.auth
        .register(req("ada@example.com", "password123", "Ada", None))
        .unwrap()
}

fn emailed_token(fx: &Fx, inviter_id: &str, to: &str) -> (String, String) {
    let mut out = fx
        .invites
        .create_email_invites(inviter_id, &[to.to_string()], None)
        .unwrap();
    let (row, token) = out.remove(0);
    (row.id, token)
}

fn err<T>(r: Result<T, ApiError>) -> ApiError {
    match r {
        Ok(_) => panic!("expected an error, got Ok"),
        Err(e) => e,
    }
}

fn assert_api_err<T>(r: Result<T, ApiError>, status: u16, code: &str) {
    let e = err(r);
    assert_eq!(
        (e.status, e.code.as_str()),
        (status, code),
        "unexpected error: {e}"
    );
}

fn user_count(fx: &Fx, email: &str) -> i64 {
    users::table
        .filter(users::email.eq(email))
        .count()
        .get_result(&mut fx.pool.get().unwrap())
        .unwrap()
}

fn accepted_user_of(fx: &Fx, invite_id: &str) -> Option<String> {
    invites::table
        .filter(invites::id.eq(invite_id))
        .select(invites::accepted_user_id)
        .first::<Option<String>>(&mut fx.pool.get().unwrap())
        .unwrap()
}

fn messages_to(path: &PathBuf, to: &str) -> Vec<serde_json::Value> {
    match std::fs::read_to_string(path) {
        Ok(s) => s
            .lines()
            .filter(|l| !l.trim().is_empty())
            .map(|l| serde_json::from_str::<serde_json::Value>(l).expect("outbox line is JSON"))
            .filter(|m| m["to"].as_str() == Some(to))
            .collect(),
        Err(_) => Vec::new(),
    }
}

/// Waits up to ~2s for at least `n` messages to `to` (the welcome email goes out
/// on a spawned task), then a little longer so a duplicate has time to land.
async fn wait_for_messages(path: &PathBuf, to: &str, n: usize) -> Vec<serde_json::Value> {
    for _ in 0..40 {
        if messages_to(path, to).len() >= n {
            break;
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    messages_to(path, to)
}

/// Gives any stray spawned send time to land before asserting there was none.
async fn settle() {
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;
}

// ── closed sign-up ───────────────────────────────────────────────────────────

#[tokio::test]
async fn closed_signup_without_a_token_is_403_signup_closed() {
    let fx = fx(false);
    assert!(!fx.signup.public_signup_open());

    assert_api_err(
        fx.signup.register(ok_req("new@example.com", None)).await,
        403,
        "SIGNUP_CLOSED",
    );
    assert_eq!(user_count(&fx, "new@example.com"), 0);
}

#[tokio::test]
async fn closed_signup_with_an_emailed_invite_creates_the_account() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (invite_id, token) = emailed_token(&fx, &ada.id, "new@example.com");

    let resp = fx
        .signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();

    assert_eq!(resp.email, "new@example.com");
    assert_eq!(user_count(&fx, "new@example.com"), 1);
    assert_eq!(
        accepted_user_of(&fx, &invite_id).as_deref(),
        Some(resp.id.as_str())
    );
    // Spent: the same link cannot be used again.
    assert_api_err(fx.invites.validate(&token), 410, "INVITE_USED");
}

#[tokio::test]
async fn an_emailed_invite_lists_as_accepted_after_sign_up() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (invite_id, token) = emailed_token(&fx, &ada.id, "new@example.com");
    fx.signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();

    let mine = fx.invites.list_mine(&ada.id).unwrap();
    let row = mine.iter().find(|r| r.id == invite_id).unwrap();
    assert_eq!(
        row.status(Utc::now().naive_utc()),
        crate::auth::invites::service::InviteStatus::Accepted
    );
}

#[tokio::test]
async fn the_sign_up_address_need_not_match_the_invited_one() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (_, token) = emailed_token(&fx, &ada.id, "work@example.com");

    assert!(fx
        .signup
        .register(ok_req("home@example.com", Some(&token)))
        .await
        .is_ok());
}

#[tokio::test]
async fn closed_signup_with_a_personal_link_creates_accounts() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let link = fx.invites.personal_link(&ada.id).unwrap();

    assert!(fx
        .signup
        .register(ok_req("first@example.com", Some(&link.token)))
        .await
        .is_ok());
    // A personal link is reusable.
    assert!(fx
        .signup
        .register(ok_req("second@example.com", Some(&link.token)))
        .await
        .is_ok());
    assert_eq!(fx.invites.personal_link(&ada.id).unwrap().use_count, 2);
}

#[tokio::test]
async fn closed_signup_with_a_used_invite_is_410_and_creates_no_user() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (_, token) = emailed_token(&fx, &ada.id, "new@example.com");
    fx.signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();

    assert_api_err(
        fx.signup
            .register(ok_req("other@example.com", Some(&token)))
            .await,
        410,
        "INVITE_USED",
    );
    assert_eq!(user_count(&fx, "other@example.com"), 0);
}

#[tokio::test]
async fn closed_signup_with_an_expired_invite_is_410_and_creates_no_user() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (invite_id, token) = emailed_token(&fx, &ada.id, "new@example.com");
    diesel::update(invites::table.filter(invites::id.eq(&invite_id)))
        .set(invites::expires_at.eq(Utc::now().naive_utc() - Duration::minutes(1)))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();

    assert_api_err(
        fx.signup
            .register(ok_req("new@example.com", Some(&token)))
            .await,
        410,
        "INVITE_EXPIRED",
    );
    assert_eq!(user_count(&fx, "new@example.com"), 0);
}

#[tokio::test]
async fn closed_signup_with_a_revoked_invite_is_410_and_creates_no_user() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (invite_id, token) = emailed_token(&fx, &ada.id, "new@example.com");
    fx.invites.revoke(&ada.id, &invite_id).unwrap();

    assert_api_err(
        fx.signup
            .register(ok_req("new@example.com", Some(&token)))
            .await,
        410,
        "INVITE_REVOKED",
    );
    assert_eq!(user_count(&fx, "new@example.com"), 0);
}

#[tokio::test]
async fn closed_signup_with_a_reset_personal_link_is_410_revoked() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let old = fx.invites.personal_link(&ada.id).unwrap();
    fx.invites.reset_personal_link(&ada.id).unwrap();

    assert_api_err(
        fx.signup
            .register(ok_req("new@example.com", Some(&old.token)))
            .await,
        410,
        "INVITE_REVOKED",
    );
}

#[tokio::test]
async fn closed_signup_with_an_unknown_token_is_404_and_creates_no_user() {
    let fx = fx(false);
    inviter(&fx);

    assert_api_err(
        fx.signup
            .register(ok_req("new@example.com", Some("garbage")))
            .await,
        404,
        "INVITE_NOT_FOUND",
    );
    assert_eq!(user_count(&fx, "new@example.com"), 0);
}

// ── open sign-up ─────────────────────────────────────────────────────────────

#[tokio::test]
async fn open_signup_without_a_token_creates_the_account() {
    let fx = fx(true);
    assert!(fx.signup.public_signup_open());

    let resp = fx
        .signup
        .register(ok_req("new@example.com", None))
        .await
        .unwrap();

    assert_eq!(resp.email, "new@example.com");
    assert_eq!(user_count(&fx, "new@example.com"), 1);
}

#[tokio::test]
async fn open_signup_ignores_a_bad_token() {
    let fx = fx(true);
    assert!(fx
        .signup
        .register(ok_req("new@example.com", Some("garbage")))
        .await
        .is_ok());
    assert_eq!(user_count(&fx, "new@example.com"), 1);
}

#[tokio::test]
async fn open_signup_ignores_a_used_token() {
    let fx = fx(true);
    let ada = inviter(&fx);
    let (_, token) = emailed_token(&fx, &ada.id, "new@example.com");
    fx.signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();

    assert!(fx
        .signup
        .register(ok_req("other@example.com", Some(&token)))
        .await
        .is_ok());
}

#[tokio::test]
async fn open_signup_marks_a_good_token_accepted() {
    let fx = fx(true);
    let ada = inviter(&fx);
    let (invite_id, token) = emailed_token(&fx, &ada.id, "new@example.com");

    let resp = fx
        .signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();

    assert_eq!(
        accepted_user_of(&fx, &invite_id).as_deref(),
        Some(resp.id.as_str())
    );
    assert_api_err(fx.invites.validate(&token), 410, "INVITE_USED");
}

// ── the other checks still hold, and a failure gives the invite back ─────────

#[tokio::test]
async fn closed_signup_with_a_valid_token_still_enforces_the_password_policy() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (invite_id, token) = emailed_token(&fx, &ada.id, "new@example.com");

    let e = err(fx
        .signup
        .register(req("new@example.com", "short", "New Person", Some(&token)))
        .await);

    assert_eq!(e.status, 400, "{e}");
    assert_eq!(user_count(&fx, "new@example.com"), 0);
    // Released: a typo does not burn the invite.
    assert!(fx.invites.validate(&token).is_ok());
    assert_eq!(accepted_user_of(&fx, &invite_id), None);
    assert!(fx
        .signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .is_ok());
}

#[tokio::test]
async fn closed_signup_with_a_valid_token_still_refuses_an_empty_name() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (_, token) = emailed_token(&fx, &ada.id, "new@example.com");

    let e = err(fx
        .signup
        .register(req("new@example.com", "password123", "", Some(&token)))
        .await);

    assert_eq!(e.status, 400, "{e}");
    assert!(fx.invites.validate(&token).is_ok());
}

#[tokio::test]
async fn a_duplicate_address_is_409_and_releases_the_invite() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (_, token) = emailed_token(&fx, &ada.id, "new@example.com");

    let e = err(fx
        .signup
        .register(ok_req("ada@example.com", Some(&token)))
        .await);

    assert_eq!(e.status, 409, "{e}");
    assert!(fx.invites.validate(&token).is_ok());
}

#[tokio::test]
async fn a_failed_sign_up_through_a_personal_link_gives_the_use_back() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let link = fx.invites.personal_link(&ada.id).unwrap();

    let e = err(fx
        .signup
        .register(req(
            "new@example.com",
            "short",
            "New Person",
            Some(&link.token),
        ))
        .await);

    assert_eq!(e.status, 400);
    assert_eq!(fx.invites.personal_link(&ada.id).unwrap().use_count, 0);
}

// ── the welcome email ────────────────────────────────────────────────────────

#[tokio::test]
async fn a_new_account_gets_exactly_one_welcome_email() {
    let fx = fx(true);
    fx.signup
        .register(ok_req("new@example.com", None))
        .await
        .unwrap();

    let msgs = wait_for_messages(&fx.outbox, "new@example.com", 1).await;

    assert_eq!(msgs.len(), 1, "{msgs:?}");
    assert_eq!(msgs[0]["subject"], "Welcome to Neutrino");
}

#[tokio::test]
async fn an_invited_account_gets_exactly_one_welcome_email() {
    let fx = fx(false);
    let ada = inviter(&fx);
    let (_, token) = emailed_token(&fx, &ada.id, "new@example.com");
    fx.signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();

    let msgs = wait_for_messages(&fx.outbox, "new@example.com", 1).await;

    assert_eq!(msgs.len(), 1, "{msgs:?}");
    assert_eq!(msgs[0]["subject"], "Welcome to Neutrino");
}

#[tokio::test]
async fn logging_in_after_sign_up_sends_no_further_mail() {
    let fx = fx(true);
    fx.signup
        .register(ok_req("new@example.com", None))
        .await
        .unwrap();
    assert_eq!(
        wait_for_messages(&fx.outbox, "new@example.com", 1)
            .await
            .len(),
        1
    );

    fx.auth
        .login(
            LoginRequest {
                email: "new@example.com".into(),
                password: "password123".into(),
                totp_code: None,
            },
            None,
            None,
            None,
        )
        .unwrap();
    settle().await;

    assert_eq!(messages_to(&fx.outbox, "new@example.com").len(), 1);
}

#[tokio::test]
async fn a_failed_registration_sends_no_welcome_email() {
    let fx = fx(true);
    err(fx
        .signup
        .register(req("new@example.com", "short", "New Person", None))
        .await);
    // A successful one alongside, so the spawned sends have demonstrably run.
    fx.signup
        .register(ok_req("other@example.com", None))
        .await
        .unwrap();
    wait_for_messages(&fx.outbox, "other@example.com", 1).await;

    assert!(messages_to(&fx.outbox, "new@example.com").is_empty());
}

#[tokio::test]
async fn a_closed_signup_refusal_sends_no_welcome_email() {
    let fx = fx(false);
    err(fx.signup.register(ok_req("new@example.com", None)).await);
    settle().await;

    assert!(messages_to(&fx.outbox, "new@example.com").is_empty());
}

#[tokio::test]
async fn an_admin_created_account_gets_exactly_one_welcome_email() {
    let fx = fx(true);
    let created = fx
        .auth
        .register(req(
            "made@example.com",
            "password123",
            "Made By Admin",
            None,
        ))
        .unwrap();

    fx.signup.account_created(&created);
    let msgs = wait_for_messages(&fx.outbox, "made@example.com", 1).await;

    assert_eq!(msgs.len(), 1, "{msgs:?}");
    assert_eq!(msgs[0]["subject"], "Welcome to Neutrino");
}

#[tokio::test]
async fn an_existing_user_never_gets_a_welcome_email() {
    let fx = fx(true);
    let ada = inviter(&fx);

    // Everything that might plausibly mail her: signing in, inviting someone,
    // that person signing up, and someone else signing up through her link.
    fx.auth
        .login(
            LoginRequest {
                email: "ada@example.com".into(),
                password: "password123".into(),
                totp_code: None,
            },
            None,
            None,
            None,
        )
        .unwrap();
    let (_, token) = emailed_token(&fx, &ada.id, "new@example.com");
    fx.signup
        .register(ok_req("new@example.com", Some(&token)))
        .await
        .unwrap();
    let link = fx.invites.personal_link(&ada.id).unwrap();
    fx.signup
        .register(ok_req("third@example.com", Some(&link.token)))
        .await
        .unwrap();
    wait_for_messages(&fx.outbox, "new@example.com", 1).await;
    wait_for_messages(&fx.outbox, "third@example.com", 1).await;
    settle().await;

    let to_ada = messages_to(&fx.outbox, "ada@example.com");
    assert!(
        to_ada.iter().all(|m| m["subject"] != "Welcome to Neutrino"),
        "{to_ada:?}"
    );
}

// ── welcome::compose ─────────────────────────────────────────────────────────

const LINKS: [&str; 7] = [
    "https://neutrino.test/settings?tab=appearance",
    "https://neutrino.test/profile",
    "https://neutrino.test/settings?tab=ai",
    "https://neutrino.test/calendar",
    "https://neutrino.test/drive",
    "https://neutrino.test/import",
    "https://neutrino.test/invite",
];

#[test]
fn welcome_subject_is_welcome_to_neutrino() {
    let c = welcome::compose("https://neutrino.test/", "Ada");
    assert_eq!(c.subject, "Welcome to Neutrino");
}

#[test]
fn welcome_text_carries_every_setup_link() {
    let c = welcome::compose("https://neutrino.test/", "Ada");
    for link in LINKS {
        assert!(c.text.contains(link), "text is missing {link}:\n{}", c.text);
    }
}

#[test]
fn welcome_html_carries_every_setup_link() {
    let c = welcome::compose("https://neutrino.test/", "Ada");
    for link in LINKS {
        assert!(c.html.contains(link), "html is missing {link}:\n{}", c.html);
    }
}

#[test]
fn welcome_links_have_no_double_slash_from_a_trailing_slash_base() {
    let c = welcome::compose("https://neutrino.test/", "Ada");
    assert!(!c.text.contains("neutrino.test//"), "{}", c.text);
    assert!(!c.html.contains("neutrino.test//"), "{}", c.html);
}

#[test]
fn welcome_greets_the_new_user_by_name() {
    let c = welcome::compose("https://neutrino.test/", "Ada");
    assert!(c.text.contains("Ada"), "{}", c.text);
    assert!(c.html.contains("Ada"), "{}", c.html);
}

#[test]
fn welcome_never_says_optional() {
    let c = welcome::compose("https://neutrino.test/", "Ada");
    assert!(!c.text.to_lowercase().contains("optional"), "{}", c.text);
    assert!(!c.html.to_lowercase().contains("optional"), "{}", c.html);
    assert!(!c.subject.to_lowercase().contains("optional"));
}

#[test]
fn welcome_html_escapes_the_name() {
    let c = welcome::compose("https://neutrino.test/", "<Ada & Co>");
    assert!(!c.html.contains("<Ada & Co>"), "{}", c.html);
    assert!(c.html.contains("&lt;Ada &amp; Co&gt;"), "{}", c.html);
}
