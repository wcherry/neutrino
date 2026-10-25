//! Invites: the token at rest, the status a row reports, the checks a token
//! goes through before it can be spent, the personal link's reuse and reset,
//! the daily cap on emailed invites, and the invitation mail itself.
//!
//! Every test gets its own in-memory database with a single connection, so
//! nothing here may hold a connection across a call into the service.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{Duration, NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::model::*;
use super::repository::*;
use super::service::*;
use crate::schema::{invites, users};
use crate::shared::mail::Mailer;
use crate::shared::ApiError;

// ── fixtures ──────────────────────────────────────────────────────────────────

fn pool() -> crate::shared::DbPool {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(crate::MIGRATIONS)
        .expect("migrations");
    pool
}

/// A user whose address is `<id>@example.com`.
fn add_user(pool: &crate::shared::DbPool, id: &str, name: &str) {
    diesel::insert_into(users::table)
        .values((
            users::id.eq(id),
            users::email.eq(format!("{id}@example.com")),
            users::name.eq(name),
            users::password_hash.eq("x"),
            users::role.eq("user"),
        ))
        .execute(&mut pool.get().unwrap())
        .unwrap();
}

fn outbox_path() -> PathBuf {
    std::env::temp_dir()
        .join(format!("neutrino-invites-{}", uuid::Uuid::new_v4()))
        .join("outbox.jsonl")
}

struct Fx {
    pool: crate::shared::DbPool,
    svc: InviteService,
    outbox: PathBuf,
}

/// Ada, Bob and Carol exist; Ada is the usual inviter.
fn fx() -> Fx {
    let pool = pool();
    add_user(&pool, "ada", "Ada Lovelace");
    add_user(&pool, "bob", "Bob");
    add_user(&pool, "carol", "Carol");
    let outbox = outbox_path();
    let svc = InviteService::new(
        Arc::new(InviteRepository::new(pool.clone())),
        "test-secret".into(),
        Arc::new(Mailer::Outbox(outbox.clone())),
        "https://neutrino.test".into(),
    );
    Fx { pool, svc, outbox }
}

fn now() -> NaiveDateTime {
    Utc::now().naive_utc()
}

/// The error of a result whose success type need not be `Debug`.
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

