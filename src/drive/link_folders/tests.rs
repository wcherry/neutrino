//! Folder link sharing (#321), end to end through the services: passwords, guest sessions that die
//! with the link, the guest's confinement to the shared folder, and the key bookkeeping that lets
//! a link open end-to-end encrypted files.

use super::service::{LinkFoldersService, FLAG_FOLDER_LINK_EDITING};
use crate::auth::password_policy::PasswordPolicyRepository;
use crate::auth::repository::AuthRepository;
use crate::auth::service::AuthService;
use crate::drive::encryption::{repository::EncryptionRepository, service::EncryptionService};
use crate::drive::feature_flags::{gate::FeatureGate, repository::FeatureFlagsRepository};
use crate::drive::filesystem::{
    dto::FolderContentsQuery, repository::FilesystemRepository, service::FilesystemService,
};
use crate::drive::permissions::{repository::PermissionsRepository, service::PermissionsService};
use crate::drive::sharing::{
    dto::{LinkRole, LinkVisibility, UpdateShareLinkRequest, UpsertShareLinkRequest},
    repository::{DbPool, SharingRepository},
    service::SharingService,
};
use crate::drive::storage::store::LocalFileStore;
use crate::drive::workspace::{repository::WorkspaceRepository, service::WorkspaceService};
use crate::schema::{file_key_refs, files, folders, permissions, user_public_keys, users};
use crate::shared::TokenService;
use diesel::prelude::*;
use diesel::r2d2::ConnectionManager;
use diesel_migrations::MigrationHarness;
use std::sync::Arc;

/// 32 zero bytes, base64url: a syntactically valid X25519 public key.
const LINK_PUBLIC_KEY: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

struct Fixture {
    pool: DbPool,
    flags: Arc<FeatureFlagsRepository>,
    permissions: Arc<PermissionsService>,
    sharing: Arc<SharingService>,
    encryption: EncryptionService,
    links: LinkFoldersService,
    tokens: Arc<TokenService>,
}

/// The tree every test starts from:
///
/// ```text
/// owner:  shared/            <- the link points here
///           ├─ sub/
///           │    └─ deep.txt (encrypted)
///           └─ top.txt       (encrypted)
///         plain.txt in shared/ (no key: plaintext)
///         outside/
///           └─ secret.txt    (encrypted)
/// ```
impl Fixture {
    fn new() -> Self {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool: DbPool = diesel::r2d2::Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");

        let flags = Arc::new(FeatureFlagsRepository::new(pool.clone()));
        flags.update(FLAG_FOLDER_LINK_EDITING, true).expect("flag");
        let gate = FeatureGate::new(flags.clone());
        let tokens = Arc::new(TokenService::new_with_expiry("test-secret".into(), 3600, 0));
        let workspace = Arc::new(WorkspaceService::new(Arc::new(WorkspaceRepository::new(
            pool.clone(),
        ))));
        let permissions = Arc::new(PermissionsService::new(
            Arc::new(PermissionsRepository::new(pool.clone())),
            workspace.clone(),
            Arc::new(EncryptionRepository::new(pool.clone())),
            Arc::new(AuthService::new(
                Arc::new(AuthRepository::new(pool.clone())),
                tokens.clone(),
                Arc::new(PasswordPolicyRepository::new(pool.clone())),
            )),
            gate.clone(),
        ));
        let sharing_repo = Arc::new(SharingRepository::new(pool.clone()));
        let sharing = Arc::new(SharingService::new(
            sharing_repo.clone(),
            permissions.clone(),
            workspace,
            tokens.clone(),
        ));
        let dir = std::env::temp_dir().join(format!("neutrino-link-{}", uuid::Uuid::new_v4()));
        let filesystem = Arc::new(FilesystemService::new(
            Arc::new(FilesystemRepository::new(pool.clone())),
            Arc::new(LocalFileStore::new(dir).expect("store")),
            permissions.clone(),
        ));
        let links = LinkFoldersService::new(sharing.clone(), sharing_repo, filesystem, gate);
        let encryption = EncryptionService::new(
            Arc::new(EncryptionRepository::new(pool.clone())),
            permissions.clone(),
        );

        let f = Fixture {
            pool,
            flags,
            permissions,
            sharing,
            encryption,
            links,
            tokens,
        };
        f.add_user("owner");
        f.add_folder("shared", None);
        f.add_folder("sub", Some("shared"));
        f.add_folder("outside", None);
        f.add_file("top.txt", "shared", true);
        f.add_file("deep.txt", "sub", true);
        f.add_file("plain.txt", "shared", false);
        f.add_file("secret.txt", "outside", true);
        diesel::insert_into(user_public_keys::table)
            .values((
                user_public_keys::user_id.eq("owner"),
                user_public_keys::version.eq(2),
                user_public_keys::public_key.eq("owner-pk"),
            ))
            .execute(&mut f.conn())
            .expect("owner key");
        f
    }

