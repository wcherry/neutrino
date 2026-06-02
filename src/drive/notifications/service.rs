#![allow(dead_code)]

use crate::drive::notifications::{
    dto::{NotificationListResponse, NotificationResponse},
    model::NewNotification,
    repository::NotificationsRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct SmtpConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
    pub from: String,
}

pub struct NotificationService {
    repo: Arc<NotificationsRepository>,
    smtp_config: Option<SmtpConfig>,
}

impl NotificationService {
    pub fn new(repo: Arc<NotificationsRepository>, smtp_config: Option<SmtpConfig>) -> Self {
        NotificationService { repo, smtp_config }
    }

    pub async fn notify(
        &self,
        recipient_ids: Vec<String>,
        event_type: &str,
        payload: serde_json::Value,
    ) -> Result<(), ApiError> {
        let payload_str = payload.to_string();
        let now = chrono::Local::now().naive_local();

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
            if let Err(e) = self.repo.insert_notification(&new_notif) {
                tracing::error!("Failed to insert notification for {}: {:?}", recipient_id, e);
            }
        }

        // Send email asynchronously (fire and forget)
        if self.smtp_config.is_some() {
            let smtp_host = self.smtp_config.as_ref().map(|c| c.host.clone());
            let et = event_type.to_string();
            let p = payload.clone();
            let rids = recipient_ids.clone();
            tokio::spawn(async move {
                tracing::info!(
                    "Email notification ({}): event={} recipients={:?} payload={}",
                    smtp_host.unwrap_or_default(),
                    et,
                    rids,
                    p
                );
                // In a full implementation, use lettre to send emails here
            });
        } else {
            tracing::info!(
                "Notification (no SMTP): event={} recipients={:?} payload={}",
                event_type,
                recipient_ids,
                payload
            );
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
            self.repo.list_notifications(&user.user_id, page, page_size)?;

        Ok(NotificationListResponse {
            notifications: items.into_iter().map(NotificationResponse::from).collect(),
            unread_count,
            total,
        })
    }

    pub fn mark_read(&self, user: &AuthenticatedUser, notification_id: &str) -> Result<(), ApiError> {
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
