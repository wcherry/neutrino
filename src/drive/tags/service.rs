use crate::drive::permissions::service::PermissionsService;
use crate::drive::tags::{
    dto::{
        CreateTagRequest, ListTaggedFilesResponse, ListTagsResponse, TagResponse,
        TaggedFileResponse, UpdateTagRequest,
    },
    repository::TagsRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct TagsService {
    repo: Arc<TagsRepository>,
    permissions: Arc<PermissionsService>,
}

impl TagsService {
    pub fn new(repo: Arc<TagsRepository>, permissions: Arc<PermissionsService>) -> Self {
        TagsService { repo, permissions }
    }

    // ── Tag CRUD ──────────────────────────────────────────────────────────────

    pub fn create_tag(
        &self,
        user: &AuthenticatedUser,
        req: CreateTagRequest,
    ) -> Result<TagResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Tag name cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let tag = self
            .repo
            .insert_tag(crate::drive::tags::model::NewTagRecord {
                id: &id,
                user_id: &user.user_id,
                name: &name,
            })?;
        Ok(TagResponse::from(tag))
    }

    pub fn get_tag(&self, user: &AuthenticatedUser, tag_id: &str) -> Result<TagResponse, ApiError> {
        let tag = self
            .repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;
        Ok(TagResponse::from(tag))
    }

    pub fn list_tags(
        &self,
        user: &AuthenticatedUser,
        name_filter: Option<&str>,
    ) -> Result<ListTagsResponse, ApiError> {
        let tags = self.repo.list_tags(&user.user_id, name_filter)?;
        let total = tags.len();
        Ok(ListTagsResponse {
            tags: tags.into_iter().map(TagResponse::from).collect(),
            total,
        })
    }

    pub fn rename_tag(
        &self,
        user: &AuthenticatedUser,
        tag_id: &str,
        req: UpdateTagRequest,
    ) -> Result<TagResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Tag name cannot be empty"));
        }
        self.repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;

        let updated = self.repo.rename_tag(tag_id, &user.user_id, &name)?;
        Ok(TagResponse::from(updated))
    }

    pub fn delete_tag(&self, user: &AuthenticatedUser, tag_id: &str) -> Result<(), ApiError> {
        self.repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;

        self.repo.delete_tag(tag_id, &user.user_id)?;
        Ok(())
    }

    // ── File-Tag operations ───────────────────────────────────────────────────

    pub fn get_file_tags(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
    ) -> Result<Vec<TagResponse>, ApiError> {
        self.require_file_access(user, file_id)?;
        let tags = self.repo.get_tags_for_file(file_id, &user.user_id)?;
        Ok(tags.into_iter().map(TagResponse::from).collect())
    }

    pub fn set_file_tags(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        tag_ids: Vec<String>,
    ) -> Result<Vec<TagResponse>, ApiError> {
        self.require_file_edit(user, file_id)?;

        // Verify all supplied tag_ids belong to this user.
        for tid in &tag_ids {
            self.repo
                .find_tag(tid, &user.user_id)?
                .ok_or_else(|| ApiError::not_found("Tag not found"))?;
        }

        self.repo.set_file_tags(file_id, &tag_ids)?;
        let tags = self.repo.get_tags_for_file(file_id, &user.user_id)?;
        Ok(tags.into_iter().map(TagResponse::from).collect())
    }

    pub fn add_file_tag(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        tag_id: &str,
    ) -> Result<(), ApiError> {
        self.require_file_edit(user, file_id)?;
        self.repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;
        self.repo.add_file_tag(file_id, tag_id)?;
        Ok(())
    }

    pub fn remove_file_tag(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        tag_id: &str,
    ) -> Result<(), ApiError> {
        self.require_file_edit(user, file_id)?;
        self.repo.remove_file_tag(file_id, tag_id)?;
        Ok(())
    }

    pub fn get_files_for_tag(
        &self,
        user: &AuthenticatedUser,
        tag_id: &str,
    ) -> Result<ListTaggedFilesResponse, ApiError> {
        self.repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;

        let file_records = self.repo.get_files_for_tag(tag_id, &user.user_id)?;
        let total = file_records.len();
        Ok(ListTaggedFilesResponse {
            files: file_records
                .into_iter()
                .map(TaggedFileResponse::from)
                .collect(),
            total,
        })
    }

    /// Fetch tag names for a file — used to enrich file API responses.
    pub fn get_tag_names_for_file(
        &self,
        file_id: &str,
        user_id: &str,
    ) -> Result<Vec<String>, ApiError> {
        let tags = self.repo.get_tags_for_file(file_id, user_id)?;
        Ok(tags.into_iter().map(|t| t.name).collect())
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    fn require_file_access(&self, user: &AuthenticatedUser, file_id: &str) -> Result<(), ApiError> {
        self.permissions
            .get_effective_role(&user.user_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
        Ok(())
    }

    fn require_file_edit(&self, user: &AuthenticatedUser, file_id: &str) -> Result<(), ApiError> {
        let role = self
            .permissions
            .get_effective_role(&user.user_id, "file", file_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
        if role != "owner" && role != "editor" {
            return Err(ApiError::new(403, "FORBIDDEN", "Edit access required"));
        }
        Ok(())
    }
}