    fn conn(&self) -> diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>> {
        self.pool.get().expect("conn")
    }

    fn add_user(&self, id: &str) {
        diesel::insert_into(users::table)
            .values((
                users::id.eq(id),
                users::email.eq(format!("{id}@example.com")),
                users::name.eq(id),
                users::password_hash.eq("x"),
                users::role.eq("user"),
            ))
            .execute(&mut self.conn())
            .expect("insert user");
    }

    fn add_folder(&self, id: &str, parent: Option<&str>) {
        diesel::insert_into(folders::table)
            .values((
                folders::id.eq(id),
                folders::user_id.eq("owner"),
                folders::name.eq(id),
                folders::parent_id.eq(parent),
            ))
            .execute(&mut self.conn())
            .expect("insert folder");
        self.own("folder", id);
    }

    /// What `grant_ownership` writes for every upload and new folder.
    fn own(&self, resource_type: &str, id: &str) {
        diesel::insert_into(permissions::table)
            .values((
                permissions::id.eq(format!("perm-{id}")),
                permissions::resource_type.eq(resource_type),
                permissions::resource_id.eq(id),
                permissions::user_id.eq("owner"),
                permissions::role.eq("owner"),
                permissions::granted_by.eq("owner"),
                permissions::user_email.eq("owner@example.com"),
                permissions::user_name.eq("owner"),
            ))
            .execute(&mut self.conn())
            .expect("insert permission");
    }

    fn add_file(&self, id: &str, folder: &str, encrypted: bool) {
        diesel::insert_into(files::table)
            .values((
                files::id.eq(id),
                files::user_id.eq("owner"),
                files::name.eq(id),
                files::size_bytes.eq(10_i64),
                files::mime_type.eq("text/plain"),
                files::storage_path.eq(format!("/tmp/{id}")),
                files::folder_id.eq(folder),
            ))
            .execute(&mut self.conn())
            .expect("insert file");
        self.own("file", id);
        if encrypted {
            self.add_key(id, "owner");
        }
    }

    fn add_key(&self, file_id: &str, subject: &str) {
        diesel::insert_into(file_key_refs::table)
            .values((
                file_key_refs::id.eq(format!("{file_id}-{subject}")),
                file_key_refs::file_id.eq(file_id),
                file_key_refs::user_id.eq(subject),
                file_key_refs::encrypted_file_key.eq("sealed"),
                file_key_refs::key_version.eq(1),
            ))
            .execute(&mut self.conn())
            .expect("insert key");
    }

    fn key_subjects(&self, file_id: &str) -> Vec<String> {
        file_key_refs::table
            .filter(file_key_refs::file_id.eq(file_id))
            .select(file_key_refs::user_id)
            .order(file_key_refs::user_id.asc())
            .load(&mut self.conn())
            .expect("keys")
    }

    /// Owner makes a link on `shared`; returns its token.
    fn link(&self, role: LinkRole, password: Option<&str>) -> String {
        self.sharing
            .upsert_share_link(
                "owner",
                "folder",
                "shared",
                UpsertShareLinkRequest {
                    visibility: LinkVisibility::AnyoneWithLink,
                    role,
                    expires_at: None,
                    password: password.map(str::to_string),
                    public_key: Some(LINK_PUBLIC_KEY.into()),
                    sealed_seed: Some("sealed-seed".into()),
                    sealed_seed_key_version: Some(2),
                },
            )
            .expect("upsert link")
            .token
    }