fn emails(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

/// One emailed invite from `inviter` to `to`; returns the row and its token.
fn invite_one(fx: &Fx, inviter: &str, to: &str) -> (InviteRecord, String) {
    let mut out = fx
        .svc
        .create_email_invites(inviter, &emails(&[to]), None)
        .unwrap();
    assert_eq!(out.len(), 1);
    out.remove(0)
}

fn set_expires_at(fx: &Fx, id: &str, at: NaiveDateTime) {
    diesel::update(invites::table.filter(invites::id.eq(id)))
        .set(invites::expires_at.eq(at))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

fn set_created_at(fx: &Fx, id: &str, at: NaiveDateTime) {
    diesel::update(invites::table.filter(invites::id.eq(id)))
        .set(invites::created_at.eq(at))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

fn accepted_user_of(fx: &Fx, id: &str) -> Option<String> {
    invites::table
        .filter(invites::id.eq(id))
        .select(invites::accepted_user_id)
        .first::<Option<String>>(&mut fx.pool.get().unwrap())
        .unwrap()
}

fn record(kind: &str) -> InviteRecord {
    let created = now();
    InviteRecord {
        id: "i1".into(),
        inviter_id: "ada".into(),
        kind: kind.into(),
        token_hash: hash_invite_token("t"),
        invitee_email: if kind == "email" {
            Some("bob@example.com".into())
        } else {
            None
        },
        note: None,
        created_at: created,
        expires_at: created + Duration::days(INVITE_TTL_DAYS),
        accepted_at: None,
        accepted_user_id: None,
        revoked_at: None,
        use_count: 0,
    }
}

// ── hash_invite_token ────────────────────────────────────────────────────────

#[test]
fn hash_invite_token_is_deterministic() {
    assert_eq!(hash_invite_token("abc-123"), hash_invite_token("abc-123"));
}

#[test]
fn hash_invite_token_is_64_lowercase_hex_chars() {
    let h = hash_invite_token("some-token");
    assert_eq!(h.len(), 64);
    assert!(
        h.chars()
            .all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c)),
        "not lower-case hex: {h}"
    );
}

#[test]
fn hash_invite_token_is_sha256() {
    // The FIPS 180-2 test vector, so the hash is SHA-256 and not some 64-bit
    // hasher padded out to look like it.
    assert_eq!(
        hash_invite_token("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

#[test]
fn hash_invite_token_differs_from_the_token() {
    let token = "plaintext-token";
    assert_ne!(hash_invite_token(token), token);
}

#[test]
fn hash_invite_token_differs_for_different_tokens() {
    assert_ne!(hash_invite_token("token-a"), hash_invite_token("token-b"));
}

// ── InviteRecord::status ─────────────────────────────────────────────────────

#[test]
fn status_of_a_fresh_invite_is_pending() {
    assert_eq!(record("email").status(now()), InviteStatus::Pending);
}

#[test]
fn status_is_expired_once_expires_at_has_passed() {
    let mut r = record("email");
    r.expires_at = now() - Duration::seconds(1);
    assert_eq!(r.status(now()), InviteStatus::Expired);
}

#[test]
fn status_is_expired_exactly_at_expires_at() {
    let r = record("email");
    assert_eq!(r.status(r.expires_at), InviteStatus::Expired);
}

#[test]
fn status_accepted_beats_expired_for_an_emailed_invite() {
    let mut r = record("email");
    r.accepted_at = Some(now() - Duration::days(1));
    r.expires_at = now() - Duration::seconds(1);
    assert_eq!(r.status(now()), InviteStatus::Accepted);
}

#[test]
fn status_revoked_beats_accepted_and_expired() {
    let mut r = record("email");
    r.accepted_at = Some(now() - Duration::days(1));
    r.expires_at = now() - Duration::seconds(1);
    r.revoked_at = Some(now());
    assert_eq!(r.status(now()), InviteStatus::Revoked);
}

#[test]
fn status_of_a_used_personal_link_stays_pending() {
    // A link is reusable: having been used does not make it "accepted".
    let mut r = record("link");
    r.accepted_at = Some(now());
    r.use_count = 3;
    assert_eq!(r.status(now()), InviteStatus::Pending);
}

#[test]
fn invite_status_serializes_lowercase() {
    assert_eq!(
        serde_json::to_value(InviteStatus::Pending).unwrap(),
        "pending"
    );
    assert_eq!(
        serde_json::to_value(InviteStatus::Accepted).unwrap(),
        "accepted"
    );
    assert_eq!(
        serde_json::to_value(InviteStatus::Expired).unwrap(),
        "expired"
    );
    assert_eq!(
        serde_json::to_value(InviteStatus::Revoked).unwrap(),
        "revoked"
    );
}

// ── validate ─────────────────────────────────────────────────────────────────

#[test]
fn validate_unknown_token_is_404_invite_not_found() {
    let fx = fx();
    invite_one(&fx, "ada", "bob@example.com");
    assert_api_err(fx.svc.validate("no-such-token"), 404, "INVITE_NOT_FOUND");
}

#[test]
fn validate_valid_email_invite_returns_the_inviter_name_and_record() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");

    let v = fx.svc.validate(&token).unwrap();

    assert_eq!(v.inviter_name, "Ada Lovelace");
    assert_eq!(v.record.id, row.id);
    assert_eq!(v.record.kind, "email");
    assert_eq!(v.record.invitee_email.as_deref(), Some("bob@example.com"));
}

#[test]
fn validate_expired_invite_is_410_invite_expired() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    set_expires_at(&fx, &row.id, now() - Duration::minutes(1));

    assert_api_err(fx.svc.validate(&token), 410, "INVITE_EXPIRED");
}

#[test]
fn validate_claimed_email_invite_is_410_invite_used() {
    let fx = fx();
    let (_, token) = invite_one(&fx, "ada", "bob@example.com");
    fx.svc.claim(&token).unwrap();

    assert_api_err(fx.svc.validate(&token), 410, "INVITE_USED");
}

#[test]
fn validate_revoked_invite_is_410_invite_revoked() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    fx.svc.revoke("ada", &row.id).unwrap();

    assert_api_err(fx.svc.validate(&token), 410, "INVITE_REVOKED");
}

#[test]
fn validate_reports_revoked_before_expired() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    fx.svc.revoke("ada", &row.id).unwrap();
    set_expires_at(&fx, &row.id, now() - Duration::minutes(1));

    assert_api_err(fx.svc.validate(&token), 410, "INVITE_REVOKED");
}

