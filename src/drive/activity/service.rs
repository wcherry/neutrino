#![allow(dead_code)]

use crate::drive::activity::{model::NewActivityEntry, repository::ActivityRepository};
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct ActivityService {
    repo: Arc<ActivityRepository>,
}

impl ActivityService {
    pub fn new(repo: Arc<ActivityRepository>) -> Self {
        ActivityService { repo }
    }

    pub fn log(
        &self,
        file_id: &str,
        user_id: &str,
        user_name: &str,
        action: &str,
        detail: Option<serde_json::Value>,
    ) -> Result<(), ApiError> {
        self.log_with_context(
            file_id, user_id, user_name, action, detail, None, None, None,
        )
    }

    pub fn log_with_context(
        &self,
        file_id: &str,
        user_id: &str,
        user_name: &str,
        action: &str,
        detail: Option<serde_json::Value>,
        resource_type: Option<&str>,
        ip_address: Option<&str>,
        user_agent: Option<&str>,
    ) -> Result<(), ApiError> {
        let now = chrono::Local::now().naive_local();
        let detail_json = detail.map(|v| v.to_string());

        let entry = NewActivityEntry {
            id: Uuid::new_v4().to_string(),
            file_id: file_id.to_string(),
            user_id: user_id.to_string(),
            user_name: user_name.to_string(),
            action: action.to_string(),
            detail_json,
            created_at: now,
            resource_type: resource_type.unwrap_or("file").to_string(),
            ip_address: ip_address.map(|s| s.to_string()),
            user_agent: user_agent.map(|s| s.to_string()),
        };

        self.repo.insert_entry(&entry)
    }
}
