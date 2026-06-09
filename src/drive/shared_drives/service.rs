use crate::drive::shared_drives::{
    dto::*,
    model::{NewSharedDrive, NewSharedDriveMember},
    repository::SharedDrivesRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use chrono::Utc;
use std::sync::Arc;
use uuid::Uuid;

pub struct SharedDrivesService {
    repo: Arc<SharedDrivesRepository>,
}

impl SharedDrivesService {
    pub fn new(repo: Arc<SharedDrivesRepository>) -> Self {
        SharedDrivesService { repo }
    }

    fn valid_roles() -> &'static [&'static str] {
        &[
            "manager",
            "content_manager",
            "contributor",
            "commenter",
            "viewer",
        ]
    }

    fn get_user_role(&self, drive_id: &str, user_id: &str) -> Result<Option<String>, ApiError> {
        Ok(self.repo.find_member(drive_id, user_id)?.map(|m| m.role))
    }

    fn require_manager(&self, drive_id: &str, user_id: &str) -> Result<(), ApiError> {
        let role = self.get_user_role(drive_id, user_id)?;
        match role.as_deref() {
            Some("manager") => Ok(()),
            Some(_) => Err(ApiError::forbidden("Manager role required")),
            None => Err(ApiError::forbidden("Not a member of this drive")),
        }
    }

    pub fn create(
        &self,
        user: &AuthenticatedUser,
        req: CreateSharedDriveRequest,
    ) -> Result<SharedDriveResponse, ApiError> {
        if req.name.is_empty() {
            return Err(ApiError::bad_request("Drive name is required"));
        }
        let now = Utc::now().naive_utc();
        let drive_id = Uuid::new_v4().to_string();
        let drive = self.repo.create(NewSharedDrive {
            id: &drive_id,
            name: &req.name,
            description: req.description.as_deref(),
            created_by: &user.user_id,
            storage_used_bytes: 0,
            created_at: now,
            updated_at: now,
        })?;

        // Auto-add creator as manager
        let member_id = Uuid::new_v4().to_string();
        self.repo.add_member(NewSharedDriveMember {
            id: &member_id,
            shared_drive_id: &drive_id,
            user_id: &user.user_id,
            user_email: &user.email,
            user_name: &user.email, // will be updated when we have profile info
            role: "manager",
            added_by: &user.user_id,
            created_at: now,
        })?;

        Ok(SharedDriveResponse {
            id: drive.id,
            name: drive.name,
            description: drive.description,
            created_by: drive.created_by,
            storage_used_bytes: drive.storage_used_bytes,
            created_at: drive.created_at.to_string(),
            updated_at: drive.updated_at.to_string(),
            member_count: 1,
            user_role: "manager".to_string(),
        })
    }

    pub fn list_for_user(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<SharedDriveListResponse, ApiError> {
        let drives = self.repo.list_for_user(&user.user_id)?;
        let total = drives.len() as i64;
        let mut items = Vec::new();
        for drive in drives {
            let member_count = self.repo.count_members(&drive.id)?;
            let user_role = self
                .get_user_role(&drive.id, &user.user_id)?
                .unwrap_or_default();
            items.push(SharedDriveResponse {
                id: drive.id,
                name: drive.name,
                description: drive.description,
                created_by: drive.created_by,
                storage_used_bytes: drive.storage_used_bytes,
                created_at: drive.created_at.to_string(),
                updated_at: drive.updated_at.to_string(),
                member_count,
                user_role,
            });
        }
        Ok(SharedDriveListResponse {
            drives: items,
            total,
        })
    }

    pub fn get_by_id(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
    ) -> Result<SharedDriveResponse, ApiError> {
        let drive = self
            .repo
            .find_by_id(drive_id)?
            .ok_or_else(|| ApiError::not_found("Shared drive not found"))?;

        let user_role = self.get_user_role(drive_id, &user.user_id)?;
        if user_role.is_none() && !user.is_admin {
            return Err(ApiError::forbidden("Not a member of this drive"));
        }
        let member_count = self.repo.count_members(drive_id)?;

        Ok(SharedDriveResponse {
            id: drive.id,
            name: drive.name,
            description: drive.description,
            created_by: drive.created_by,
            storage_used_bytes: drive.storage_used_bytes,
            created_at: drive.created_at.to_string(),
            updated_at: drive.updated_at.to_string(),
            member_count,
            user_role: user_role.unwrap_or_default(),
        })
    }

    pub fn update(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
        req: UpdateSharedDriveRequest,
    ) -> Result<SharedDriveResponse, ApiError> {
        self.require_manager(drive_id, &user.user_id)?;
        self.repo.update_name_description(
            drive_id,
            req.name.as_deref(),
            req.description.as_ref().map(|d| Some(d.as_str())),
        )?;
        self.get_by_id(user, drive_id)
    }

    pub fn delete(&self, user: &AuthenticatedUser, drive_id: &str) -> Result<(), ApiError> {
        self.require_manager(drive_id, &user.user_id)?;
        self.repo.delete(drive_id)
    }

    pub fn list_members(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
    ) -> Result<MemberListResponse, ApiError> {
        let user_role = self.get_user_role(drive_id, &user.user_id)?;
        if user_role.is_none() && !user.is_admin {
            return Err(ApiError::forbidden("Not a member of this drive"));
        }
        let members = self.repo.list_members(drive_id)?;
        Ok(MemberListResponse {
            members: members
                .into_iter()
                .map(|m| SharedDriveMemberResponse {
                    id: m.id,
                    shared_drive_id: m.shared_drive_id,
                    user_id: m.user_id,
                    user_email: m.user_email,
                    user_name: m.user_name,
                    role: m.role,
                    added_by: m.added_by,
                    created_at: m.created_at.to_string(),
                })
                .collect(),
        })
    }

    pub fn add_member(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
        req: AddMemberRequest,
    ) -> Result<SharedDriveMemberResponse, ApiError> {
        self.require_manager(drive_id, &user.user_id)?;
        if !Self::valid_roles().contains(&req.role.as_str()) {
            return Err(ApiError::bad_request("Invalid role"));
        }
        let now = Utc::now().naive_utc();
        let member_id = Uuid::new_v4().to_string();
        let member = self.repo.add_member(NewSharedDriveMember {
            id: &member_id,
            shared_drive_id: drive_id,
            user_id: &req.user_id,
            user_email: &req.user_email,
            user_name: &req.user_name,
            role: &req.role,
            added_by: &user.user_id,
            created_at: now,
        })?;
        Ok(SharedDriveMemberResponse {
            id: member.id,
            shared_drive_id: member.shared_drive_id,
            user_id: member.user_id,
            user_email: member.user_email,
            user_name: member.user_name,
            role: member.role,
            added_by: member.added_by,
            created_at: member.created_at.to_string(),
        })
    }

    pub fn update_member_role(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
        target_user_id: &str,
        req: UpdateMemberRoleRequest,
    ) -> Result<(), ApiError> {
        self.require_manager(drive_id, &user.user_id)?;
        if !Self::valid_roles().contains(&req.role.as_str()) {
            return Err(ApiError::bad_request("Invalid role"));
        }
        // Cannot demote last manager
        if req.role != "manager" {
            let managers = self.repo.count_managers(drive_id)?;
            let target_member = self
                .repo
                .find_member(drive_id, target_user_id)?
                .ok_or_else(|| ApiError::not_found("Member not found"))?;
            if target_member.role == "manager" && managers <= 1 {
                return Err(ApiError::bad_request("Cannot demote the last manager"));
            }
        }
        self.repo
            .update_member_role(drive_id, target_user_id, &req.role)
    }

    pub fn remove_member(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
        target_user_id: &str,
    ) -> Result<(), ApiError> {
        self.require_manager(drive_id, &user.user_id)?;
        // Prevent removing last manager
        let target_member = self
            .repo
            .find_member(drive_id, target_user_id)?
            .ok_or_else(|| ApiError::not_found("Member not found"))?;
        if target_member.role == "manager" {
            let managers = self.repo.count_managers(drive_id)?;
            if managers <= 1 {
                return Err(ApiError::bad_request("Cannot remove the last manager"));
            }
        }
        self.repo.remove_member(drive_id, target_user_id)
    }

    pub fn get_analytics(
        &self,
        user: &AuthenticatedUser,
        drive_id: &str,
    ) -> Result<SharedDriveAnalyticsResponse, ApiError> {
        let drive = self
            .repo
            .find_by_id(drive_id)?
            .ok_or_else(|| ApiError::not_found("Shared drive not found"))?;

        let user_role = self.get_user_role(drive_id, &user.user_id)?;
        if user_role.is_none() && !user.is_admin {
            return Err(ApiError::forbidden("Not a member of this drive"));
        }

        let member_count = self.repo.count_members(drive_id)?;

        Ok(SharedDriveAnalyticsResponse {
            id: drive.id,
            name: drive.name,
            storage_used_bytes: drive.storage_used_bytes,
            member_count,
            file_count: 0, // TODO: query files table
        })
    }
}
