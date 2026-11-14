//! What a folder-link guest may do inside the shared folder (#321).
//!
//! Drive's folder operations are scoped to the caller's own account: `find_folder`, the listings
//! and uploads all filter on, or write under, the caller's `user_id`. A guest has no account, so
//! everything here runs **as the folder's owner**, and every check that the owner's own requests
//! would never need is made first: the target is inside the shared subtree, a destination is too,
//! the shared root itself is never renamed, moved or trashed, and only an `editor` link writes.
//!
//! The guest's session is re-checked on every call (`SharingService::guest_link`), so disabling,
//! deleting, expiring or re-passwording the link ends it at once.

use crate::drive::feature_flags::gate::FeatureGate;
use crate::drive::filesystem::{
    dto::{
        BulkMoveRequest, CreateFolderRequest, FileResponse, FolderContentsQuery,
        FolderContentsResponse, FolderResponse, UpdateFileRequest, UpdateFolderRequest,
    },
    service::FilesystemService,
};
use crate::drive::sharing::{repository::SharingRepository, service::SharingService};
use crate::shared::{ApiError, AuthenticatedUser};
use std::sync::Arc;

pub const FLAG_FOLDER_LINK_EDITING: &str = "folderLinkEditing";

/// The part of an owner's Drive one guest session may reach.
#[derive(Debug, Clone)]
pub struct LinkScope {
    pub root_folder_id: String,
    pub owner_id: String,
    pub role: String,
}

impl LinkScope {
    pub fn can_write(&self) -> bool {
        self.role == "editor"
    }

    /// The owner, as the identity the filesystem and storage services act for.
    pub fn owner(&self) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: self.owner_id.clone(),
            email: String::new(),
            token: String::new(),
            is_admin: false,
        }
    }
}

pub struct LinkFoldersService {
    sharing: Arc<SharingService>,
    repo: Arc<SharingRepository>,
    filesystem: Arc<FilesystemService>,
    gate: FeatureGate,
}

/// Anything outside the link reads as absent, not forbidden: a guest learns nothing about it.
fn not_found() -> ApiError {
    ApiError::not_found("Not found")
}

impl LinkFoldersService {
    pub fn new(
        sharing: Arc<SharingService>,
        repo: Arc<SharingRepository>,
        filesystem: Arc<FilesystemService>,
        gate: FeatureGate,
    ) -> Self {
        Self {
            sharing,
            repo,
            filesystem,
            gate,
        }
    }

    /// The caller's scope, or an error when the flag is off, the caller is not a live folder-link
    /// guest, or the shared folder is gone.
    pub fn scope(&self, caller_id: &str) -> Result<LinkScope, ApiError> {
        self.gate.require(FLAG_FOLDER_LINK_EDITING)?;
        let link = self.sharing.guest_link(caller_id)?;
        if link.resource_type != "folder" {
            return Err(ApiError::bad_request("This link is not to a folder"));
        }
        let owner_id = self
            .repo
            .folder_owner(&link.resource_id)?
            .ok_or_else(not_found)?;
        Ok(LinkScope {
            root_folder_id: link.resource_id,
            owner_id,
            role: link.role,
        })
    }

