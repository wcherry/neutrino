use crate::drive::filesystem::{
    dto::{
        BulkMoveRequest, BulkResult, BulkTrashRequest, CreateFolderRequest, CreateShortcutRequest,
        DriveView, FileResponse, FolderContentsOrderField, FolderContentsResponse, FolderResponse,
        ShortcutResponse, StarredContentsResponse, TrashContentsResponse, TrashOrderField,
        UpdateFileRequest, UpdateFolderRequest,
    },
    model::{NewFolderRecord, NewShortcutRecord, UpdateFolderRecord},
    repository::FilesystemRepository,
};
use crate::drive::permissions::service::PermissionsService;
use crate::drive::storage::store::LocalFileStore;
use crate::shared::{
    apply_list_query, ApiError, AuthenticatedUser, ListQueryParams, OrderDirection,
};
use chrono::{Duration, Utc};
use std::sync::Arc;
use uuid::Uuid;

pub struct FilesystemService {
    repo: Arc<FilesystemRepository>,
    store: Arc<LocalFileStore>,
    permissions: Arc<PermissionsService>,
}

impl FilesystemService {
    pub fn new(
        repo: Arc<FilesystemRepository>,
        store: Arc<LocalFileStore>,
        permissions: Arc<PermissionsService>,
    ) -> Self {
        FilesystemService {
            repo,
            store,
            permissions,
        }
    }

    // ── Folder operations ─────────────────────────────────────────────────────