    /// Open a guest session and return its subject (the JWT `sub`).
    fn session(&self, token: &str, password: Option<&str>) -> String {
        let s = self
            .sharing
            .create_guest_session(token, password)
            .expect("session");
        self.tokens
            .validate_access_token(&s.access_token)
            .expect("valid token")
            .sub
    }

    fn patch(&self, req: UpdateShareLinkRequest) {
        self.sharing
            .update_share_link("owner", "folder", "shared", req)
            .expect("patch link");
    }

    fn role(&self, subject: &str, resource_type: &str, id: &str) -> Option<String> {
        self.permissions
            .get_effective_role(subject, resource_type, id)
            .expect("role")
    }
}

fn patch_req() -> UpdateShareLinkRequest {
    UpdateShareLinkRequest {
        visibility: None,
        role: None,
        expires_at: None,
        is_active: None,
        password: None,
        public_key: None,
        sealed_seed: None,
        sealed_seed_key_version: None,
    }
}

fn query() -> FolderContentsQuery {
    serde_json::from_str("{}").expect("empty query")
}

// ── Guest role ──────────────────────────────────────────────────────────────

#[test]
fn a_guest_reaches_the_shared_folder_and_nothing_outside_it() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);

    assert_eq!(
        f.role(&guest, "folder", "shared").as_deref(),
        Some("editor")
    );
    assert_eq!(f.role(&guest, "folder", "sub").as_deref(), Some("editor"));
    assert_eq!(
        f.role(&guest, "file", "deep.txt").as_deref(),
        Some("editor")
    );
    assert_eq!(f.role(&guest, "folder", "outside"), None);
    assert_eq!(f.role(&guest, "file", "secret.txt"), None);
}

#[test]
fn disabling_deleting_or_expiring_the_link_ends_the_session() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);

    f.patch(UpdateShareLinkRequest {
        is_active: Some(false),
        ..patch_req()
    });
    assert_eq!(f.role(&guest, "file", "top.txt"), None);

    f.patch(UpdateShareLinkRequest {
        is_active: Some(true),
        ..patch_req()
    });
    assert_eq!(f.role(&guest, "file", "top.txt").as_deref(), Some("editor"));

    f.patch(UpdateShareLinkRequest {
        expires_at: Some(Some("2000-01-01T00:00:00".into())),
        ..patch_req()
    });
    assert_eq!(f.role(&guest, "file", "top.txt"), None);

    f.sharing
        .delete_share_link("owner", "folder", "shared")
        .expect("delete");
    assert_eq!(f.role(&guest, "file", "top.txt"), None);
}

#[test]
fn a_guest_is_never_an_owner_and_cannot_manage_the_link() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);
    let err = f
        .sharing
        .update_share_link(
            &guest,
            "folder",
            "shared",
            UpdateShareLinkRequest {
                role: Some(LinkRole::Viewer),
                ..patch_req()
            },
        )
        .expect_err("guest cannot manage");
    assert_eq!(err.status, 403);
}

#[test]
fn a_trashed_file_is_out_of_reach() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Viewer, None), None);
    diesel::update(files::table.filter(files::id.eq("top.txt")))
        .set(files::deleted_at.eq(chrono::Utc::now().naive_utc()))
        .execute(&mut f.conn())
        .unwrap();
    assert_eq!(f.role(&guest, "file", "top.txt"), None);
}

// ── Passwords ───────────────────────────────────────────────────────────────

