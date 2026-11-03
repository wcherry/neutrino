//! When the weekly email goes out, what goes in it, and the administrator's
//! product updates.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::{Datelike, Duration, NaiveDateTime, NaiveTime, Utc};
use uuid::Uuid;

use super::compose::{compose, Digest};
use super::model::{NewProductUpdate, ProductUpdateRecord, Recipient};
use super::repository::WeeklyRepository;
use crate::auth::welcome::Content;
use crate::shared::mail::{Mailer, Message};
use crate::shared::ApiError;

/// The hour (UTC) on Monday from which the week's email goes out.
pub const SEND_HOUR_UTC: u32 = 9;
const MAX_TITLE: usize = 200;
const MAX_BODY: usize = 10_000;

/// The week an email covers.
#[derive(Debug, Clone, PartialEq)]
pub struct Week {
    /// ISO week of the Monday it goes out, e.g. `2026-W45`.
    pub label: String,
    /// The Monday seven days before `to`, 00:00 UTC.
    pub from: NaiveDateTime,
    /// The Monday it goes out, 00:00 UTC.
    pub to: NaiveDateTime,
}

impl Week {
    /// The week due at `now`, if this week's email may go out yet: from
    /// Monday [`SEND_HOUR_UTC`] onwards, so a server that was down on Monday
    /// catches up later in the week.
    pub fn due_at(now: NaiveDateTime) -> Option<Week> {
        let monday = now.date() - Duration::days(now.weekday().num_days_from_monday() as i64);
        let to = monday.and_time(NaiveTime::MIN);
        if now < to + Duration::hours(SEND_HOUR_UTC as i64) {
            return None;
        }
        let iso = monday.iso_week();
        Some(Week {
            label: format!("{}-W{:02}", iso.year(), iso.week()),
            from: to - Duration::days(7),
            to,
        })
    }
}

/// "26 Oct – 1 Nov": the days `[from, to)` covers.
pub fn period(from: NaiveDateTime, to: NaiveDateTime) -> String {
    let last = to - Duration::seconds(1);
    format!("{} – {}", from.format("%-d %b"), last.format("%-d %b"))
}

pub struct WeeklyEmailService {
    repo: Arc<WeeklyRepository>,
    mailer: Arc<Mailer>,
    base_url: String,
}

impl WeeklyEmailService {
    pub fn new(repo: Arc<WeeklyRepository>, mailer: Arc<Mailer>, base_url: String) -> Self {
        WeeklyEmailService {
            repo,
            mailer,
            base_url,
        }
    }

    /// Everything that goes into one account's email for `[from, to)`, as far
    /// as their email settings allow.
    pub fn digest(
        &self,
        r: &Recipient,
        from: NaiveDateTime,
        to: NaiveDateTime,
    ) -> Result<Digest, ApiError> {
        let mut d = Digest {
            name: r.name.clone(),
            period: period(from, to),
            ..Digest::default()
        };
        if r.general {
            d.add_notifications(&self.repo.notifications_between(&r.id, from, to)?);
            d.storage = self.repo.storage(&r.id)?;
            d.teams = self.repo.team_activity(&r.id, from, to)?;
        }
        if r.updates {
            d.updates = self.repo.published_between(from, to)?;
        }
        Ok(d)
    }

    /// Claim and compose this week's email for every account that has not
    /// been considered yet. Returns the emails to send; sends nothing.
    /// Blocking: call it off the async workers.
    pub fn prepare_due(&self, now: NaiveDateTime) -> Result<Vec<(String, Content)>, ApiError> {
        let Some(week) = Week::due_at(now) else {
            return Ok(Vec::new());
        };
        let done: HashSet<String> = self.repo.claimed(&week.label)?.into_iter().collect();
        let mut out = Vec::new();
        for r in self.repo.recipients()? {
            if done.contains(&r.id) || !self.repo.claim_week(&r.id, &week.label, now)? {
                continue;
            }
            let digest = match self.digest(&r, week.from, week.to) {
                Ok(d) => d,
                Err(e) => {
                    tracing::error!(user_id = %r.id, "weekly email skipped: {}", e);
                    continue;
                }
            };
            if let Some(content) = compose(&self.base_url, &digest) {
                out.push((r.email, content));
            }
        }
        Ok(out)
    }