#[test]
fn validate_reports_used_before_expired() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    fx.svc.claim(&token).unwrap();
    set_expires_at(&fx, &row.id, now() - Duration::minutes(1));

    assert_api_err(fx.svc.validate(&token), 410, "INVITE_USED");
}

// ── tokens at rest ───────────────────────────────────────────────────────────

#[test]
fn the_database_stores_only_the_hash_of_each_token() {
    let fx = fx();
    let created = fx
        .svc
        .create_email_invites(
            "ada",
            &emails(&["bob@example.com", "dan@example.com"]),
            None,
        )
        .unwrap();
    let link = fx.svc.personal_link("ada").unwrap();

    let mut tokens: Vec<(String, String)> = created
        .iter()
        .map(|(r, t)| (r.id.clone(), t.clone()))
        .collect();
    tokens.push((link.id.clone(), link.token.clone()));

    let stored: Vec<(String, String)> = invites::table
        .select((invites::id, invites::token_hash))
        .load(&mut fx.pool.get().unwrap())
        .unwrap();
    assert_eq!(stored.len(), 3);

    for (id, token) in &tokens {
        assert!(
            stored.iter().all(|(_, h)| h != token),
            "a plaintext token is in the table"
        );
        let (_, hash) = stored
            .iter()
            .find(|(sid, _)| sid == id)
            .expect("row stored");
        assert_eq!(hash, &hash_invite_token(token));
    }
}

#[test]
fn emailed_invite_tokens_are_distinct() {
    let fx = fx();
    let created = fx
        .svc
        .create_email_invites(
            "ada",
            &emails(&["bob@example.com", "dan@example.com"]),
            None,
        )
        .unwrap();
    assert_ne!(created[0].1, created[1].1);
}

#[test]
fn an_emailed_invite_expires_fourteen_days_after_creation() {
    let fx = fx();
    let (row, _) = invite_one(&fx, "ada", "bob@example.com");
    assert_eq!(
        row.expires_at - row.created_at,
        Duration::days(INVITE_TTL_DAYS)
    );
    assert_eq!(INVITE_TTL_DAYS, 14);
}

// ── claim / release / confirm ────────────────────────────────────────────────

#[test]
fn claim_returns_the_invite_id_and_kind() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");

    let claim = fx.svc.claim(&token).unwrap();

    assert_eq!(claim.invite_id, row.id);
    assert_eq!(claim.kind, "email");
}

#[test]
fn claiming_an_emailed_invite_twice_is_410_invite_used() {
    let fx = fx();
    let (_, token) = invite_one(&fx, "ada", "bob@example.com");
    fx.svc.claim(&token).unwrap();

    assert_api_err(fx.svc.claim(&token), 410, "INVITE_USED");
}

#[test]
fn a_released_claim_can_be_claimed_again() {
    let fx = fx();
    let (_, token) = invite_one(&fx, "ada", "bob@example.com");
    let claim = fx.svc.claim(&token).unwrap();

    fx.svc.release(&claim).unwrap();

    assert!(
        fx.svc.validate(&token).is_ok(),
        "released invite should validate"
    );
    assert!(
        fx.svc.claim(&token).is_ok(),
        "released invite should be claimable"
    );
}

#[test]
fn confirm_records_who_signed_up() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    let claim = fx.svc.claim(&token).unwrap();

    fx.svc.confirm(&claim, "carol").unwrap();

    assert_eq!(accepted_user_of(&fx, &row.id).as_deref(), Some("carol"));
}

