//! The weekly email: when it is due, who gets it, what it says, and that a
//! week is never sent twice.

use std::path::PathBuf;
use std::sync::Arc;

use chrono::{Duration, NaiveDate, NaiveDateTime, Utc};
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::compose::{compose, human_bytes, Digest};
use super::model::TeamActivity;
use super::repository::WeeklyRepository;
use super::service::{period, Week, WeeklyEmailService};
use crate::schema::{file_activity_log, files, notifications, team_members, teams, user_profiles, users};
use crate::shared::mail::Mailer;
use crate::shared::DbPool;

// ── fixtures ──────────────────────────────────────────────────────────────────

fn at(y: i32, m: u32, d: u32, h: u32) -> NaiveDateTime {
    NaiveDate::from_ymd_opt(y, m, d).unwrap().and_hms_opt(h, 0, 0).unwrap()
}

/// Monday 2 November 2026, 10:00 UTC: the week of 26 Oct – 1 Nov is due.
fn monday() -> NaiveDateTime {
    at(2026, 11, 2, 10)
}

/// In the week the Monday above reports on.
fn last_week() -> NaiveDateTime {
    at(2026, 10, 28, 12)
}

struct Fx {
    pool: DbPool,
    svc: WeeklyEmailService,
    outbox: PathBuf,
}

fn fx() -> Fx {
    let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
    let pool = Pool::builder().max_size(1).build(manager).expect("pool");
    pool.get()
        .expect("conn")
        .run_pending_migrations(crate::MIGRATIONS)
        .expect("migrations");
    let outbox = std::env::temp_dir()
        .join(format!("neutrino-weekly-{}", uuid::Uuid::new_v4()))
        .join("outbox.jsonl");
    let svc = WeeklyEmailService::new(
        Arc::new(WeeklyRepository::new(pool.clone())),
        Arc::new(Mailer::Outbox(outbox.clone())),
        "https://neutrino.test/".into(),
    );
    Fx { pool, svc, outbox }
}