#[test]
fn a_password_link_withholds_details_until_the_password_is_given() {
    let f = Fixture::new();
    let token = f.link(LinkRole::Editor, Some("hunter22"));

    let resolved = f.sharing.resolve_token(&token).expect("resolve");
    assert!(resolved.password_required);
    assert_eq!(resolved.resource_id, "");
    assert_eq!(resolved.resource_name, "");
    assert_eq!(resolved.role, "");

    let missing = f.sharing.create_guest_session(&token, None).unwrap_err();
    assert_eq!(
        (missing.status, missing.code.as_str()),
        (401, "SHARE_PASSWORD_REQUIRED")
    );
    let wrong = f
        .sharing
        .create_guest_session(&token, Some("nope"))
        .unwrap_err();
    assert_eq!(
        (wrong.status, wrong.code.as_str()),
        (401, "SHARE_PASSWORD_INVALID")
    );

    // The owner gets the sealed seed back to rebuild the link; a guest never sees it.
    let owners = f
        .sharing
        .get_share_link("owner", "folder", "shared")
        .unwrap()
        .unwrap();
    assert_eq!(owners.sealed_seed.as_deref(), Some("sealed-seed"));
    assert_eq!(owners.sealed_seed_key_version, Some(2));

    let ok = f
        .sharing
        .create_guest_session(&token, Some("hunter22"))
        .expect("right password");
    assert_eq!(ok.resource_id, "shared");
    assert_eq!(ok.public_key.as_deref(), Some(LINK_PUBLIC_KEY));
}

#[test]
fn repeated_wrong_passwords_are_refused_for_a_while() {
    let f = Fixture::new();
    let token = f.link(LinkRole::Viewer, Some("hunter22"));
    for _ in 0..10 {
        f.sharing
            .create_guest_session(&token, Some("nope"))
            .unwrap_err();
    }
    let err = f
        .sharing
        .create_guest_session(&token, Some("hunter22"))
        .unwrap_err();
    assert_eq!(err.status, 429);
}

#[test]
fn changing_or_removing_the_password_ends_existing_sessions() {
    let f = Fixture::new();
    let token = f.link(LinkRole::Viewer, Some("hunter22"));
    let before = f.session(&token, Some("hunter22"));
    assert!(f.role(&before, "folder", "shared").is_some());

    f.patch(UpdateShareLinkRequest {
        password: Some(Some("another1".into())),
        ..patch_req()
    });
    assert_eq!(f.role(&before, "folder", "shared"), None);

    let second = f.session(&token, Some("another1"));
    f.patch(UpdateShareLinkRequest {
        password: Some(None),
        ..patch_req()
    });
    assert_eq!(f.role(&second, "folder", "shared"), None);
    // And with no password left, a session needs none.
    let third = f.session(&token, None);
    assert!(f.role(&third, "folder", "shared").is_some());
}

#[test]
fn a_password_link_download_needs_that_links_session() {
    let f = Fixture::new();
    let token = f.link(LinkRole::Viewer, Some("hunter22"));
    let err = f.sharing.resolve_for_download(&token, None).unwrap_err();
    assert_eq!(err.status, 401);
    let guest = f.session(&token, Some("hunter22"));
    f.sharing
        .resolve_for_download(&token, Some(&guest))
        .expect("session opens it");
}

#[test]
fn a_too_short_password_or_a_bad_public_key_is_refused() {
    let f = Fixture::new();
    let mk = |password: Option<&str>, key: Option<&str>| {
        f.sharing.upsert_share_link(
            "owner",
            "folder",
            "shared",
            UpsertShareLinkRequest {
                visibility: LinkVisibility::AnyoneWithLink,
                role: LinkRole::Viewer,
                expires_at: None,
                password: password.map(str::to_string),
                public_key: key.map(str::to_string),
                sealed_seed: None,
                sealed_seed_key_version: None,
            },
        )
    };
    assert_eq!(mk(Some("abc"), None).unwrap_err().status, 400);
    assert_eq!(mk(None, Some("too-short")).unwrap_err().status, 400);
    let link = mk(Some("abcd"), Some(LINK_PUBLIC_KEY)).expect("valid");
    assert!(link.has_password);
    assert_eq!(link.sealed_seed, None);
    assert_eq!(link.key_subject, format!("guest:{}", link.id));
}

// ── Keys ────────────────────────────────────────────────────────────────────