#[test]
fn a_confirmed_email_invite_lists_as_accepted() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    let claim = fx.svc.claim(&token).unwrap();
    fx.svc.confirm(&claim, "carol").unwrap();

    let mine = fx.svc.list_mine("ada").unwrap();
    let listed = mine.iter().find(|r| r.id == row.id).unwrap();
    assert_eq!(listed.status(now()), InviteStatus::Accepted);
    assert!(listed.accepted_at.is_some());
}

#[test]
fn claiming_an_unknown_token_is_404() {
    let fx = fx();
    assert_api_err(fx.svc.claim("nope"), 404, "INVITE_NOT_FOUND");
}

#[test]
fn claiming_an_expired_invite_is_410_invite_expired() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "bob@example.com");
    set_expires_at(&fx, &row.id, now() - Duration::minutes(1));
    assert_api_err(fx.svc.claim(&token), 410, "INVITE_EXPIRED");
}

// ── personal link ────────────────────────────────────────────────────────────

#[test]
fn personal_link_returns_the_same_token_while_it_lives() {
    let fx = fx();
    let first = fx.svc.personal_link("ada").unwrap();
    let second = fx.svc.personal_link("ada").unwrap();

    assert_eq!(first.id, second.id);
    assert_eq!(first.token, second.token);
    assert!(!first.token.is_empty());
}

#[test]
fn personal_link_expires_fourteen_days_out() {
    let fx = fx();
    let link = fx.svc.personal_link("ada").unwrap();
    let left = link.expires_at - now();
    assert!(
        left > Duration::days(13) && left <= Duration::days(14),
        "{left:?}"
    );
}

#[test]
fn personal_links_differ_between_users() {
    let fx = fx();
    let ada = fx.svc.personal_link("ada").unwrap();
    let bob = fx.svc.personal_link("bob").unwrap();
    assert_ne!(ada.token, bob.token);
}

#[test]
fn personal_link_validates_as_a_link_from_its_owner() {
    let fx = fx();
    let link = fx.svc.personal_link("ada").unwrap();

    let v = fx.svc.validate(&link.token).unwrap();

    assert_eq!(v.record.kind, "link");
    assert_eq!(v.inviter_name, "Ada Lovelace");
    assert_eq!(v.record.invitee_email, None);
}

#[test]
fn personal_link_can_be_claimed_by_several_people() {
    let fx = fx();
    let link = fx.svc.personal_link("ada").unwrap();
    assert_eq!(link.use_count, 0);

    let a = fx.svc.claim(&link.token).unwrap();
    let b = fx.svc.claim(&link.token).unwrap();
    assert_eq!(a.kind, "link");
    assert_eq!(b.invite_id, link.id);

    assert!(fx.svc.validate(&link.token).is_ok());
    assert_eq!(fx.svc.personal_link("ada").unwrap().use_count, 2);
}

#[test]
fn releasing_a_link_claim_gives_the_use_back() {
    let fx = fx();
    let link = fx.svc.personal_link("ada").unwrap();
    fx.svc.claim(&link.token).unwrap();
    let second = fx.svc.claim(&link.token).unwrap();

    fx.svc.release(&second).unwrap();

    assert_eq!(fx.svc.personal_link("ada").unwrap().use_count, 1);
}

#[test]
fn reset_personal_link_mints_a_new_token() {
    let fx = fx();
    let old = fx.svc.personal_link("ada").unwrap();

    let new = fx.svc.reset_personal_link("ada").unwrap();

    assert_ne!(new.token, old.token);
    assert_ne!(new.id, old.id);
    assert!(fx.svc.validate(&new.token).is_ok());
    // And the new one is what personal_link hands out from now on.
    assert_eq!(fx.svc.personal_link("ada").unwrap().token, new.token);
}

#[test]
fn reset_personal_link_revokes_the_old_token() {
    let fx = fx();
    let old = fx.svc.personal_link("ada").unwrap();
    fx.svc.reset_personal_link("ada").unwrap();

    assert_api_err(fx.svc.validate(&old.token), 410, "INVITE_REVOKED");
}

