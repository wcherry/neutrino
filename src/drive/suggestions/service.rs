use crate::drive::activity::service::ActivityService;
use crate::drive::notifications::service::NotificationService;
use crate::drive::permissions::service::PermissionsService;
use crate::drive::suggestions::{
    dto::{CreateSuggestionRequest, SuggestionListResponse, SuggestionResponse},
    model::NewDocSuggestion,
    repository::SuggestionsRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct SuggestionsService {
    repo: Arc<SuggestionsRepository>,
    notification_service: Arc<NotificationService>,
    activity_service: Arc<ActivityService>,
    permissions_service: Arc<PermissionsService>,
}

impl SuggestionsService {
    pub fn new(
        repo: Arc<SuggestionsRepository>,
        notification_service: Arc<NotificationService>,
        activity_service: Arc<ActivityService>,
        permissions_service: Arc<PermissionsService>,
    ) -> Self {
        SuggestionsService {
            repo,
            notification_service,
            activity_service,
            permissions_service,
        }
    }

    pub fn create_suggestion(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        req: CreateSuggestionRequest,
    ) -> Result<SuggestionResponse, ApiError> {
        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        match role.as_deref() {
            Some("editor") | Some("owner") | Some("commenter") => {}
            _ => return Err(ApiError::new(403, "FORBIDDEN", "Access denied")),
        }

        let now = chrono::Local::now().naive_local();
        let id = Uuid::new_v4().to_string();
        let user_name = user
            .email
            .split('@')
            .next()
            .unwrap_or(&user.email)
            .to_string();

        let new_sug = NewDocSuggestion {
            id: id.clone(),
            file_id: file_id.to_string(),
            user_id: user.user_id.clone(),
            user_name: user_name.clone(),
            content_json: req.content_json,
            status: "pending".to_string(),
            created_at: now,
        };

        let sug = self.repo.insert_suggestion(&new_sug)?;

        // Log activity
        let _ = self.activity_service.log(
            file_id,
            &user.user_id,
            &user_name,
            "suggestion_created",
            Some(serde_json::json!({"suggestionId": id})),
        );

        Ok(SuggestionResponse::from(sug))
    }

    pub fn list_suggestions(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        status_filter: Option<&str>,
    ) -> Result<SuggestionListResponse, ApiError> {
        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        if role.is_none() {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        let suggestions = self
            .repo
            .list_suggestions_for_file(file_id, status_filter)?;
        let total = suggestions.len() as i64;

        Ok(SuggestionListResponse {
            suggestions: suggestions
                .into_iter()
                .map(SuggestionResponse::from)
                .collect(),
            total,
        })
    }

    pub async fn accept_suggestion(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        suggestion_id: &str,
    ) -> Result<SuggestionResponse, ApiError> {
        let sug = self
            .repo
            .find_suggestion(suggestion_id)?
            .ok_or_else(|| ApiError::not_found("Suggestion not found"))?;

        if sug.file_id != file_id {
            return Err(ApiError::not_found("Suggestion not found"));
        }

        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        match role.as_deref() {
            Some("editor") | Some("owner") => {}
            _ => {
                return Err(ApiError::new(
                    403,
                    "FORBIDDEN",
                    "Only editors/owners can accept suggestions",
                ))
            }
        }

        let now = chrono::Local::now().naive_local();
        let updated =
            self.repo
                .resolve_suggestion(suggestion_id, "accepted", &user.user_id, now)?;

        let user_name = user
            .email
            .split('@')
            .next()
            .unwrap_or(&user.email)
            .to_string();
        let _ = self.activity_service.log(
            file_id,
            &user.user_id,
            &user_name,
            "suggestion_accepted",
            Some(serde_json::json!({"suggestionId": suggestion_id})),
        );

        // Notify suggestion author
        if sug.user_id != user.user_id {
            let _ = self
                .notification_service
                .notify(
                    vec![sug.user_id.clone()],
                    "suggestion_accepted",
                    serde_json::json!({
                        "fileId": file_id,
                        "actorName": user_name,
                        "suggestionId": suggestion_id,
                    }),
                )
                .await;
        }

        Ok(SuggestionResponse::from(updated))
    }

    pub async fn reject_suggestion(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        suggestion_id: &str,
    ) -> Result<SuggestionResponse, ApiError> {
        let sug = self
            .repo
            .find_suggestion(suggestion_id)?
            .ok_or_else(|| ApiError::not_found("Suggestion not found"))?;

        if sug.file_id != file_id {
            return Err(ApiError::not_found("Suggestion not found"));
        }

        let role = self
            .permissions_service
            .get_effective_role(&user.user_id, "file", file_id)?;
        match role.as_deref() {
            Some("editor") | Some("owner") => {}
            _ => {
                return Err(ApiError::new(
                    403,
                    "FORBIDDEN",
                    "Only editors/owners can reject suggestions",
                ))
            }
        }

        let now = chrono::Local::now().naive_local();
        let updated =
            self.repo
                .resolve_suggestion(suggestion_id, "rejected", &user.user_id, now)?;

        let user_name = user
            .email
            .split('@')
            .next()
            .unwrap_or(&user.email)
            .to_string();
        let _ = self.activity_service.log(
            file_id,
            &user.user_id,
            &user_name,
            "suggestion_rejected",
            Some(serde_json::json!({"suggestionId": suggestion_id})),
        );

        // Notify suggestion author
        if sug.user_id != user.user_id {
            let _ = self
                .notification_service
                .notify(
                    vec![sug.user_id.clone()],
                    "suggestion_rejected",
                    serde_json::json!({
                        "fileId": file_id,
                        "actorName": user_name,
                        "suggestionId": suggestion_id,
                    }),
                )
                .await;
        }

        Ok(SuggestionResponse::from(updated))
    }
}