#[test]
fn a_guest_session_reads_and_writes_its_links_key() {
    let f = Fixture::new();
    let token = f.link(LinkRole::Editor, None);
    let guest = f.session(&token, None);
    let subject = f
        .sharing
        .get_share_link("owner", "folder", "shared")
        .unwrap()
        .unwrap()
        .key_subject;

    // The owner seals top.txt to the link.
    f.encryption
        .share_file_key("owner", "top.txt", &subject, "sealed-to-link", 1)
        .expect("owner seals to link");
    let got = f
        .encryption
        .get_file_key(&guest, "top.txt")
        .unwrap()
        .unwrap();
    assert_eq!(got.encrypted_file_key, "sealed-to-link");

    // A guest storing its own key stores it under the link, not the session.
    f.encryption
        .set_file_key(&guest, "deep.txt", "guest-sealed", 1)
        .expect("guest sets");
    assert!(f.key_subjects("deep.txt").contains(&subject));

    // And may hand a file it can open to the owner.
    f.encryption
        .share_file_key(&guest, "deep.txt", "owner", "sealed-to-owner", 2)
        .expect("guest seals to owner");
}

#[test]
fn a_link_cannot_be_given_a_key_to_a_file_outside_it() {
    let f = Fixture::new();
    f.link(LinkRole::Editor, None);
    let subject = f
        .sharing
        .get_share_link("owner", "folder", "shared")
        .unwrap()
        .unwrap()
        .key_subject;
    let err = f
        .encryption
        .share_file_key("owner", "secret.txt", &subject, "sealed", 1)
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[test]
fn deleting_or_replacing_the_link_drops_its_keys() {
    let f = Fixture::new();
    f.link(LinkRole::Editor, None);
    let first = f
        .sharing
        .get_share_link("owner", "folder", "shared")
        .unwrap()
        .unwrap();
    f.add_key("top.txt", &first.key_subject);

    f.link(LinkRole::Editor, None); // replace
    assert!(!f.key_subjects("top.txt").contains(&first.key_subject));

    let second = f
        .sharing
        .get_share_link("owner", "folder", "shared")
        .unwrap()
        .unwrap();
    f.add_key("top.txt", &second.key_subject);
    f.sharing
        .delete_share_link("owner", "folder", "shared")
        .unwrap();
    assert_eq!(f.key_subjects("top.txt"), vec!["owner".to_string()]);
}

#[test]
fn unkeyed_files_lists_encrypted_files_in_the_subtree_not_yet_sealed() {
    let f = Fixture::new();
    f.link(LinkRole::Viewer, None);
    let link = f
        .sharing
        .get_share_link("owner", "folder", "shared")
        .unwrap()
        .unwrap();

    let mut ids = f.sharing.unkeyed_files("owner", "shared").unwrap().file_ids;
    ids.sort();
    // Not plain.txt (no key at all) and not secret.txt (outside).
    assert_eq!(ids, vec!["deep.txt", "top.txt"]);

    f.add_key("top.txt", &link.key_subject);
    let after = f.sharing.unkeyed_files("owner", "shared").unwrap();
    assert_eq!(after.file_ids, vec!["deep.txt"]);
    assert!(!after.has_more);
}

#[test]
fn key_recipients_name_the_owner_and_the_link_but_never_the_caller() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);

    let for_owner = f.sharing.key_recipients("owner", "sub").unwrap().recipients;
    assert_eq!(for_owner.len(), 1);
    assert_eq!(for_owner[0].kind, "link");
    assert_eq!(for_owner[0].public_key, LINK_PUBLIC_KEY);

    let for_guest = f.sharing.key_recipients(&guest, "sub").unwrap().recipients;
    assert_eq!(for_guest.len(), 1);
    assert_eq!(for_guest[0].kind, "owner");
    assert_eq!(for_guest[0].recipient_id, "owner");
    assert_eq!(for_guest[0].key_version, 2);

    // Outside the link there is no link to seal to, and the guest has no access at all.
    assert!(f
        .sharing
        .key_recipients("owner", "outside")
        .unwrap()
        .recipients
        .is_empty());
    assert_eq!(
        f.sharing
            .key_recipients(&guest, "outside")
            .unwrap_err()
            .status,
        403
    );
}

// ── Guest folder API ────────────────────────────────────────────────────────

#[test]
fn the_guest_folder_api_is_off_without_the_flag() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);
    f.flags.update(FLAG_FOLDER_LINK_EDITING, false).unwrap();
    assert_eq!(
        f.links
            .contents(&guest, "shared", &query())
            .unwrap_err()
            .status,
        404
    );
}