#[test]
fn an_expired_personal_link_is_replaced_on_the_next_request() {
    let fx = fx();
    let old = fx.svc.personal_link("ada").unwrap();
    set_expires_at(&fx, &old.id, now() - Duration::minutes(1));

    let new = fx.svc.personal_link("ada").unwrap();

    assert_ne!(new.id, old.id);
    assert_ne!(new.token, old.token);
    assert!(new.expires_at > now());
    assert!(fx.svc.validate(&new.token).is_ok());
    assert_api_err(fx.svc.validate(&old.token), 410, "INVITE_EXPIRED");
}

// ── create_email_invites: addresses and note ─────────────────────────────────

#[test]
fn create_email_invites_trims_lowercases_and_dedupes() {
    let fx = fx();
    let created = fx
        .svc
        .create_email_invites(
            "ada",
            &emails(&["  Bob@Example.COM ", "bob@example.com", "Dan@example.com"]),
            None,
        )
        .unwrap();

    let mut addrs: Vec<String> = created
        .iter()
        .map(|(r, _)| r.invitee_email.clone().unwrap())
        .collect();
    addrs.sort();
    assert_eq!(addrs, vec!["bob@example.com", "dan@example.com"]);
    assert!(created
        .iter()
        .all(|(r, _)| r.kind == "email" && r.inviter_id == "ada"));
}

#[test]
fn create_email_invites_stores_the_note() {
    let fx = fx();
    let created = fx
        .svc
        .create_email_invites("ada", &emails(&["bob@example.com"]), Some("Come along"))
        .unwrap();
    assert_eq!(created[0].0.note.as_deref(), Some("Come along"));
}

#[test]
fn create_email_invites_refuses_a_malformed_address() {
    let fx = fx();
    for bad in ["not-an-email", "a@", "@b.com", "a b@c.com", ""] {
        assert_api_err(
            fx.svc.create_email_invites("ada", &emails(&[bad]), None),
            400,
            "INVALID_EMAIL",
        );
    }
}

#[test]
fn create_email_invites_with_one_bad_address_stores_nothing() {
    let fx = fx();
    assert_api_err(
        fx.svc
            .create_email_invites("ada", &emails(&["bob@example.com", "nope"]), None),
        400,
        "INVALID_EMAIL",
    );
    assert!(fx.svc.list_mine("ada").unwrap().is_empty());
}

#[test]
fn create_email_invites_refuses_an_empty_list() {
    let fx = fx();
    assert_api_err(
        fx.svc.create_email_invites("ada", &[], None),
        400,
        "INVALID_EMAIL",
    );
}

#[test]
fn create_email_invites_refuses_your_own_address_in_any_case() {
    let fx = fx();
    assert_api_err(
        fx.svc
            .create_email_invites("ada", &emails(&[" ADA@Example.com "]), None),
        400,
        "INVALID_EMAIL",
    );
}

#[test]
fn create_email_invites_refuses_more_than_twenty_addresses_in_one_request() {
    let fx = fx();
    let many: Vec<String> = (0..=MAX_ADDRESSES_PER_REQUEST)
        .map(|i| format!("friend{i}@example.com"))
        .collect();
    assert_eq!(many.len(), 21);
    assert_api_err(
        fx.svc.create_email_invites("ada", &many, None),
        400,
        "INVALID_EMAIL",
    );
}

#[test]
fn create_email_invites_accepts_a_500_char_note() {
    let fx = fx();
    let note = "x".repeat(MAX_NOTE_CHARS);
    assert!(fx
        .svc
        .create_email_invites("ada", &emails(&["bob@example.com"]), Some(&note))
        .is_ok());
}

#[test]
fn create_email_invites_refuses_a_501_char_note() {
    let fx = fx();
    let note = "x".repeat(MAX_NOTE_CHARS + 1);
    assert_api_err(
        fx.svc
            .create_email_invites("ada", &emails(&["bob@example.com"]), Some(&note)),
        400,
        "NOTE_TOO_LONG",
    );
}

