use crate::drive::permissions::service::PermissionsService;
use crate::drive::tags::{
    dto::{
        CreateTagRequest, ListTaggedFilesResponse, ListTagsResponse, TagResponse,
        TaggedFileResponse, UpdateTagRequest,
    },
    repository::TagsRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};
use std::collections::HashMap;
use std::sync::Arc;
use uuid::Uuid;

const DEFAULT_TAGGED_FILES_LIMIT: i64 = 50;
const MAX_TAGGED_FILES_LIMIT: i64 = 200;

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
        // A brand-new tag is on nothing yet.
        Ok(TagResponse::from_record(tag, 0))
    }

    pub fn get_tag(&self, user: &AuthenticatedUser, tag_id: &str) -> Result<TagResponse, ApiError> {
        let tag = self
            .repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;
        let counts = self.repo.count_files_per_tag(&user.user_id)?;
        Ok(Self::with_count(tag, &counts))
    }

    pub fn list_tags(
        &self,
        user: &AuthenticatedUser,
        name_filter: Option<&str>,
    ) -> Result<ListTagsResponse, ApiError> {
        let tags = self.repo.list_tags(&user.user_id, name_filter)?;
        let counts = self.repo.count_files_per_tag(&user.user_id)?;
        let total = tags.len();
        Ok(ListTagsResponse {
            tags: tags
                .into_iter()
                .map(|t| Self::with_count(t, &counts))
                .collect(),
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
        let counts = self.repo.count_files_per_tag(&user.user_id)?;
        Ok(Self::with_count(updated, &counts))
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
        self.tags_for_file(user, file_id)
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

        self.repo.set_file_tags(file_id, &user.user_id, &tag_ids)?;
        self.tags_for_file(user, file_id)
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
        // Tags are private per user: without this check an editor on a shared
        // file could detach another user's tag by id.
        self.repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;
        self.repo.remove_file_tag(file_id, tag_id)?;
        Ok(())
    }

    pub fn get_files_for_tag(
        &self,
        user: &AuthenticatedUser,
        tag_id: &str,
        limit: Option<i64>,
        offset: Option<i64>,
    ) -> Result<ListTaggedFilesResponse, ApiError> {
        self.repo
            .find_tag(tag_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Tag not found"))?;

        let limit = limit
            .unwrap_or(DEFAULT_TAGGED_FILES_LIMIT)
            .clamp(1, MAX_TAGGED_FILES_LIMIT);
        let offset = offset.unwrap_or(0).max(0);

        // A user can tag any file they can edit, including files owned by
        // someone else — so accessibility, not ownership, decides what comes
        // back. Filtering happens before pagination so `total` is honest.
        let accessible: Vec<_> = self
            .repo
            .get_files_for_tag(tag_id)?
            .into_iter()
            .filter(|f| self.can_access(user, f))
            .collect();

        let total = accessible.len();
        let files = accessible
            .into_iter()
            .skip(offset as usize)
            .take(limit as usize)
            .map(TaggedFileResponse::from)
            .collect();

        Ok(ListTaggedFilesResponse {
            files,
            total,
            limit,
            offset,
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

    fn with_count(
        tag: crate::drive::tags::model::TagRecord,
        counts: &HashMap<String, i64>,
    ) -> TagResponse {
        let count = counts.get(&tag.id).copied().unwrap_or(0);
        TagResponse::from_record(tag, count)
    }

    /// The user's tags on a file, with usage counts attached.
    fn tags_for_file(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
    ) -> Result<Vec<TagResponse>, ApiError> {
        let tags = self.repo.get_tags_for_file(file_id, &user.user_id)?;
        let counts = self.repo.count_files_per_tag(&user.user_id)?;
        Ok(tags
            .into_iter()
            .map(|t| Self::with_count(t, &counts))
            .collect())
    }

    /// Whether the user may see this file at all. Ownership short-circuits the
    /// permission walk — every file-creation path records an owner row, but
    /// owning the row in `files` is the more fundamental fact.
    fn can_access(
        &self,
        user: &AuthenticatedUser,
        file: &crate::drive::storage::model::FileRecord,
    ) -> bool {
        if file.user_id == user.user_id {
            return true;
        }
        matches!(
            self.permissions
                .get_effective_role(&user.user_id, "file", &file.id),
            Ok(Some(_))
        )
    }

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
