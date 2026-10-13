#![allow(dead_code)]

use crate::drive::notifications::{
    dto::{NotificationListResponse, NotificationResponse},
    hub::NotificationHub,
    model::NewNotification,
    repository::NotificationsRepository,
};
use crate::drive::notifications::email;
use crate::shared::mail::{Mailer, Message};
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct NotificationService {
    repo: Arc<NotificationsRepository>,
    mailer: Arc<Mailer>,
    /// The public origin links in email point at (`DRIVE_URL`).
    base_url: String,
    hub: Arc<NotificationHub>,
}

impl NotificationService {
    pub fn new(
        repo: Arc<NotificationsRepository>,
        mailer: Arc<Mailer>,
        base_url: String,
        hub: Arc<NotificationHub>,
    ) -> Self {
        NotificationService {
            repo,
            mailer,
            base_url,
            hub,
        }
    }

    pub async fn notify(
        &self,
        recipient_ids: Vec<String>,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), ApiError> {
        let payload_str = payload.to_string();
        let now = chrono::Local::now().naive_local();
        let mut stored: Vec<(String, String)> = Vec::new();

        for recipient_id in &recipient_ids {
            let id = Uuid::new_v4().to_string();
            let new_notif = NewNotification {
                id: id.clone(),
                recipient_id: recipient_id.clone(),
                event_type: event_type.to_string(),
                payload: payload_str.clone(),
                is_read: 0,
                email_sent: 0,
                created_at: now,
            };
            match self.repo.insert_notification(&new_notif) {
                Err(e) => {
                    tracing::error!(
                        "Failed to insert notification for {}: {:?}",
                        recipient_id,
                        e
                    );
                }
                Ok(()) => {
                    stored.push((id.clone(), recipient_id.clone()));
                    let resp = NotificationResponse {
                        id: id.clone(),
                        recipient_id: recipient_id.clone(),
                        event_type: event_type.to_string(),
                        payload: payload.clone(),
                        is_read: false,
                        created_at: now.to_string(),
                    };
                    if let Ok(json) = serde_json::to_string(&resp) {
                        self.hub.push(recipient_id, json);
                    }
                }
            }
        }

        // Email goes out after the request has its answer: a slow or failing
        // mail provider must not hold up sharing a file or posting a comment,
        // and a failure is logged rather than surfaced — the in-app
        // notification is already stored and delivered.
        if !stored.is_empty() {
            let repo = self.repo.clone();
            let mailer = self.mailer.clone();
            let base_url = self.base_url.clone();
            let event_type = event_type.to_string();
            tokio::spawn(async move {
                for (notification_id, recipient_id) in stored {
                    send_email(
                        &repo,
                        &mailer,
                        &base_url,
                        &notification_id,
                        &recipient_id,
                        &event_type,
                        &payload,
                    )
                    .await;
                }
            });
        }

        Ok(())
    }

    pub fn get_notifications(
        &self,
        user: &AuthenticatedUser,
        page: Option<i64>,
        page_size: Option<i64>,
    ) -> Result<NotificationListResponse, ApiError> {
        let page = page.unwrap_or(1).max(1);
        let page_size = page_size.unwrap_or(20).min(100).max(1);

        let (items, total, unread_count) =
            self.repo
                .list_notifications(&user.user_id, page, page_size)?;

        Ok(NotificationListResponse {
            notifications: items.into_iter().map(NotificationResponse::from).collect(),
            unread_count,
            total,
        })
    }

    pub fn mark_read(
        &self,
        user: &AuthenticatedUser,
        notification_id: &str,
    ) -> Result<(), ApiError> {
        let updated = self.repo.mark_read(notification_id, &user.user_id)?;
        if updated == 0 {
            return Err(ApiError::not_found("Notification not found"));
        }
        Ok(())
    }

    pub fn mark_all_read(&self, user: &AuthenticatedUser) -> Result<(), ApiError> {
        self.repo.mark_all_read(&user.user_id)?;
        Ok(())
    }
}