#[test]
fn the_note_limit_counts_characters_not_bytes() {
    let fx = fx();
    // 500 two-byte characters: 1000 bytes, still 500 characters.
    let note = "é".repeat(MAX_NOTE_CHARS);
    assert!(fx
        .svc
        .create_email_invites("ada", &emails(&["bob@example.com"]), Some(&note))
        .is_ok());
}

#[test]
fn reinviting_a_pending_address_revokes_the_old_invite() {
    let fx = fx();
    let (old_row, old_token) = invite_one(&fx, "ada", "bob@example.com");
    let (new_row, new_token) = invite_one(&fx, "ada", "BOB@example.com");

    assert_ne!(old_row.id, new_row.id);
    assert_api_err(fx.svc.validate(&old_token), 410, "INVITE_REVOKED");
    assert!(fx.svc.validate(&new_token).is_ok());

    let mine = fx.svc.list_mine("ada").unwrap();
    let old = mine.iter().find(|r| r.id == old_row.id).unwrap();
    assert_eq!(old.status(now()), InviteStatus::Revoked);
}

#[test]
fn reinviting_does_not_touch_another_inviters_pending_invite() {
    let fx = fx();
    let (_, bobs_token) = invite_one(&fx, "bob", "dan@example.com");
    invite_one(&fx, "ada", "dan@example.com");

    assert!(fx.svc.validate(&bobs_token).is_ok());
}

// ── create_email_invites: the daily cap ──────────────────────────────────────

fn batch(prefix: &str, n: usize) -> Vec<String> {
    (0..n).map(|i| format!("{prefix}{i}@example.com")).collect()
}

#[test]
fn twenty_invites_in_one_batch_succeed() {
    let fx = fx();
    let created = fx
        .svc
        .create_email_invites("ada", &batch("a", 20), None)
        .unwrap();
    assert_eq!(created.len(), 20);
    assert_eq!(MAX_EMAIL_INVITES_PER_DAY, 20);
}

#[test]
fn the_twenty_first_invite_in_a_day_is_429() {
    let fx = fx();
    fx.svc
        .create_email_invites("ada", &batch("a", 20), None)
        .unwrap();

    assert_api_err(
        fx.svc.create_email_invites("ada", &batch("late", 1), None),
        429,
        "INVITE_LIMIT_EXCEEDED",
    );
}

#[test]
fn the_cap_counts_across_several_batches() {
    let fx = fx();
    for i in 0..4 {
        fx.svc
            .create_email_invites("ada", &batch(&format!("b{i}-"), 5), None)
            .unwrap();
    }
    assert_api_err(
        fx.svc.create_email_invites("ada", &batch("late", 1), None),
        429,
        "INVITE_LIMIT_EXCEEDED",
    );
}

#[test]
fn a_batch_that_would_cross_the_cap_is_refused_whole() {
    let fx = fx();
    fx.svc
        .create_email_invites("ada", &batch("a", 15), None)
        .unwrap();

    assert_api_err(
        fx.svc.create_email_invites("ada", &batch("b", 6), None),
        429,
        "INVITE_LIMIT_EXCEEDED",
    );
    // Nothing from the refused batch was stored, so five more still fit.
    assert_eq!(fx.svc.list_mine("ada").unwrap().len(), 15);
    assert_eq!(
        fx.svc
            .create_email_invites("ada", &batch("c", 5), None)
            .unwrap()
            .len(),
        5
    );
}

#[test]
fn invites_older_than_a_day_do_not_count_toward_the_cap() {
    let fx = fx();
    let old = fx
        .svc
        .create_email_invites("ada", &batch("old", 20), None)
        .unwrap();
    for (row, _) in &old {
        set_created_at(&fx, &row.id, now() - Duration::hours(25));
    }

    let fresh = fx
        .svc
        .create_email_invites("ada", &batch("new", 20), None)
        .unwrap();
    assert_eq!(fresh.len(), 20);
}

#[test]
fn revoked_invites_still_count_toward_the_cap() {
    let fx = fx();
    let created = fx
        .svc
        .create_email_invites("ada", &batch("a", 20), None)
        .unwrap();
    for (row, _) in &created {
        fx.svc.revoke("ada", &row.id).unwrap();
    }
    assert_api_err(
        fx.svc.create_email_invites("ada", &batch("late", 1), None),
        429,
        "INVITE_LIMIT_EXCEEDED",
    );
}

