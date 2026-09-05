use crate::links::{
    dto::{BacklinksResponse, FileLinkItem, UpdateLinksRequest},
    repository::LinksRepository,
};
use crate::shared::drive_client::DriveClient;
use crate::shared::{ApiError, AuthenticatedUser};
use std::collections::{HashMap, HashSet};
use std::sync::Arc;

/// Maps a drive MIME type to the short label the frontend groups backlinks
/// by. Unknown/foreign types (e.g. raw uploaded PDFs) fall back to "file"
/// rather than erroring — a link should never fail to resolve just because
/// its target is a file type this list doesn't know about yet.
fn file_type_label(mime_type: Option<&str>) -> String {
    match mime_type {
        Some("application/x-neutrino-note") => "note",
        Some("application/x-neutrino-doc") => "doc",
        Some("application/x-neutrino-sheet") => "sheet",
        Some("application/x-neutrino-slide") => "slide",
        Some("application/x-neutrino-diagram") => "diagram",
        Some("application/x-neutrino-drawing") => "drawing",
        _ => "file",
    }
    .to_string()
}

pub struct LinksService {
    repo: Arc<LinksRepository>,
    drive: Arc<DriveClient>,
}

impl LinksService {
    pub fn new(repo: Arc<LinksRepository>, drive: Arc<DriveClient>) -> Self {
        LinksService { repo, drive }
    }