    pub async fn create_folder(
        &self,
        user: &AuthenticatedUser,
        req: CreateFolderRequest,
    ) -> Result<FolderResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Folder name cannot be empty"));
        }

        let id = Uuid::new_v4().to_string();
        let record = NewFolderRecord {
            id: &id,
            user_id: &user.user_id,
            parent_id: req.parent_id.as_deref(),
            name: &name,
        };

        let folder = self.repo.create_folder(record)?;

        if let Err(e) = self.permissions.grant_ownership(user, "folder", &id).await {
            tracing::error!("Failed to grant ownership for folder {}: {:?}", id, e);
        }

        Ok(FolderResponse::from(folder))
    }

    pub fn get_folder_contents(
        &self,
        user_id: &str,
        folder_id: Option<&str>,
        query: &ListQueryParams<FolderContentsOrderField>,
    ) -> Result<FolderContentsResponse, ApiError> {
        // Validate folder exists if an ID is given
        let folder_response = if let Some(fid) = folder_id {
            let f = self
                .repo
                .find_folder(fid, user_id)?
                .ok_or_else(|| ApiError::not_found("Folder not found"))?;
            Some(FolderResponse::from(f))
        } else {
            None
        };

        let subfolders = self.repo.list_subfolders(user_id, folder_id)?;
        let files = self.repo.list_files_in_folder(user_id, folder_id)?;
        let shortcuts = self.repo.list_shortcuts_in_folder(user_id, folder_id)?;

        let subfolders = apply_list_query(
            subfolders,
            query,
            FolderContentsOrderField::Name,
            OrderDirection::Asc,
            |a, b, order_by| match order_by {
                FolderContentsOrderField::Name => a.name.cmp(&b.name),
                FolderContentsOrderField::CreatedAt => a.created_at.cmp(&b.created_at),
                FolderContentsOrderField::UpdatedAt => a.updated_at.cmp(&b.updated_at),
            },
        );

        let files = apply_list_query(
            files,
            query,
            FolderContentsOrderField::Name,
            OrderDirection::Asc,
            |a, b, order_by| match order_by {
                FolderContentsOrderField::Name => a.name.cmp(&b.name),
                FolderContentsOrderField::CreatedAt => a.created_at.cmp(&b.created_at),
                FolderContentsOrderField::UpdatedAt => a.updated_at.cmp(&b.updated_at),
            },
        );

        let shortcuts = apply_list_query(
            shortcuts,
            query,
            FolderContentsOrderField::CreatedAt,
            OrderDirection::Asc,
            |a, b, order_by| match order_by {
                FolderContentsOrderField::Name => a.target_file_id.cmp(&b.target_file_id),
                FolderContentsOrderField::CreatedAt | FolderContentsOrderField::UpdatedAt => {
                    a.created_at.cmp(&b.created_at)
                }
            },
        );

        Ok(FolderContentsResponse {
            folder: folder_response,
            folders: subfolders.into_iter().map(FolderResponse::from).collect(),
            files: files.into_iter().map(FileResponse::from).collect(),
            shortcuts: shortcuts.into_iter().map(ShortcutResponse::from).collect(),
        })
    }

    pub fn update_folder(
        &self,
        user_id: &str,
        folder_id: &str,
        req: UpdateFolderRequest,
    ) -> Result<FolderResponse, ApiError> {
        if let Some(ref name) = req.name {
            if name.trim().is_empty() {
                return Err(ApiError::bad_request("Folder name cannot be empty"));
            }
        }

        let now = Utc::now().naive_utc();
        let starred_at = match req.is_starred {
            Some(true) => Some(Some(now)),
            Some(false) => Some(None),
            None => None,
        };
        let changeset = UpdateFolderRecord {
            name: req.name.map(|n| n.trim().to_string()),
            color: req.color,
            is_starred: req.is_starred,
            starred_at,
            parent_id: None,
            updated_at: now,
        };

        let folder = self.repo.update_folder(folder_id, user_id, changeset)?;
        Ok(FolderResponse::from(folder))
    }

    pub fn trash_folder(&self, user_id: &str, folder_id: &str) -> Result<(), ApiError> {
        // Verify ownership
        let _ = self
            .repo
            .find_folder(folder_id, user_id)?
            .ok_or_else(|| ApiError::not_found("Folder not found"))?;

        self.repo.trash_folder(folder_id, user_id)
    }

    // ── File operations ───────────────────────────────────────────────────────

    pub fn update_file(
        &self,
        user_id: &str,
        file_id: &str,
        req: UpdateFileRequest,
    ) -> Result<FileResponse, ApiError> {
        if let Some(ref name) = req.name {
            if name.trim().is_empty() {
                return Err(ApiError::bad_request("File name cannot be empty"));
            }
        }

        let name = req.name.as_deref();
        let folder_id = req.folder_id.as_ref().map(|opt| opt.as_deref());

        let file = self
            .repo
            .update_file(file_id, user_id, name, folder_id, req.is_starred)?;

        Ok(FileResponse::from(file))
    }

    pub fn trash_file(&self, user_id: &str, file_id: &str) -> Result<(), ApiError> {
        self.repo.trash_file(file_id, user_id)
    }

    // ── Shortcut operations ───────────────────────────────────────────────────

    pub fn create_shortcut(
        &self,
        user_id: &str,
        req: CreateShortcutRequest,
    ) -> Result<ShortcutResponse, ApiError> {
        let id = Uuid::new_v4().to_string();
        let record = NewShortcutRecord {
            id: &id,
            user_id,
            target_file_id: &req.target_file_id,
            folder_id: req.folder_id.as_deref(),
        };

        let shortcut = self.repo.create_shortcut(record)?;
        Ok(ShortcutResponse::from(shortcut))
    }

    pub fn delete_shortcut(&self, user_id: &str, shortcut_id: &str) -> Result<(), ApiError> {
        let deleted = self.repo.delete_shortcut(shortcut_id, user_id)?;
        if !deleted {
            return Err(ApiError::not_found("Shortcut not found"));
        }
        Ok(())
    }

    // ── Bulk operations ───────────────────────────────────────────────────────

    pub fn bulk_move(&self, user_id: &str, req: BulkMoveRequest) -> Result<BulkResult, ApiError> {
        let target = req.target_folder_id.as_deref();
        let mut affected = 0;

        if !req.file_ids.is_empty() {
            affected += self.repo.bulk_move_files(&req.file_ids, user_id, target)?;
        }
        if !req.folder_ids.is_empty() {
            affected += self
                .repo
                .bulk_move_folders(&req.folder_ids, user_id, target)?;
        }

        Ok(BulkResult { affected })
    }

    pub fn bulk_trash(&self, user_id: &str, req: BulkTrashRequest) -> Result<BulkResult, ApiError> {
        let mut affected = 0;

        if !req.file_ids.is_empty() {
            affected += self.repo.bulk_trash_files(&req.file_ids, user_id)?;
        }
        if !req.folder_ids.is_empty() {
            affected += self.repo.bulk_trash_folders(&req.folder_ids, user_id)?;
        }

        Ok(BulkResult { affected })
    }

    pub fn bulk_download(&self, user_id: &str, file_ids: &[String]) -> Result<Vec<u8>, ApiError> {
        use std::io::Write;
        use zip::write::SimpleFileOptions;

        let files = self.repo.find_files_by_ids(file_ids, user_id)?;

        let buf = Vec::new();
        let cursor = std::io::Cursor::new(buf);
        let mut zip = zip::ZipWriter::new(cursor);
        let options = SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated)
            .unix_permissions(0o644);

        for file in &files {
            let abs_path = self.store.resolve(&file.storage_path);
            let data = std::fs::read(&abs_path).map_err(|e| {
                tracing::error!("Failed to read file {:?} for zip: {:?}", abs_path, e);
                ApiError::internal("Failed to read file for download")
            })?;

            zip.start_file(&file.name, options).map_err(|e| {
                tracing::error!("Zip start_file error: {:?}", e);
                ApiError::internal("Failed to create zip archive")
            })?;

            zip.write_all(&data).map_err(|e| {
                tracing::error!("Zip write error: {:?}", e);
                ApiError::internal("Failed to write to zip archive")
            })?;
        }

        let cursor = zip.finish().map_err(|e| {
            tracing::error!("Zip finish error: {:?}", e);
            ApiError::internal("Failed to finalize zip archive")
        })?;

        Ok(cursor.into_inner())
    }

    // ── View-filtered root contents ───────────────────────────────────────────

    pub fn get_view_contents(
        &self,
        user_id: &str,
        view: DriveView,
        query: &ListQueryParams<FolderContentsOrderField>,
    ) -> Result<FolderContentsResponse, ApiError> {
        match view {
            DriveView::Recent => {
                let limit = query.limit.unwrap_or(50);
                let files = self.repo.list_recent_files(user_id, limit)?;
                Ok(FolderContentsResponse {
                    folder: None,
                    folders: vec![],
                    files: files.into_iter().map(FileResponse::from).collect(),
                    shortcuts: vec![],
                })
            }
            DriveView::Starred => {
                let files = self.repo.list_starred_files(user_id)?;
                let folders = self.repo.list_starred_folders(user_id)?;
                Ok(FolderContentsResponse {
                    folder: None,
                    folders: folders.into_iter().map(FolderResponse::from).collect(),
                    files: files.into_iter().map(FileResponse::from).collect(),
                    shortcuts: vec![],
                })
            }
            DriveView::Trash => {
                let files = self.repo.list_trashed_files(user_id)?;
                let folders = self.repo.list_trashed_folders(user_id)?;
                Ok(FolderContentsResponse {
                    folder: None,
                    folders: folders.into_iter().map(FolderResponse::from).collect(),
                    files: files.into_iter().map(FileResponse::from).collect(),
                    shortcuts: vec![],
                })
            }
        }
    }

    // ── Starred (Quick Access) ────────────────────────────────────────────────

    pub fn list_starred(
        &self,
        user_id: &str,
        limit: usize,
    ) -> Result<StarredContentsResponse, ApiError> {
        let files = self.repo.list_starred_files(user_id)?;
        let folders = self.repo.list_starred_folders(user_id)?;

        // Merge files and folders sorted by starred_at desc, then take the top `limit`.
        // Items without starred_at (starred before this migration) sort last.
        use std::cmp::Reverse;
        let mut combined: Vec<(Option<chrono::NaiveDateTime>, bool, usize)> = files
            .iter()
            .enumerate()
            .map(|(i, f)| (f.starred_at, false, i))
            .chain(
                folders
                    .iter()
                    .enumerate()
                    .map(|(i, f)| (f.starred_at, true, i)),
            )
            .collect();
        combined.sort_by_key(|(ts, _, _)| Reverse(*ts));
        combined.truncate(limit);

        let mut out_files: Vec<FileResponse> = Vec::new();
        let mut out_folders: Vec<FolderResponse> = Vec::new();
        for (_, is_folder, idx) in combined {
            if is_folder {
                out_folders.push(FolderResponse::from(folders[idx].clone()));
            } else {
                out_files.push(FileResponse::from(files[idx].clone()));
            }
        }

        Ok(StarredContentsResponse {
            files: out_files,
            folders: out_folders,
        })
    }

    // ── Trash operations ──────────────────────────────────────────────────────

    pub fn list_trash(
        &self,
        user_id: &str,
        query: &ListQueryParams<TrashOrderField>,
    ) -> Result<TrashContentsResponse, ApiError> {
        let files = self.repo.list_trashed_files(user_id)?;
        let folders = self.repo.list_trashed_folders(user_id)?;

        let files = apply_list_query(
            files,
            query,
            TrashOrderField::TrashedAt,
            OrderDirection::Desc,
            |a, b, order_by| match order_by {
                TrashOrderField::Name => a.name.cmp(&b.name),
                TrashOrderField::TrashedAt => a
                    .deleted_at
                    .unwrap_or(a.updated_at)
                    .cmp(&b.deleted_at.unwrap_or(b.updated_at)),
            },
        );

        let folders = apply_list_query(
            folders,
            query,
            TrashOrderField::TrashedAt,
            OrderDirection::Desc,
            |a, b, order_by| match order_by {
                TrashOrderField::Name => a.name.cmp(&b.name),
                TrashOrderField::TrashedAt => a
                    .deleted_at
                    .unwrap_or(a.updated_at)
                    .cmp(&b.deleted_at.unwrap_or(b.updated_at)),
            },
        );

        Ok(TrashContentsResponse {
            files: files
                .into_iter()
                .map(crate::drive::filesystem::dto::TrashFileItem::from)
                .collect(),
            folders: folders
                .into_iter()
                .map(crate::drive::filesystem::dto::TrashFolderItem::from)
                .collect(),
        })
    }

    pub fn restore_file(&self, user_id: &str, file_id: &str) -> Result<(), ApiError> {
        self.repo.restore_file(file_id, user_id)
    }

    pub fn restore_folder(&self, user_id: &str, folder_id: &str) -> Result<(), ApiError> {
        self.repo.restore_folder(folder_id, user_id)
    }

    pub fn permanently_delete_file(&self, user_id: &str, file_id: &str) -> Result<(), ApiError> {
        if let Some(file) = self.repo.permanently_delete_file(file_id, user_id)? {
            let abs_path = self.store.resolve(&file.storage_path);
            if let Err(e) = std::fs::remove_file(&abs_path) {
                tracing::warn!("Failed to remove file from disk {:?}: {:?}", abs_path, e);
            }
        } else {
            return Err(ApiError::not_found("File not found in trash"));
        }
        Ok(())
    }

    pub fn permanently_delete_folder(
        &self,
        user_id: &str,
        folder_id: &str,
    ) -> Result<(), ApiError> {
        let deleted = self.repo.permanently_delete_folder(folder_id, user_id)?;
        if !deleted {
            return Err(ApiError::not_found("Folder not found in trash"));
        }
        Ok(())
    }

    pub fn empty_trash(&self, user_id: &str) -> Result<BulkResult, ApiError> {
        let deleted_files = self.repo.empty_trash(user_id)?;
        let count = deleted_files.len();

        for file in deleted_files {
            let abs_path = self.store.resolve(&file.storage_path);
            if let Err(e) = std::fs::remove_file(&abs_path) {
                tracing::warn!(
                    "Failed to remove trashed file from disk {:?}: {:?}",
                    abs_path,
                    e
                );
            }
        }

        Ok(BulkResult { affected: count })
    }

    /// Purge items that have been in trash for more than 30 days.
    #[allow(dead_code)]
    pub fn purge_expired_trash(&self, user_id: &str) -> Result<BulkResult, ApiError> {
        let cutoff = (Utc::now() - Duration::days(30)).naive_utc();
        let deleted_files = self.repo.purge_expired_trash(user_id, cutoff)?;
        let count = deleted_files.len();

        for file in deleted_files {
            let abs_path = self.store.resolve(&file.storage_path);
            if let Err(e) = std::fs::remove_file(&abs_path) {
                tracing::warn!(
                    "Failed to remove expired trashed file from disk {:?}: {:?}",
                    abs_path,
                    e
                );
            }
        }

        Ok(BulkResult { affected: count })
    }
}