#[test]
fn the_personal_link_does_not_count_toward_the_cap() {
    let fx = fx();
    fx.svc.personal_link("ada").unwrap();
    fx.svc.reset_personal_link("ada").unwrap();
    assert_eq!(
        fx.svc
            .create_email_invites("ada", &batch("a", 20), None)
            .unwrap()
            .len(),
        20
    );
}

#[test]
fn one_users_cap_does_not_affect_another() {
    let fx = fx();
    fx.svc
        .create_email_invites("ada", &batch("a", 20), None)
        .unwrap();

    assert_eq!(
        fx.svc
            .create_email_invites("bob", &batch("b", 20), None)
            .unwrap()
            .len(),
        20
    );
}

// ── revoke ───────────────────────────────────────────────────────────────────

#[test]
fn revoking_someone_elses_invite_is_404() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "dan@example.com");

    assert_api_err(fx.svc.revoke("bob", &row.id), 404, "INVITE_NOT_FOUND");
    assert!(fx.svc.validate(&token).is_ok(), "the invite must survive");
}

#[test]
fn revoking_an_unknown_invite_is_404() {
    let fx = fx();
    assert_api_err(fx.svc.revoke("ada", "no-such-id"), 404, "INVITE_NOT_FOUND");
}

#[test]
fn revoking_an_accepted_invite_is_409_invite_used() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "dan@example.com");
    let claim = fx.svc.claim(&token).unwrap();
    fx.svc.confirm(&claim, "carol").unwrap();

    assert_api_err(fx.svc.revoke("ada", &row.id), 409, "INVITE_USED");
}

#[test]
fn a_revoked_invite_no_longer_validates() {
    let fx = fx();
    let (row, token) = invite_one(&fx, "ada", "dan@example.com");

    fx.svc.revoke("ada", &row.id).unwrap();

    assert_api_err(fx.svc.validate(&token), 410, "INVITE_REVOKED");
    assert_api_err(fx.svc.claim(&token), 410, "INVITE_REVOKED");
}

#[test]
fn revoking_twice_is_idempotent() {
    let fx = fx();
    let (row, _) = invite_one(&fx, "ada", "dan@example.com");
    fx.svc.revoke("ada", &row.id).unwrap();
    assert!(fx.svc.revoke("ada", &row.id).is_ok());
}

// ── list_mine ────────────────────────────────────────────────────────────────

#[test]
fn list_mine_holds_only_my_emailed_invites_newest_first() {
    let fx = fx();
    fx.svc.personal_link("ada").unwrap();
    let (older, _) = invite_one(&fx, "ada", "dan@example.com");
    let (newer, _) = invite_one(&fx, "ada", "eve@example.com");
    invite_one(&fx, "bob", "frank@example.com");
    // Spread the two apart so the order does not hang on clock resolution.
    set_created_at(&fx, &older.id, now() - Duration::hours(2));
    set_created_at(&fx, &newer.id, now() - Duration::hours(1));

    let mine = fx.svc.list_mine("ada").unwrap();

    let ids: Vec<&str> = mine.iter().map(|r| r.id.as_str()).collect();
    assert_eq!(ids, vec![newer.id.as_str(), older.id.as_str()]);
    assert!(mine
        .iter()
        .all(|r| r.kind == "email" && r.inviter_id == "ada"));
}

#[test]
fn list_mine_is_empty_for_someone_who_has_sent_none() {
    let fx = fx();
    invite_one(&fx, "ada", "dan@example.com");
    assert!(fx.svc.list_mine("carol").unwrap().is_empty());
}

// ── send_email_invites ───────────────────────────────────────────────────────

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