/// Emails one recipient about one notification, if the event is one that is
/// mailed and they have not turned email off, then marks it sent.
async fn send_email(
    repo: &Arc<NotificationsRepository>,
    mailer: &Mailer,
    base_url: &str,
    notification_id: &str,
    recipient_id: &str,
    event_type: &str,
    payload: &serde_json::Value,
) {
    // The lookups are synchronous Diesel calls; keep them off the async workers.
    let lookup = {
        let repo = repo.clone();
        let recipient_id = recipient_id.to_string();
        let actor_id = email::actor_id(payload).map(str::to_string);
        let file_id = email::file_id(payload).map(str::to_string);
        tokio::task::spawn_blocking(move || -> Result<_, ApiError> {
            let Some(recipient) = repo.email_recipient(&recipient_id)? else {
                return Ok(None);
            };
            let actor = match actor_id {
                Some(id) => repo.user_name(&id)?,
                None => None,
            };
            let file = match file_id {
                Some(id) => repo.file_summary(&id)?,
                None => None,
            };
            Ok(Some((recipient, actor, file)))
        })
        .await
    };
    let (recipient, actor, file) = match lookup {
        Ok(Ok(Some(found))) => found,
        Ok(Ok(None)) => return,
        Ok(Err(e)) => {
            tracing::warn!(recipient_id, event_type, error = ?e, "no email: lookup failed");
            return;
        }
        Err(e) => {
            tracing::warn!(recipient_id, event_type, error = %e, "no email: lookup panicked");
            return;
        }
    };
    let ctx = email::Context {
        base_url,
        recipient_name: &recipient.name,
        actor_name: actor.as_deref(),
        file: file.as_ref().map(|(n, m)| (n.as_str(), m.as_str())),
    };
    let Some(content) = email::compose(event_type, payload, &ctx) else {
        return;
    };
    let message = Message {
        to: recipient.email,
        subject: content.subject,
        body: content.text,
        html: Some(content.html),
        headers: Vec::new(),
    };
    match mailer.send(message).await {
        Ok(()) => {
            let repo = repo.clone();
            let id = notification_id.to_string();
            let _ = tokio::task::spawn_blocking(move || repo.mark_email_sent(&id)).await;
        }
        Err(e) => {
            tracing::warn!(recipient_id, event_type, error = %e, "notification email not sent");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::schema::{notifications, user_profiles, users};
    use diesel::prelude::*;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel_migrations::MigrationHarness;

    fn pool() -> crate::drive::notifications::repository::DbPool {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn add_user(pool: &crate::drive::notifications::repository::DbPool, id: &str, name: &str) {
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

    #[tokio::test]
    async fn a_share_is_emailed_unless_general_email_is_off() {
        let pool = pool();
        add_user(&pool, "ada", "Ada");
        add_user(&pool, "bob", "Bob");
        add_user(&pool, "grace", "Grace");
        diesel::insert_into(user_profiles::table)
            .values((
                user_profiles::user_id.eq("bob"),
                user_profiles::email_marketing.eq(0),
                user_profiles::email_general.eq(0),
                user_profiles::email_updates.eq(1),
                user_profiles::email_critical.eq(1),
                user_profiles::updated_at.eq(chrono::Utc::now().naive_utc()),
            ))
            .execute(&mut pool.get().unwrap())
            .unwrap();

        let dir = std::env::temp_dir().join(format!("neutrino-notify-{}", Uuid::new_v4()));
        let outbox = dir.join("outbox.jsonl");
        let service = NotificationService::new(
            Arc::new(NotificationsRepository::new(pool.clone())),
            Arc::new(Mailer::Outbox(outbox.clone())),
            "https://neutrino.test".into(),
            Arc::new(NotificationHub::new()),
        );
        service
            .notify(
                vec!["ada".into(), "bob".into()],
                "file_shared",
                serde_json::json!({
                    "resourceType": "file",
                    "resourceId": "f1",
                    "resourceName": "Plan",
                    "mimeType": "application/vnd.neutrino.document",
                    "role": "viewer",
                    "sharedById": "grace",
                }),
            )
            .await
            .unwrap();

        // The email goes out on a spawned task; wait for Ada's to be marked.
        let sent_to = |id: &str| -> i32 {
            notifications::table
                .filter(notifications::recipient_id.eq(id))
                .select(notifications::email_sent)
                .first(&mut pool.get().unwrap())
                .unwrap()
        };
        for _ in 0..100 {
            if sent_to("ada") == 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        assert_eq!(sent_to("ada"), 1);
        assert_eq!(sent_to("bob"), 0);

        let text = std::fs::read_to_string(&outbox).unwrap();
        let lines: Vec<serde_json::Value> =
            text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
        assert_eq!(lines.len(), 1, "{text}");
        assert_eq!(lines[0]["to"], "ada@example.com");
        assert_eq!(lines[0]["subject"], "Grace shared “Plan” with you");
        let _ = std::fs::remove_dir_all(dir);
    }
}
