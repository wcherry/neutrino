use crate::drive::activity::{
    dto::{ActivityEntryResponse, ActivityListResponse},
    model::NewActivityEntry,
    repository::ActivityRepository,
};
use crate::drive::permissions::service::PermissionsService;
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct ActivityService {
    repo: Arc<ActivityRepository>,
    permissions_service: Arc<PermissionsService>,
}

impl ActivityService {
    pub fn new(repo: Arc<ActivityRepository>, permissions_service: Arc<PermissionsService>) -> Self {
        ActivityService { repo, permissions_service }
    }

    pub fn log(
        &self,
        file_id: &str,
        user_id: &str,
        user_name: &str,
        action: &str,
        detail: Option<serde_json::Value>,
    ) -> Result<(), ApiError> {
        self.log_with_context(file_id, user_id, user_name, action, detail, None, None, None)
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

    pub fn list_file_activity(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        page: Option<i64>,
        page_size: Option<i64>,
    ) -> Result<ActivityListResponse, ApiError> {
        let role = self.permissions_service.get_effective_role(&user.user_id, "file", file_id)?;
        if role.is_none() {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        let page = page.unwrap_or(1).max(1);
        let page_size = page_size.unwrap_or(20).min(100).max(1);

        let (items, total) = self.repo.list_for_file(file_id, page, page_size)?;

        Ok(ActivityListResponse {
            entries: items.into_iter().map(ActivityEntryResponse::from).collect(),
            total,
        })
    }

    pub fn list_all_activity(
        &self,
        user_id_filter: Option<&str>,
        resource_type_filter: Option<&str>,
        action_filter: Option<&str>,
        page: i64,
        page_size: i64,
    ) -> Result<ActivityListResponse, ApiError> {
        let (items, total) = self.repo.list_all(
            user_id_filter,
            resource_type_filter,
            action_filter,
            page,
            page_size,
        )?;
        Ok(ActivityListResponse {
            entries: items.into_iter().map(ActivityEntryResponse::from).collect(),
            total,
        })
    }
}