/// The token after `register?invite=` in a mail body.
fn token_in(body: &str) -> String {
    let marker = "/register?invite=";
    let start = body.find(marker).expect("invite link in body") + marker.len();
    body[start..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect()
}

#[tokio::test]
async fn send_email_invites_mails_each_address_once() {
    let fx = fx();
    let sent = fx
        .svc
        .send_email_invites(
            "ada",
            &emails(&["dan@example.com", "Eve@Example.com"]),
            Some("Come and see"),
        )
        .await
        .unwrap();
    assert_eq!(sent.len(), 2);

    let msgs = read_outbox(&fx.outbox);
    assert_eq!(msgs.len(), 2, "{msgs:?}");
    let mut to: Vec<&str> = msgs.iter().map(|m| m["to"].as_str().unwrap()).collect();
    to.sort();
    assert_eq!(to, vec!["dan@example.com", "eve@example.com"]);
}

#[tokio::test]
async fn the_invitation_mail_carries_the_link_and_the_note() {
    let fx = fx();
    fx.svc
        .send_email_invites("ada", &emails(&["dan@example.com"]), Some("Come and see"))
        .await
        .unwrap();

    let msgs = read_outbox(&fx.outbox);
    let body = msgs[0]["body"].as_str().unwrap();
    assert!(
        body.contains("https://neutrino.test/register?invite="),
        "body: {body}"
    );
    assert!(body.contains("Come and see"), "body: {body}");
    assert!(body.contains("Ada Lovelace"), "body: {body}");
    let html = msgs[0]["html"].as_str().expect("html part");
    assert!(html.contains("https://neutrino.test/register?invite="));
}

#[tokio::test]
async fn the_token_in_the_mail_validates_for_that_address() {
    let fx = fx();
    let sent = fx
        .svc
        .send_email_invites("ada", &emails(&["dan@example.com"]), None)
        .await
        .unwrap();

    let msgs = read_outbox(&fx.outbox);
    let token = token_in(msgs[0]["body"].as_str().unwrap());
    assert!(!token.is_empty());

    let v = fx.svc.validate(&token).unwrap();
    assert_eq!(v.record.id, sent[0].id);
    assert_eq!(v.record.invitee_email.as_deref(), Some("dan@example.com"));
}

#[tokio::test]
async fn send_email_invites_sends_nothing_when_validation_fails() {
    let fx = fx();
    assert_api_err(
        fx.svc
            .send_email_invites("ada", &emails(&["dan@example.com", "broken"]), None)
            .await,
        400,
        "INVALID_EMAIL",
    );
    assert!(read_outbox(&fx.outbox).is_empty());
}

// ── the invitation mail template ─────────────────────────────────────────────

#[test]
fn invite_email_compose_carries_the_link_and_inviter() {
    let c = super::email::compose("https://neutrino.test", "Ada", None, "tok123");
    let link = "https://neutrino.test/register?invite=tok123";
    assert!(c.text.contains(link), "text: {}", c.text);
    assert!(c.html.contains(link), "html: {}", c.html);
    assert!(c.text.contains("Ada"));
    assert!(c.html.contains("Ada"));
    assert!(c.subject.contains("Ada"), "subject: {}", c.subject);
}

#[test]
fn invite_email_compose_includes_the_note_escaped_in_html() {
    let c = super::email::compose(
        "https://neutrino.test",
        "Ada",
        Some("Come <join> & see"),
        "tok123",
    );
    assert!(c.text.contains("Come <join> & see"), "text: {}", c.text);
    assert!(!c.html.contains("<join>"), "note not escaped: {}", c.html);
    assert!(
        c.html.contains("Come &lt;join&gt; &amp; see"),
        "html: {}",
        c.html
    );
}

#[test]
fn invite_email_compose_escapes_the_inviter_name_in_html() {
    let c = super::email::compose("https://neutrino.test", "<Ada & Co>", None, "tok123");
    assert!(!c.html.contains("<Ada & Co>"));
    assert!(c.html.contains("&lt;Ada &amp; Co&gt;"));
}

#[test]
fn invite_email_compose_says_it_expires_in_14_days() {
    let c = super::email::compose("https://neutrino.test", "Ada", None, "tok123");
    assert!(c.text.contains("14 days"), "text: {}", c.text);
    assert!(c.html.contains("14 days"), "html: {}", c.html);
}
