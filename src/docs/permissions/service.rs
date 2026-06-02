#![allow(dead_code)]

use crate::shared::{fetch_auth_profile, ApiError, AuthenticatedUser};
use crate::auth::service::AuthService;
use crate::docs::permissions::{model::NewPermissionRecord, repository::PermissionsRepository};
use std::sync::Arc;
use uuid::Uuid;

pub struct PermissionsService {
    repo: Arc<PermissionsRepository>,
    auth_service: Arc<AuthService>,
}

impl PermissionsService {
    pub fn new(repo: Arc<PermissionsRepository>, auth_service: Arc<AuthService>) -> Self {
        PermissionsService { repo, auth_service }
    }

    /// Auto-grants Owner role when a document is created.
    pub async fn grant_ownership(
        &self,
        user: &AuthenticatedUser,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        let profile = fetch_auth_profile(user, &self.auth_service)?;
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &user.user_id,
            role: "owner",
            granted_by: &user.user_id,
            user_email: &profile.email,
            user_name: &profile.name,
        };
        self.repo.upsert_permission(&record)?;
        Ok(())
    }

    /// Returns the effective role for a user on a resource, considering folder inheritance.
    /// Returns None if the user has no access at all.
    pub fn get_effective_role(
        &self,
        user_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<String>, ApiError> {
        if let Some(perm) = self.repo.find_permission(resource_type, resource_id, user_id)? {
            return Ok(Some(perm.role));
        }
        match resource_type {
            "file" => {
                if let Some(folder_id) = self.repo.get_file_folder_id(resource_id)? {
                    return self.get_effective_role_in_folder(user_id, &folder_id);
                }
            }
            "folder" => {
                if let Some(parent_id) = self.repo.get_folder_parent_id(resource_id)? {
                    return self.get_effective_role_in_folder(user_id, &parent_id);
                }
            }
            _ => {}
        }
        Ok(None)
    }

    fn get_effective_role_in_folder(
        &self,
        user_id: &str,
        folder_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let mut current_id = folder_id.to_string();
        for _ in 0..50 {
            if let Some(perm) = self.repo.find_permission("folder", &current_id, user_id)? {
                return Ok(Some(perm.role));
            }
            match self.repo.get_folder_parent_id(&current_id)? {
                Some(parent_id) => current_id = parent_id,
                None => break,
            }
        }
        Ok(None)
    }
}