#[test]
fn a_guest_lists_folders_inside_the_link_only() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Viewer, None), None);

    let (scope, contents) = f.links.contents(&guest, "shared", &query()).unwrap();
    assert_eq!(scope.root_folder_id, "shared");
    let mut names: Vec<_> = contents.files.iter().map(|x| x.name.clone()).collect();
    names.sort();
    assert_eq!(names, vec!["plain.txt", "top.txt"]);
    assert_eq!(contents.folders.len(), 1);

    assert_eq!(
        f.links
            .contents(&guest, "outside", &query())
            .unwrap_err()
            .status,
        404
    );
}

#[test]
fn an_account_holder_is_not_a_link_guest() {
    let f = Fixture::new();
    f.link(LinkRole::Editor, None);
    assert_eq!(
        f.links
            .contents("owner", "shared", &query())
            .unwrap_err()
            .status,
        401
    );
}

#[actix_web::test]
async fn an_editor_guest_creates_renames_moves_and_trashes_inside_the_link() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);

    let made = f
        .links
        .create_folder(&guest, "sub", "made".into())
        .await
        .expect("create");
    assert_eq!(made.parent_id.as_deref(), Some("sub"));

    f.links
        .update_file(
            &guest,
            "top.txt",
            Some("renamed.txt".into()),
            Some(made.id.clone()),
        )
        .expect("rename + move");
    f.links
        .update_folder(
            &guest,
            &made.id,
            Some("made2".into()),
            Some("shared".into()),
        )
        .expect("folder rename + move");
    f.links.trash_file(&guest, "deep.txt").expect("trash file");
    f.links.trash_folder(&guest, "sub").expect("trash folder");

    // Everything the guest made or touched stays the owner's.
    let owner: String = folders::table
        .filter(folders::id.eq(&made.id))
        .select(folders::user_id)
        .first(&mut f.conn())
        .unwrap();
    assert_eq!(owner, "owner");
}

#[actix_web::test]
async fn a_guest_cannot_reach_out_of_the_link_or_touch_its_root() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Editor, None), None);

    fn status<T>(r: Result<T, crate::shared::ApiError>) -> u16 {
        r.map(|_| ()).unwrap_err().status
    }
    assert_eq!(
        status(f.links.create_folder(&guest, "outside", "x".into()).await),
        404
    );
    assert_eq!(
        status(
            f.links
                .update_file(&guest, "top.txt", None, Some("outside".into()))
        ),
        404
    );
    assert_eq!(
        status(
            f.links
                .update_file(&guest, "secret.txt", Some("x".into()), None)
        ),
        404
    );
    assert_eq!(status(f.links.trash_file(&guest, "secret.txt")), 404);
    assert_eq!(
        status(
            f.links
                .update_folder(&guest, "shared", Some("x".into()), None)
        ),
        403
    );
    assert_eq!(status(f.links.trash_folder(&guest, "shared")), 403);
    assert_eq!(
        status(
            f.links
                .update_folder(&guest, "sub", None, Some("outside".into()))
        ),
        404
    );
}

#[test]
fn a_folder_cannot_be_moved_into_itself() {
    let f = Fixture::new();
    f.add_folder("subsub", Some("sub"));
    let guest = f.session(&f.link(LinkRole::Editor, None), None);
    let err = f
        .links
        .update_folder(&guest, "sub", None, Some("subsub".into()))
        .unwrap_err();
    assert_eq!(err.status, 400);
}

#[actix_web::test]
async fn a_view_only_guest_cannot_write() {
    let f = Fixture::new();
    let guest = f.session(&f.link(LinkRole::Viewer, None), None);
    let err = f
        .links
        .create_folder(&guest, "shared", "x".into())
        .await
        .unwrap_err();
    assert_eq!(err.status, 403);
    assert_eq!(
        f.links.trash_file(&guest, "top.txt").unwrap_err().status,
        403
    );
    assert_eq!(f.links.upload_scope(&guest).unwrap_err().status, 403);
}