    /// Send what [`Self::prepare_due`] composed. Failures are logged: the week
    /// is claimed either way, so a mail outage costs one week's email rather
    /// than repeating it.
    pub async fn send_all(&self, emails: Vec<(String, Content)>) -> usize {
        let mut sent = 0;
        for (to, content) in emails {
            let message = Message {
                to,
                subject: content.subject,
                body: content.text,
                html: Some(content.html),
                headers: Vec::new(),
            };
            match self.mailer.send(message).await {
                Ok(()) => sent += 1,
                Err(e) => tracing::warn!("weekly email not sent: {}", e),
            }
        }
        sent
    }

    /// The email the account would get for the seven days up to `now`, as
    /// their settings stand. `None` when there is nothing to tell.
    pub fn preview(&self, user_id: &str, now: NaiveDateTime) -> Result<Option<Content>, ApiError> {
        let r = self
            .repo
            .recipient(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        let digest = self.digest(&r, now - Duration::days(7), now)?;
        Ok(compose(&self.base_url, &digest))
    }

    // ── Product updates ──────────────────────────────────────────────────────

    pub fn list_updates(&self) -> Result<Vec<ProductUpdateRecord>, ApiError> {
        self.repo.list_updates()
    }

    fn validate(title: &str, body: &str) -> Result<(), ApiError> {
        if title.trim().is_empty() {
            return Err(ApiError::bad_request("A title is required"));
        }
        if title.chars().count() > MAX_TITLE {
            return Err(ApiError::bad_request(format!(
                "The title must be at most {MAX_TITLE} characters"
            )));
        }
        if body.trim().is_empty() {
            return Err(ApiError::bad_request("Say something in the update"));
        }
        if body.chars().count() > MAX_BODY {
            return Err(ApiError::bad_request(format!(
                "The update must be at most {MAX_BODY} characters"
            )));
        }
        Ok(())
    }

    fn get(&self, id: &str) -> Result<ProductUpdateRecord, ApiError> {
        self.repo
            .find_update(id)?
            .ok_or_else(|| ApiError::not_found("Product update not found"))
    }

    /// A new draft.
    pub fn create_update(
        &self,
        admin_id: &str,
        title: &str,
        body: &str,
    ) -> Result<ProductUpdateRecord, ApiError> {
        Self::validate(title, body)?;
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        self.repo.insert_update(&NewProductUpdate {
            id: id.clone(),
            title: title.trim().to_string(),
            body: body.trim().to_string(),
            created_by: admin_id.to_string(),
            created_at: now,
            updated_at: now,
        })?;
        self.get(&id)
    }

    pub fn edit_update(&self, id: &str, title: &str, body: &str) -> Result<ProductUpdateRecord, ApiError> {
        self.get(id)?;
        Self::validate(title, body)?;
        self.repo
            .edit_update(id, title.trim(), body.trim(), Utc::now().naive_utc())?;
        self.get(id)
    }

    /// Publish, so the next weekly email carries it, or take it back to a
    /// draft. Publishing an already-published update keeps its date.
    pub fn set_published(&self, id: &str, published: bool) -> Result<ProductUpdateRecord, ApiError> {
        let update = self.get(id)?;
        let at = match (published, update.published_at) {
            (true, Some(at)) => Some(at),
            (true, None) => Some(Utc::now().naive_utc()),
            (false, _) => None,
        };
        self.repo.set_published(id, at)?;
        self.get(id)
    }

    pub fn delete_update(&self, id: &str) -> Result<(), ApiError> {
        if self.repo.delete_update(id)? == 0 {
            return Err(ApiError::not_found("Product update not found"));
        }
        Ok(())
    }
}