fn add_user(fx: &Fx, id: &str, name: &str) {
    diesel::insert_into(users::table)
        .values((
            users::id.eq(id),
            users::email.eq(format!("{id}@example.com")),
            users::name.eq(name),
            users::password_hash.eq("x"),
            users::role.eq("user"),
        ))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

fn email_prefs(fx: &Fx, id: &str, general: bool, updates: bool) {
    diesel::insert_into(user_profiles::table)
        .values((
            user_profiles::user_id.eq(id),
            user_profiles::email_marketing.eq(0),
            user_profiles::email_general.eq(general as i32),
            user_profiles::email_updates.eq(updates as i32),
            user_profiles::email_critical.eq(1),
            user_profiles::updated_at.eq(Utc::now().naive_utc()),
        ))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

fn notify(fx: &Fx, to: &str, event_type: &str, payload: serde_json::Value, when: NaiveDateTime) {
    diesel::insert_into(notifications::table)
        .values((
            notifications::id.eq(uuid::Uuid::new_v4().to_string()),
            notifications::recipient_id.eq(to),
            notifications::event_type.eq(event_type),
            notifications::payload.eq(payload.to_string()),
            notifications::is_read.eq(0),
            notifications::email_sent.eq(0),
            notifications::created_at.eq(when),
        ))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

fn publish(fx: &Fx, title: &str, when: NaiveDateTime) {
    let u = fx.svc.create_update("admin", title, "Body text.").unwrap();
    diesel::update(crate::schema::product_updates::table.find(&u.id))
        .set(crate::schema::product_updates::published_at.eq(Some(when)))
        .execute(&mut fx.pool.get().unwrap())
        .unwrap();
}

/// A team with `members`, one file, and `changes` changes to it by `by` last week.
fn team_with_changes(fx: &Fx, members: &[&str], by: &str, changes: usize) {
    let mut conn = fx.pool.get().unwrap();
    diesel::insert_into(teams::table)
        .values((
            teams::id.eq("t1"),
            teams::name.eq("Design"),
            teams::slug.eq("design"),
            teams::visibility.eq("private"),
            teams::created_by.eq(members[0]),
        ))
        .execute(&mut conn)
        .unwrap();
    for (i, m) in members.iter().enumerate() {
        diesel::insert_into(team_members::table)
            .values((
                team_members::id.eq(format!("m{i}")),
                team_members::team_id.eq("t1"),
                team_members::user_id.eq(*m),
                team_members::user_email.eq(format!("{m}@example.com")),
                team_members::user_name.eq(*m),
                team_members::role.eq("member"),
                team_members::added_by.eq(members[0]),
            ))
            .execute(&mut conn)
            .unwrap();
    }
    diesel::insert_into(files::table)
        .values((
            files::id.eq("f1"),
            files::user_id.eq(by),
            files::name.eq("encrypted"),
            files::size_bytes.eq(1i64),
            files::mime_type.eq("text/plain"),
            files::storage_path.eq("x"),
            files::team_id.eq(Some("t1")),
        ))
        .execute(&mut conn)
        .unwrap();
    for i in 0..changes {
        diesel::insert_into(file_activity_log::table)
            .values((
                file_activity_log::id.eq(format!("a{i}")),
                file_activity_log::file_id.eq("f1"),
                file_activity_log::user_id.eq(by),
                file_activity_log::user_name.eq(by),
                file_activity_log::action.eq("edited"),
                file_activity_log::created_at.eq(last_week()),
                file_activity_log::resource_type.eq("file"),
            ))
            .execute(&mut conn)
            .unwrap();
    }
}

fn outbox(fx: &Fx) -> Vec<serde_json::Value> {
    match std::fs::read_to_string(&fx.outbox) {
        Ok(s) => s.lines().map(|l| serde_json::from_str(l).unwrap()).collect(),
        Err(_) => Vec::new(),
    }
}

// ── when ──────────────────────────────────────────────────────────────────────

#[test]
fn the_week_is_due_from_monday_nine_and_covers_the_week_before() {
    assert_eq!(Week::due_at(at(2026, 11, 2, 8)), None);
    let w = Week::due_at(at(2026, 11, 2, 9)).unwrap();
    assert_eq!(w.label, "2026-W45");
    assert_eq!(w.from, at(2026, 10, 26, 0));
    assert_eq!(w.to, at(2026, 11, 2, 0));
    assert_eq!(period(w.from, w.to), "26 Oct – 1 Nov");
    // Later in the week it is still the same week, so a late start catches up.
    assert_eq!(Week::due_at(at(2026, 11, 8, 23)).unwrap().label, "2026-W45");
    // Across a year end the ISO year is the Monday's.
    assert_eq!(Week::due_at(at(2026, 12, 28, 10)).unwrap().label, "2026-W53");
}

// ── who and what ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn each_account_gets_its_own_week_once() {
    let fx = fx();
    add_user(&fx, "ada", "Ada");
    add_user(&fx, "bob", "Bob");
    add_user(&fx, "cy", "Cy");
    notify(&fx, "ada", "file_shared", serde_json::json!({ "resourceName": "Plan" }), last_week());
    notify(&fx, "ada", "mention", serde_json::json!({}), last_week());
    notify(&fx, "ada", "mention", serde_json::json!({}), last_week());
    // Outside the week: ignored.
    notify(&fx, "ada", "comment_reply", serde_json::json!({}), monday());
    notify(&fx, "bob", "access_requested", serde_json::json!({}), last_week());

    let emails = fx.svc.prepare_due(monday()).unwrap();
    let to: Vec<&str> = emails.iter().map(|(to, _)| to.as_str()).collect();
    assert_eq!(to, ["ada@example.com", "bob@example.com"], "Cy had nothing to tell");
    let ada = &emails[0].1;
    assert_eq!(ada.subject, "Your week in Neutrino: 26 Oct – 1 Nov");
    assert!(ada.text.contains("- “Plan” was shared with you."), "{}", ada.text);
    assert!(ada.text.contains("- You were mentioned 2 times."));
    assert!(!ada.text.contains("replies"));
    assert!(emails[1].1.text.contains("1 request for access to your files."));

    assert_eq!(fx.svc.send_all(emails).await, 2);
    assert_eq!(outbox(&fx).len(), 2);

    // Later checks the same week send nothing, even with something new to tell.
    notify(&fx, "cy", "mention", serde_json::json!({}), last_week());
    assert!(fx.svc.prepare_due(monday() + Duration::hours(1)).unwrap().is_empty());
}

#[test]
fn email_settings_choose_the_parts() {
    let fx = fx();
    add_user(&fx, "ada", "Ada");
    add_user(&fx, "bob", "Bob");
    add_user(&fx, "cy", "Cy");
    email_prefs(&fx, "ada", false, true);
    email_prefs(&fx, "bob", true, false);
    email_prefs(&fx, "cy", false, false);
    for u in ["ada", "bob", "cy"] {
        notify(&fx, u, "mention", serde_json::json!({}), last_week());
    }
    publish(&fx, "Faster search", last_week());
    // Published after the week ended: next week's.
    publish(&fx, "Dark mode", monday());

    let emails = fx.svc.prepare_due(monday()).unwrap();
    assert_eq!(emails.len(), 2, "Cy turned both off");
    let (ada, bob) = (&emails[0].1, &emails[1].1);
    assert_eq!(ada.subject, "What's new in Neutrino: Faster search");
    assert!(!ada.text.contains("mentioned"));
    assert!(ada.text.contains("WHAT'S NEW\n\nFaster search\nBody text."), "{}", ada.text);
    assert!(!ada.text.contains("Dark mode"));
    assert!(bob.text.contains("mentioned"));
    assert!(!bob.text.contains("Faster search"));
}

#[test]
fn team_activity_counts_other_peoples_changes_without_naming_files() {
    let fx = fx();
    add_user(&fx, "ada", "Ada");
    add_user(&fx, "bob", "Bob");
    team_with_changes(&fx, &["ada", "bob"], "bob", 3);

    let emails = fx.svc.prepare_due(monday()).unwrap();
    assert_eq!(emails.len(), 1, "Bob's own changes are not news to Bob");
    let (to, ada) = &emails[0];
    assert_eq!(to, "ada@example.com");
    assert!(ada.text.contains("- Design: 3 changes to 1 file by 1 person."), "{}", ada.text);
    assert!(!ada.text.contains("encrypted"));
}

#[test]
fn preview_covers_the_last_seven_days_and_claims_nothing() {
    let fx = fx();
    add_user(&fx, "ada", "Ada");
    let now = Utc::now().naive_utc();
    assert!(fx.svc.preview("ada", now).unwrap().is_none());
    notify(&fx, "ada", "action_item_assigned", serde_json::json!({}), now - Duration::days(1));
    let c = fx.svc.preview("ada", now).unwrap().unwrap();
    assert!(c.text.contains("1 action item assigned to you."));
    assert!(fx.svc.preview("ada", now).unwrap().is_some());
}

// ── product updates ───────────────────────────────────────────────────────────

#[test]
fn product_updates_are_drafts_until_published() {
    let fx = fx();
    assert_eq!(fx.svc.create_update("admin", " ", "x").unwrap_err().code, "BAD_REQUEST");
    assert_eq!(fx.svc.create_update("admin", "t", " ").unwrap_err().code, "BAD_REQUEST");
    let u = fx.svc.create_update("admin", " Title ", "Body").unwrap();
    assert_eq!(u.title, "Title");
    assert_eq!(u.published_at, None);

    let published = fx.svc.set_published(&u.id, true).unwrap();
    let at = published.published_at.expect("published");
    // Publishing again keeps the date; unpublishing clears it.
    assert_eq!(fx.svc.set_published(&u.id, true).unwrap().published_at, Some(at));
    assert_eq!(fx.svc.set_published(&u.id, false).unwrap().published_at, None);

    let edited = fx.svc.edit_update(&u.id, "New", "Text").unwrap();
    assert_eq!((edited.title.as_str(), edited.body.as_str()), ("New", "Text"));
    fx.svc.delete_update(&u.id).unwrap();
    assert_eq!(fx.svc.delete_update(&u.id).unwrap_err().code, "NOT_FOUND");
    assert!(fx.svc.list_updates().unwrap().is_empty());
}

// ── wording ───────────────────────────────────────────────────────────────────

#[test]
fn nothing_to_tell_is_no_email_and_storage_alone_is_nothing() {
    let d = Digest {
        storage: Some((5, Some(10))),
        ..Digest::default()
    };
    assert!(compose("https://x", &d).is_none());
}

#[test]
fn the_email_reads_well_and_escapes_names() {
    let d = Digest {
        name: "Ada".into(),
        period: "26 Oct – 1 Nov".into(),
        shared: vec!["<b>Plan</b>".into(), "Budget".into(), "Notes".into(), "Deck".into()],
        replies: 1,
        storage: Some((1_500_000_000, Some(10_000_000_000))),
        teams: vec![TeamActivity {
            team_id: "t".into(),
            team_name: "Design".into(),
            changes: 1,
            people: 2,
            files: 1,
        }],
        ..Digest::default()
    };
    let c = compose("https://neutrino.test/", &d).unwrap();
    assert!(c.text.starts_with("Hi Ada,\n\nHere's your week in Neutrino, 26 Oct – 1 Nov."));
    assert!(c.text.contains("“<b>Plan</b>”, “Budget” and 2 others were shared with you."));
    assert!(c.text.contains("1 reply to your comments."));
    assert!(c.text.contains("You're using 1.5 GB of 10.0 GB (15%)."), "{}", c.text);
    assert!(c.text.contains("Design: 1 change to 1 file by 2 people."));
    assert!(c.text.contains("Open Neutrino: https://neutrino.test/drive"));
    assert!(!c.html.contains("<b>Plan</b>"));
    assert!(c.html.contains("&lt;b&gt;Plan&lt;/b&gt;"));
}

#[test]
fn bytes_read_like_a_person_would_write_them() {
    assert_eq!(human_bytes(0), "0 bytes");
    assert_eq!(human_bytes(999), "999 bytes");
    assert_eq!(human_bytes(12_300), "12.3 KB");
    assert_eq!(human_bytes(340_000_000), "340 MB");
}