    pub async fn get_backlinks(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
    ) -> Result<BacklinksResponse, ApiError> {
        let file = self.drive.get_file(user, file_id, "File not found").await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("File not found"));
        }

        let source_ids = self.repo.get_backlink_source_ids(file_id)?;
        let mut backlinks = Vec::new();
        for source_id in &source_ids {
            if let Ok(source_file) = self.drive.get_file(user, source_id, "").await {
                if source_file.deleted_at.is_none() {
                    backlinks.push(FileLinkItem {
                        id: source_file.id,
                        title: source_file.name,
                        file_type: file_type_label(source_file.mime_type.as_deref()),
                    });
                }
            }
        }
        Ok(BacklinksResponse { backlinks })
    }

    pub async fn update_links(
        &self,
        user: &AuthenticatedUser,
        file_id: &str,
        req: UpdateLinksRequest,
    ) -> Result<BacklinksResponse, ApiError> {
        if req.linked_ids.is_some() || req.linked_ranges.is_some() {
            return Err(ApiError::bad_request(
                "linkedIds and linkedRanges are not supported yet",
            ));
        }

        let file = self.drive.get_file(user, file_id, "File not found").await?;
        match file.your_role.as_str() {
            "owner" | "editor" => {}
            _ => return Err(ApiError::forbidden("Edit access required")),
        }
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("File not found"));
        }

        let linked_titles = req.linked_titles.unwrap_or_default();
        let resolved_ids: HashSet<String> = if linked_titles.is_empty() {
            HashSet::new()
        } else {
            let all_files = self.drive.list_all_files(user).await?;
            let title_to_id: HashMap<String, String> = all_files
                .into_iter()
                .filter(|f| f.id != file_id) // exclude self-links
                .map(|f| (f.name.to_lowercase(), f.id))
                .collect();
            linked_titles
                .iter()
                .filter_map(|t| title_to_id.get(&t.to_lowercase()).cloned())
                .collect()
        };

        let current_ids: HashSet<String> =
            self.repo.get_link_target_ids(file_id)?.into_iter().collect();
        let added: Vec<String> = resolved_ids.difference(&current_ids).cloned().collect();
        let removed: Vec<String> = current_ids.difference(&resolved_ids).cloned().collect();
        self.repo.batch_update_links(file_id, &added, &removed)?;

        self.get_backlinks(user, file_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{repository::AuthRepository, service::AuthService};
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::filesystem::repository::FilesystemRepository;
    use crate::drive::feature_flags::gate::FeatureGate;
    use crate::drive::feature_flags::repository::FeatureFlagsRepository;
    use crate::drive::permissions::model::NewPermissionRecord;
    use crate::drive::permissions::repository::PermissionsRepository;
    use crate::drive::permissions::service::PermissionsService;
    use crate::drive::storage::model::NewFileRecord;
    use crate::drive::storage::repository::StorageRepository;
    use crate::drive::storage::service::StorageService;
    use crate::drive::storage::store::LocalFileStore;
    use crate::drive::workspace::{repository::WorkspaceRepository, service::WorkspaceService};
    use crate::links::repository::DbPool;
    use crate::shared::TokenService;
    use crate::MIGRATIONS;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;
    use std::path::PathBuf;

    const NOTE_MIME: &str = "application/x-neutrino-note";

    fn test_pool() -> DbPool {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: String::new(),
            is_admin: false,
        }
    }

    struct Harness {
        links_service: LinksService,
        storage_repo: StorageRepository,
        permissions_repo: PermissionsRepository,
        fs_repo: FilesystemRepository,
        base_dir: PathBuf,
    }

    fn build_harness() -> Harness {
        let pool = test_pool();
        let base = std::env::temp_dir()
            .join(format!("neutrino_links_svc_test_{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalFileStore::new(&base).expect("create store"));

        let workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
        let workspace_service = Arc::new(WorkspaceService::new(workspace_repo));
        let encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));
        let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
        let token_service = Arc::new(TokenService::new("test-secret".to_string()));
        let auth_service = Arc::new(AuthService::new(
            auth_repo,
            token_service,
            Arc::new(crate::auth::password_policy::PasswordPolicyRepository::new(pool.clone())),
        ));
        let permissions_repo_for_assertions = PermissionsRepository::new(pool.clone());
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let feature_gate = FeatureGate::new(Arc::new(FeatureFlagsRepository::new(pool.clone())));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
            feature_gate,
        ));

        let storage_repo_for_assertions = StorageRepository::new(pool.clone());
        let storage_repo = Arc::new(StorageRepository::new(pool.clone()));
        let storage_service = Arc::new(StorageService::new(
            storage_repo,
            store,
            permissions_service.clone(),
        ));
        let fs_repo_for_assertions = FilesystemRepository::new(pool.clone());
        let fs_repo = Arc::new(FilesystemRepository::new(pool.clone()));
        let drive_client = Arc::new(DriveClient::new(
            storage_service,
            permissions_service,
            fs_repo,
        ));

        let links_repo = Arc::new(LinksRepository::new(pool));
        let links_service = LinksService::new(links_repo, drive_client);

        Harness {
            links_service,
            storage_repo: storage_repo_for_assertions,
            permissions_repo: permissions_repo_for_assertions,
            fs_repo: fs_repo_for_assertions,
            base_dir: base,
        }
    }

    fn insert_file(repo: &StorageRepository, id: &str, owner_id: &str, name: &str, mime_type: &str) {
        repo.insert_file(NewFileRecord {
            id,
            user_id: owner_id,
            name,
            size_bytes: 0,
            mime_type,
            storage_path: "",
            folder_id: None,
            encrypted_metadata: None,
        })
        .expect("insert file");
    }

    fn grant_role(repo: &PermissionsRepository, resource_id: &str, user_id: &str, role: &str) {
        repo.upsert_permission(&NewPermissionRecord {
            id: &uuid::Uuid::new_v4().to_string(),
            resource_type: "file",
            resource_id,
            user_id,
            role,
            granted_by: user_id,
            user_email: &format!("{user_id}@example.com"),
            user_name: user_id,
        })
        .expect("grant role");
    }

    #[tokio::test]
    async fn update_links_resolves_titles_case_insensitively_and_excludes_self() {
        let h = build_harness();
        let owner = test_user("owner-1");
        insert_file(&h.storage_repo, "src", &owner.user_id, "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", &owner.user_id, "owner");
        insert_file(&h.storage_repo, "tgt", &owner.user_id, "Target Note", NOTE_MIME);
        grant_role(&h.permissions_repo, "tgt", &owner.user_id, "owner");

        let result = h
            .links_service
            .update_links(
                &owner,
                "src",
                UpdateLinksRequest {
                    linked_titles: Some(vec!["target note".to_string(), "Source".to_string()]),
                    ..Default::default()
                },
            )
            .await
            .expect("update_links should succeed");

        // The response shows incoming links to "src" (none), not the outgoing
        // links just written — this asserts the outgoing write via backlinks
        // on the target instead.
        assert!(result.backlinks.is_empty());

        let backlinks_on_target = h
            .links_service
            .get_backlinks(&owner, "tgt")
            .await
            .expect("get backlinks on target");
        assert_eq!(backlinks_on_target.backlinks.len(), 1);
        assert_eq!(backlinks_on_target.backlinks[0].id, "src");
        assert_eq!(backlinks_on_target.backlinks[0].file_type, "note");

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn update_links_added_removed_diff_only_touches_the_difference() {
        let h = build_harness();
        let owner = test_user("owner-1");
        insert_file(&h.storage_repo, "src", &owner.user_id, "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", &owner.user_id, "owner");
        insert_file(&h.storage_repo, "a", &owner.user_id, "Alpha", NOTE_MIME);
        grant_role(&h.permissions_repo, "a", &owner.user_id, "owner");
        insert_file(&h.storage_repo, "b", &owner.user_id, "Beta", NOTE_MIME);
        grant_role(&h.permissions_repo, "b", &owner.user_id, "owner");

        h.links_service
            .update_links(
                &owner,
                "src",
                UpdateLinksRequest {
                    linked_titles: Some(vec!["Alpha".to_string()]),
                    ..Default::default()
                },
            )
            .await
            .expect("first update");

        h.links_service
            .update_links(
                &owner,
                "src",
                UpdateLinksRequest {
                    linked_titles: Some(vec!["Beta".to_string()]),
                    ..Default::default()
                },
            )
            .await
            .expect("second update replaces Alpha with Beta");

        let alpha_backlinks = h.links_service.get_backlinks(&owner, "a").await.unwrap();
        assert!(alpha_backlinks.backlinks.is_empty());
        let beta_backlinks = h.links_service.get_backlinks(&owner, "b").await.unwrap();
        assert_eq!(beta_backlinks.backlinks.len(), 1);
        assert_eq!(beta_backlinks.backlinks[0].id, "src");

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn update_links_silently_drops_titles_that_do_not_resolve() {
        let h = build_harness();
        let owner = test_user("owner-1");
        insert_file(&h.storage_repo, "src", &owner.user_id, "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", &owner.user_id, "owner");

        let result = h
            .links_service
            .update_links(
                &owner,
                "src",
                UpdateLinksRequest {
                    linked_titles: Some(vec!["Does Not Exist".to_string()]),
                    ..Default::default()
                },
            )
            .await
            .expect("unresolvable titles should not error");

        assert!(result.backlinks.is_empty());
        assert!(h
            .links_service
            .repo
            .get_link_target_ids("src")
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn update_links_silently_drops_titles_resolving_to_a_deleted_file() {
        let h = build_harness();
        let owner = test_user("owner-1");
        insert_file(&h.storage_repo, "src", &owner.user_id, "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", &owner.user_id, "owner");
        insert_file(&h.storage_repo, "tgt", &owner.user_id, "Target", NOTE_MIME);
        grant_role(&h.permissions_repo, "tgt", &owner.user_id, "owner");
        h.fs_repo
            .trash_file("tgt", &owner.user_id)
            .expect("trash target file");

        h.links_service
            .update_links(
                &owner,
                "src",
                UpdateLinksRequest {
                    linked_titles: Some(vec!["Target".to_string()]),
                    ..Default::default()
                },
            )
            .await
            .expect("should not error even though the title resolves to a deleted file");

        assert!(h
            .links_service
            .repo
            .get_link_target_ids("src")
            .unwrap()
            .is_empty());

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn update_links_returns_403_for_a_viewer() {
        let h = build_harness();
        insert_file(&h.storage_repo, "src", "owner-1", "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", "owner-1", "owner");
        let viewer = test_user("viewer-1");
        grant_role(&h.permissions_repo, "src", &viewer.user_id, "viewer");

        let result = h
            .links_service
            .update_links(&viewer, "src", UpdateLinksRequest::default())
            .await;

        let err = result.expect_err("a viewer must not be able to update links");
        assert_eq!(err.status, 403);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn update_links_returns_404_for_a_deleted_source_file() {
        let h = build_harness();
        let owner = test_user("owner-1");
        insert_file(&h.storage_repo, "src", &owner.user_id, "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", &owner.user_id, "owner");
        h.fs_repo
            .trash_file("src", &owner.user_id)
            .expect("trash source file");

        let result = h
            .links_service
            .update_links(&owner, "src", UpdateLinksRequest::default())
            .await;

        let err = result.expect_err("updating links on a deleted file must 404");
        assert_eq!(err.status, 404);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn update_links_rejects_linked_ids_with_400() {
        let h = build_harness();
        let owner = test_user("owner-1");
        insert_file(&h.storage_repo, "src", &owner.user_id, "Source", NOTE_MIME);
        grant_role(&h.permissions_repo, "src", &owner.user_id, "owner");

        let result = h
            .links_service
            .update_links(
                &owner,
                "src",
                UpdateLinksRequest {
                    linked_ids: Some(vec!["some-id".to_string()]),
                    ..Default::default()
                },
            )
            .await;

        let err = result.expect_err("linkedIds is not supported yet");
        assert_eq!(err.status, 400);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }
}
