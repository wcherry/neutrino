use crate::drive::shared_drives::{dto::*, repository::SharedDrivesRepository};
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;

pub struct SharedDrivesService {
    repo: Arc<SharedDrivesRepository>,
}

impl SharedDrivesService {
    pub fn new(repo: Arc<SharedDrivesRepository>) -> Self {
        SharedDrivesService { repo }
    }

    fn get_user_role(&self, drive_id: &str, user_id: &str) -> Result<Option<String>, ApiError> {
        Ok(self.repo.find_member(drive_id, user_id)?.map(|m| m.role))
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
}