    fn writable_scope(&self, caller_id: &str) -> Result<LinkScope, ApiError> {
        let scope = self.scope(caller_id)?;
        if !scope.can_write() {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "This link only lets you view files",
            ));
        }
        Ok(scope)
    }

    pub fn require_folder(&self, scope: &LinkScope, folder_id: &str) -> Result<(), ApiError> {
        if self
            .repo
            .folder_in_subtree(&scope.root_folder_id, folder_id)?
        {
            Ok(())
        } else {
            Err(not_found())
        }
    }

    fn require_file(&self, scope: &LinkScope, file_id: &str) -> Result<(), ApiError> {
        match self.repo.file_folder(file_id)? {
            Some(Some(folder)) => self.require_folder(scope, &folder),
            _ => Err(not_found()),
        }
    }

    /// A folder under the root, never the root itself: the shared folder is the owner's to rename,
    /// move or trash.
    fn require_inner_folder(&self, scope: &LinkScope, folder_id: &str) -> Result<(), ApiError> {
        if folder_id == scope.root_folder_id {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "The shared folder itself can only be changed by its owner",
            ));
        }
        self.require_folder(scope, folder_id)
    }

    pub fn contents(
        &self,
        caller_id: &str,
        folder_id: &str,
        query: &FolderContentsQuery,
    ) -> Result<(LinkScope, FolderContentsResponse), ApiError> {
        let scope = self.scope(caller_id)?;
        self.require_folder(&scope, folder_id)?;
        let contents =
            self.filesystem
                .get_folder_contents(&scope.owner_id, Some(folder_id), query)?;
        Ok((scope, contents))
    }

    pub async fn create_folder(
        &self,
        caller_id: &str,
        parent_id: &str,
        name: String,
    ) -> Result<FolderResponse, ApiError> {
        let scope = self.writable_scope(caller_id)?;
        self.require_folder(&scope, parent_id)?;
        self.filesystem
            .create_folder(
                &scope.owner(),
                CreateFolderRequest {
                    name,
                    parent_id: Some(parent_id.to_string()),
                },
            )
            .await
    }

    /// Rename a file and/or move it to another folder inside the link.
    pub fn update_file(
        &self,
        caller_id: &str,
        file_id: &str,
        name: Option<String>,
        folder_id: Option<String>,
    ) -> Result<FileResponse, ApiError> {
        let scope = self.writable_scope(caller_id)?;
        self.require_file(&scope, file_id)?;
        if let Some(dest) = folder_id.as_deref() {
            self.require_folder(&scope, dest)?;
        }
        self.filesystem.update_file(
            &scope.owner_id,
            file_id,
            UpdateFileRequest {
                name,
                folder_id: folder_id.map(Some),
                is_starred: None,
            },
        )
    }

    /// Rename a folder and/or move it to another folder inside the link.
    pub fn update_folder(
        &self,
        caller_id: &str,
        folder_id: &str,
        name: Option<String>,
        parent_id: Option<String>,
    ) -> Result<FolderResponse, ApiError> {
        let scope = self.writable_scope(caller_id)?;
        self.require_inner_folder(&scope, folder_id)?;

        if let Some(dest) = parent_id.as_deref() {
            self.require_folder(&scope, dest)?;
            // Into itself or its own subtree would cut it loose from the tree.
            if self.repo.folder_in_subtree(folder_id, dest)? {
                return Err(ApiError::bad_request(
                    "A folder cannot be moved into itself",
                ));
            }
            self.filesystem.bulk_move(
                &scope.owner_id,
                BulkMoveRequest {
                    file_ids: vec![],
                    folder_ids: vec![folder_id.to_string()],
                    target_folder_id: Some(dest.to_string()),
                },
            )?;
        }

        self.filesystem.update_folder(
            &scope.owner_id,
            folder_id,
            UpdateFolderRequest {
                name,
                color: None,
                is_starred: None,
            },
        )
    }

    /// To the owner's trash, where the owner can restore it. Guests never delete permanently.
    pub fn trash_file(&self, caller_id: &str, file_id: &str) -> Result<(), ApiError> {
        let scope = self.writable_scope(caller_id)?;
        self.require_file(&scope, file_id)?;
        self.filesystem.trash_file(&scope.owner_id, file_id)
    }

    pub fn trash_folder(&self, caller_id: &str, folder_id: &str) -> Result<(), ApiError> {
        let scope = self.writable_scope(caller_id)?;
        self.require_inner_folder(&scope, folder_id)?;
        self.filesystem.trash_folder(&scope.owner_id, folder_id)
    }

    /// The scope an upload runs in, checked before the body is read.
    pub fn upload_scope(&self, caller_id: &str) -> Result<LinkScope, ApiError> {
        self.writable_scope(caller_id)
    }
}
