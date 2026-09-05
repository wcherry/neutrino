use crate::auth::service::AuthService;
use crate::drive::encryption::repository::EncryptionRepository;
use crate::drive::feature_flags::gate::FeatureGate;
use crate::drive::permissions::{
    dto::{
        GrantPermissionRequest, ListPermissionsResponse, PermissionResponse, Role,
        TransferOwnershipRequest, UpdatePermissionRequest,
    },
    model::NewPermissionRecord,
    repository::PermissionsRepository,
};
use crate::drive::teams::model::ShareRole;
use crate::drive::teams::service::{FLAG_TEAM_FILE_TRANSFERS, FLAG_TEAM_SPACES};
use crate::drive::workspace::service::WorkspaceService;
use crate::shared::{fetch_auth_profile, ApiError, AuthenticatedUser};
use std::sync::Arc;
use uuid::Uuid;

pub struct PermissionsService {
    repo: Arc<PermissionsRepository>,
    workspace: Arc<WorkspaceService>,
    encryption: Arc<EncryptionRepository>,
    auth_service: Arc<AuthService>,
    /// Consulted only for a file that actually has a team share — see
    /// [`Self::team_share_role`]. This is the hottest read in the product, and a flag lookup on
    /// every download for the sake of a table most files have no row in would be a real cost for
    /// no information.
    gate: FeatureGate,
}

impl PermissionsService {
    pub fn new(
        repo: Arc<PermissionsRepository>,
        workspace: Arc<WorkspaceService>,
        encryption: Arc<EncryptionRepository>,
        auth_service: Arc<AuthService>,
        gate: FeatureGate,
    ) -> Self {
        PermissionsService {
            repo,
            workspace,
            encryption,
            auth_service,
            gate,
        }
    }

    /// Auto-grants Owner role when a resource is created. Called internally by
    /// FilesystemService and StorageService.
    pub async fn grant_ownership(
        &self,
        user: &AuthenticatedUser,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        // Profile lookup is best-effort — email/name are display metadata only.
        // A failure here must not block ownership from being recorded.
        let (email, name) = match fetch_auth_profile(user, &self.auth_service) {
            Ok(profile) => (profile.email, profile.name),
            Err(e) => {
                tracing::warn!(
                    "Could not fetch profile for user {} during grant_ownership: {:?}",
                    user.user_id,
                    e
                );
                (String::new(), String::new())
            }
        };

        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &user.user_id,
            role: "owner",
            granted_by: &user.user_id,
            user_email: &email,
            user_name: &name,
        };
        self.repo.upsert_permission(&record)?;
        Ok(())
    }

    pub fn list_permissions(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<ListPermissionsResponse, ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can view permissions",
            ));
        }
        let records = self.repo.list_permissions(resource_type, resource_id)?;
        Ok(ListPermissionsResponse {
            permissions: records.into_iter().map(PermissionResponse::from).collect(),
        })
    }

    pub fn grant_permission(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: GrantPermissionRequest,
    ) -> Result<PermissionResponse, ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can grant permissions",
            ));
        }
        if req.role == Role::Owner {
            return Err(ApiError::bad_request(
                "Cannot grant Owner role directly. Use transfer-ownership instead.",
            ));
        }
        if req.user_id == caller_id {
            return Err(ApiError::bad_request(
                "Cannot change your own permission role.",
            ));
        }
        // Check workspace domain restriction before granting
        self.workspace.check_domain_for_sharing(&req.user_email)?;
        tracing::info!(
            "Sharing notification: granting {} role on {} {} to {} ({})",
            req.role.as_str(),
            resource_type,
            resource_id,
            req.user_email,
            req.user_id
        );
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &req.user_id,
            role: req.role.as_str(),
            granted_by: caller_id,
            user_email: &req.user_email,
            user_name: &req.user_name,
        };
        let perm = self.repo.upsert_permission(&record)?;
        Ok(PermissionResponse::from(perm))
    }

    pub fn update_permission(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        target_user_id: &str,
        req: UpdatePermissionRequest,
    ) -> Result<PermissionResponse, ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can update permissions",
            ));
        }
        if req.role == Role::Owner {
            return Err(ApiError::bad_request(
                "Cannot set Owner role directly. Use transfer-ownership instead.",
            ));
        }
        let existing = self
            .repo
            .find_permission(resource_type, resource_id, target_user_id)?
            .ok_or_else(|| ApiError::not_found("Permission not found"))?;

        if existing.role == "owner" {
            let owner_count = self.repo.count_owners(resource_type, resource_id)?;
            if owner_count <= 1 {
                return Err(ApiError::bad_request(
                    "Cannot change the role of the last owner",
                ));
            }
        }
        self.repo.update_permission_role(
            resource_type,
            resource_id,
            target_user_id,
            req.role.as_str(),
        )?;
        let updated = self
            .repo
            .find_permission(resource_type, resource_id, target_user_id)?
            .ok_or_else(|| ApiError::internal("Permission not found after update"))?;
        Ok(PermissionResponse::from(updated))
    }

    pub fn revoke_permission(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        target_user_id: &str,
    ) -> Result<(), ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can revoke permissions",
            ));
        }
        let existing = self
            .repo
            .find_permission(resource_type, resource_id, target_user_id)?
            .ok_or_else(|| ApiError::not_found("Permission not found"))?;

        if existing.role == "owner" {
            let owner_count = self.repo.count_owners(resource_type, resource_id)?;
            if owner_count <= 1 {
                return Err(ApiError::bad_request(
                    "Cannot revoke the last owner's access",
                ));
            }
        }
        let deleted = self
            .repo
            .delete_permission(resource_type, resource_id, target_user_id)?;
        if deleted == 0 {
            return Err(ApiError::not_found("Permission not found"));
        }
        if resource_type == "file" {
            if let Err(e) = self.encryption.delete_file_key(resource_id, target_user_id) {
                tracing::warn!("Failed to delete file_key_ref on revocation: {:?}", e);
            }
        }
        Ok(())
    }

    pub fn transfer_ownership(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: TransferOwnershipRequest,
    ) -> Result<(), ApiError> {
        let caller_role = self.get_effective_role(caller_id, resource_type, resource_id)?;
        if caller_role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can transfer ownership",
            ));
        }
        if req.new_owner_id == caller_id {
            return Err(ApiError::bad_request("You are already the owner"));
        }
        // Downgrade caller to editor
        self.repo
            .update_permission_role(resource_type, resource_id, caller_id, "editor")?;
        // Grant new owner (upsert so it works whether or not they had a prior permission)
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id: &req.new_owner_id,
            role: "owner",
            granted_by: caller_id,
            user_email: "",
            user_name: "",
        };
        self.repo.upsert_permission(&record)?;
        Ok(())
    }

    /// Grants a guest (share-link) user access to a resource without auth checks.
    pub fn grant_guest_access(
        &self,
        resource_type: &str,
        resource_id: &str,
        user_id: &str,
        role: &str,
    ) -> Result<(), ApiError> {
        let id = Uuid::new_v4().to_string();
        let record = NewPermissionRecord {
            id: &id,
            resource_type,
            resource_id,
            user_id,
            role,
            granted_by: "system",
            user_email: "",
            user_name: "Guest",
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
        // A team-owned file or folder is governed by the team, and nothing else (issue #185).
        //
        // Checked *first*, ahead of the explicit grants, because otherwise the grants outlive the
        // move. Every upload writes its uploader an `owner` permission row, so a file claimed into
        // a team would leave the person who happened to press upload as its Drive owner —
        // able to reshare a team's file outside the team, and holding an authority over it that
        // even the team's own Owner does not have. Any share made before the file joined the team
        // is stale for the same reason, and this makes it inert rather than honoured.
        //
        // The consequence, and it is intended: nobody is `owner` of a team file, so the individual
        // sharing endpoints refuse to operate on one. Sharing out of a team is not something this
        // phase does, and refusing is a better answer than a share that outlives the team's
        // membership.
        if let Some(team_role) = self.team_role_for_resource(user_id, resource_type, resource_id)? {
            return Ok(team_role);
        }

        if let Some(perm) = self
            .repo
            .find_permission(resource_type, resource_id, user_id)?
        {
            return Ok(Some(perm.role));
        }

        // A file its owner has lent to a team the caller is in (migration 00130). Third, and the
        // position is the rule:
        //
        // - *After* the explicit grant, because a grant names this person. Someone given `editor`
        //   individually does not drop to `viewer` because a team they are in was lent the file at
        //   `viewer`; the owner said both things and the more specific one is about them.
        // - *Before* the folder walk, because the share names this file, and an ancestor folder's
        //   grant is the least specific statement anyone made about it.
        if resource_type == "file" {
            if let Some(role) = self.team_share_role(user_id, resource_id)? {
                return Ok(Some(role));
            }
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

    /// The caller's role over a resource, *if* it belongs to a team.
    ///
    /// The two levels of `Option` carry two different facts, and collapsing them is the bug this
    /// shape exists to prevent:
    ///
    /// - `None` — not a team resource. Carry on to the grants and folder inheritance.
    /// - `Some(None)` — a team resource the caller is not a member of. **Stop.** No access, and
    ///   emphatically not a fall-through to the grants, where a stale personal share would let
    ///   them straight back in.
    /// - `Some(Some(role))` — a team resource and the caller's role in it.
    fn team_role_for_resource(
        &self,
        user_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<Option<String>>, ApiError> {
        let team_id = match resource_type {
            "file" => self.repo.get_file_team_id(resource_id)?,
            "folder" => self.repo.get_folder_team_id(resource_id)?,
            _ => None,
        };
        let Some(team_id) = team_id else {
            return Ok(None);
        };
        Ok(Some(self.role_from_team_membership(user_id, &team_id)?))
    }

    /// The Drive role a team member holds over the team's files and folders (issue #185).
    ///
    /// A team's library lives in the same `files` and `folders` tables as everything else, so
    /// letting membership answer here is what makes download, preview, thumbnails, file info and
    /// every other read that already asks this question work for a team's members — without any of
    /// them learning that teams exist.
    ///
    /// Checked *before* folder inheritance, and it short-circuits: a file in a team is governed by
    /// the team, and walking up to a personal folder's grants from inside a team's tree would let
    /// a share made before the file joined the team outlive the move.
    ///
    /// The six team roles collapse to the three Drive roles because that is all this vocabulary
    /// has. The mapping is deliberately conservative — `owner` is not granted to anyone, not even
    /// a team Owner, because a Drive "owner" may reshare a file and change its permissions, and
    /// authority over a team is not authority to hand its files to people outside it. Destructive
    /// team actions are checked against the real six-role matrix in `teams::service`, which is
    /// where deleting a team file is authorised; this only decides who may read and write one.
    fn role_from_team_membership(
        &self,
        user_id: &str,
        team_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let Some(team_role) = self.repo.find_team_role(team_id, user_id)? else {
            return Ok(None);
        };
        Ok(match team_role.as_str() {
            "owner" | "admin" | "editor" | "contributor" => Some("editor".to_string()),
            "viewer" | "guest" => Some("viewer".to_string()),
            // A role nothing recognises grants nothing — the same rule `teams::roles::Role::parse`
            // applies, for the same reason.
            _ => None,
        })
    }

    /// The role a file has been lent to the caller at, through any team they belong to.
    ///
    /// The rows are read *before* the flag, and only a hit reaches the gate. That ordering is
    /// deliberate and it is about cost, not correctness: `get_effective_role` runs on every
    /// download, preview, thumbnail and file-info request in the product, and the overwhelming
    /// majority of files have no row in `team_file_shares` at all. Asking the flag first would put
    /// a second lookup on every one of those requests to decide whether to do a lookup that will
    /// miss. Asking the flag second costs it only where there is something to gate.
    ///
    /// And it *is* gated, rather than left to grant access once written. `teamFileTransfers` is a
    /// kill switch, and a switch that stops new shares being created while every existing one goes
    /// on granting access is not one — turning it off has to close the access, or there is no
    /// answer to "a file is reachable through a team and it should not be".
    ///
    /// A team share never applies to a file the *team* owns: `get_effective_role` short-circuits on
    /// those before reaching here, and sharing requires `team_id IS NULL` in the first place.
    fn team_share_role(&self, user_id: &str, file_id: &str) -> Result<Option<String>, ApiError> {
        let roles = self.repo.list_team_share_roles(file_id, user_id)?;
        let Some(first) = roles.first() else {
            return Ok(None);
        };

        if !self.gate.is_enabled(FLAG_TEAM_SPACES)?
            || !self.gate.is_enabled(FLAG_TEAM_FILE_TRANSFERS)?
        {
            return Ok(None);
        }

        // Two teams may have been lent the same file at different roles; the stronger stands,
        // because both were things the owner chose to say.
        let strongest = roles
            .iter()
            .fold(first.as_str(), |acc, r| ShareRole::stronger(acc, r.as_str()));
        // A stored role nothing recognises grants nothing, the same rule `Role::parse` applies:
        // a typo must not become read access.
        Ok(ShareRole::parse(strongest).map(str::to_string))
    }

    fn get_effective_role_in_folder(
        &self,
        user_id: &str,
        folder_id: &str,
    ) -> Result<Option<String>, ApiError> {
        let mut current_id = folder_id.to_string();
        // Walk up at most 50 levels to prevent infinite loops on corrupt data
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

/// Tests for the one part of this that is not "read a row and return its role": the order in which
/// the sources of authority are consulted.
///
/// The order is the rule, not an implementation detail. Team ownership beats everything (a share
/// made before a file joined a team is stale, and honouring it would let it outlive the move), an
/// individual grant beats a team share (a grant names this person), a team share beats folder
/// inheritance (a share names this file), and `teamFileTransfers` off makes every share inert.
/// Each of those is a sentence somebody could reasonably have written the other way round, so each
/// gets a test rather than a comment.
#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::password_policy::PasswordPolicyRepository;
    use crate::auth::repository::AuthRepository;
    use crate::drive::feature_flags::repository::FeatureFlagsRepository;
    use crate::drive::permissions::repository::DbPool;
    use crate::drive::workspace::repository::WorkspaceRepository;
    use crate::schema::{
        feature_flags, files, folders, team_file_shares, team_members, teams, users,
    };
    use crate::shared::TokenService;
    use diesel::prelude::*;
    use diesel::r2d2::ConnectionManager;
    use diesel_migrations::MigrationHarness;

    struct Fixture {
        service: PermissionsService,
        pool: DbPool,
    }

    impl Fixture {
        /// Both team flags on, since a test that leaves them off is testing the gate — which
        /// `a_share_stops_granting_when_the_flag_goes_off` does deliberately.
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

            let flags_repo = Arc::new(FeatureFlagsRepository::new(pool.clone()));
            for key in [FLAG_TEAM_SPACES, FLAG_TEAM_FILE_TRANSFERS] {
                flags_repo.update(key, true).expect("enable flag");
            }

            let service = PermissionsService::new(
                Arc::new(PermissionsRepository::new(pool.clone())),
                Arc::new(WorkspaceService::new(Arc::new(WorkspaceRepository::new(
                    pool.clone(),
                )))),
                Arc::new(EncryptionRepository::new(pool.clone())),
                Arc::new(AuthService::new(
                    Arc::new(AuthRepository::new(pool.clone())),
                    Arc::new(TokenService::new("test-secret".into())),
                    Arc::new(PasswordPolicyRepository::new(pool.clone())),
                )),
                FeatureGate::new(flags_repo),
            );
            Fixture { service, pool }
        }

        fn conn(&self) -> diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>> {
            self.pool.get().expect("conn")
        }

        fn add_user(&self, id: &str) {
            diesel::insert_or_ignore_into(users::table)
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

        fn add_file(&self, id: &str, owner: &str, folder_id: Option<&str>) {
            self.add_user(owner);
            diesel::insert_into(files::table)
                .values((
                    files::id.eq(id),
                    files::user_id.eq(owner),
                    files::name.eq(id),
                    files::size_bytes.eq(10_i64),
                    files::mime_type.eq("text/plain"),
                    files::storage_path.eq(format!("/tmp/{id}")),
                    files::folder_id.eq(folder_id),
                ))
                .execute(&mut self.conn())
                .expect("insert file");
        }

        fn add_folder(&self, id: &str, owner: &str) {
            self.add_user(owner);
            diesel::insert_into(folders::table)
                .values((
                    folders::id.eq(id),
                    folders::user_id.eq(owner),
                    folders::name.eq(id),
                ))
                .execute(&mut self.conn())
                .expect("insert folder");
        }

        fn add_team(&self, id: &str, creator: &str) {
            self.add_user(creator);
            diesel::insert_into(teams::table)
                .values((
                    teams::id.eq(id),
                    teams::name.eq(id),
                    teams::slug.eq(id),
                    teams::visibility.eq("private"),
                    teams::created_by.eq(creator),
                ))
                .execute(&mut self.conn())
                .expect("insert team");
        }

        fn add_member(&self, team_id: &str, user_id: &str, role: &str) {
            self.add_user(user_id);
            diesel::insert_into(team_members::table)
                .values((
                    team_members::id.eq(format!("{team_id}-{user_id}")),
                    team_members::team_id.eq(team_id),
                    team_members::user_id.eq(user_id),
                    team_members::user_email.eq(format!("{user_id}@example.com")),
                    team_members::user_name.eq(user_id),
                    team_members::role.eq(role),
                    team_members::added_by.eq(user_id),
                ))
                .execute(&mut self.conn())
                .expect("insert member");
        }

        fn share(&self, team_id: &str, file_id: &str, role: &str, sharer: &str) {
            diesel::insert_into(team_file_shares::table)
                .values((
                    team_file_shares::id.eq(format!("{team_id}-{file_id}")),
                    team_file_shares::team_id.eq(team_id),
                    team_file_shares::file_id.eq(file_id),
                    team_file_shares::role.eq(role),
                    team_file_shares::shared_by.eq(sharer),
                ))
                .execute(&mut self.conn())
                .expect("insert share");
        }

        fn grant(&self, resource_type: &str, resource_id: &str, user_id: &str, role: &str) {
            self.service
                .repo
                .upsert_permission(&NewPermissionRecord {
                    id: &format!("{resource_id}-{user_id}"),
                    resource_type,
                    resource_id,
                    user_id,
                    role,
                    granted_by: "u1",
                    user_email: "",
                    user_name: "",
                })
                .expect("grant");
        }

        fn set_flag(&self, key: &str, on: bool) {
            diesel::update(feature_flags::table.filter(feature_flags::key.eq(key)))
                .set(feature_flags::enabled.eq(i32::from(on)))
                .execute(&mut self.conn())
                .expect("set flag");
        }

        fn role(&self, user_id: &str, file_id: &str) -> Option<String> {
            self.service
                .get_effective_role(user_id, "file", file_id)
                .expect("effective role")
        }
    }

    /// The base case: a file lent to a team is readable by that team's members, and by nobody else.
    #[test]
    fn a_team_share_grants_access_to_the_teams_members_only() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_member("t1", "u2", "viewer");
        f.add_user("u3");
        f.share("t1", "file-1", "viewer", "u1");

        assert_eq!(f.role("u2", "file-1").as_deref(), Some("viewer"));
        assert_eq!(f.role("u3", "file-1"), None, "not in the team");
    }

    /// The lent role is a ceiling for the whole team. A team Owner reading a file lent at `viewer`
    /// gets `viewer`: authority over a team is not authority over someone's personal file.
    #[test]
    fn the_lent_role_is_the_same_for_every_member_whatever_their_team_role() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_member("t1", "u2", "owner");
        f.add_member("t1", "u3", "guest");
        f.share("t1", "file-1", "viewer", "u1");

        assert_eq!(f.role("u2", "file-1").as_deref(), Some("viewer"));
        assert_eq!(f.role("u3", "file-1").as_deref(), Some("viewer"));
    }

    /// A grant names this person; a share names a group they happen to be in. The specific one
    /// stands, so being lent a file at `viewer` does not demote someone who was given `editor`.
    #[test]
    fn an_individual_grant_outranks_a_team_share() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_member("t1", "u2", "editor");
        f.share("t1", "file-1", "viewer", "u1");
        f.grant("file", "file-1", "u2", "editor");

        assert_eq!(f.role("u2", "file-1").as_deref(), Some("editor"));
    }

    /// A share names this file; an ancestor folder's grant is the vaguest thing anyone said about
    /// it. So a file lent at `editor` is editable even when the folder above it was shared
    /// read-only.
    #[test]
    fn a_team_share_outranks_folder_inheritance() {
        let f = Fixture::new();
        f.add_folder("folder-1", "u1");
        f.add_file("file-1", "u1", Some("folder-1"));
        f.add_team("t1", "u1");
        f.add_member("t1", "u2", "viewer");
        f.grant("folder", "folder-1", "u2", "viewer");
        f.share("t1", "file-1", "editor", "u1");

        assert_eq!(f.role("u2", "file-1").as_deref(), Some("editor"));
    }

    /// Lent to two teams the same person is in, the stronger role stands: both were things the
    /// owner chose to say, and picking the weaker would make the answer depend on row order.
    #[test]
    fn the_stronger_of_two_shares_wins() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_team("t2", "u1");
        f.add_member("t1", "u2", "viewer");
        f.add_member("t2", "u2", "viewer");
        f.share("t1", "file-1", "viewer", "u1");
        f.share("t2", "file-1", "editor", "u1");

        assert_eq!(f.role("u2", "file-1").as_deref(), Some("editor"));
    }

    /// The flag is a kill switch, not merely a stop on new shares. Turning it off has to close the
    /// access the existing rows grant, or there is no answer to "a file is reachable through a team
    /// and it should not be".
    #[test]
    fn a_share_stops_granting_when_either_flag_goes_off() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_member("t1", "u2", "viewer");
        f.share("t1", "file-1", "viewer", "u1");
        assert_eq!(f.role("u2", "file-1").as_deref(), Some("viewer"));

        f.set_flag(FLAG_TEAM_FILE_TRANSFERS, false);
        assert_eq!(f.role("u2", "file-1"), None);

        // And Team Spaces itself going off closes it too — a share is part of that feature.
        f.set_flag(FLAG_TEAM_FILE_TRANSFERS, true);
        f.set_flag(FLAG_TEAM_SPACES, false);
        assert_eq!(f.role("u2", "file-1"), None);
    }

    /// A stored role nothing recognises grants nothing — the same rule the team roles follow, for
    /// the same reason: a typo must not become read access.
    #[test]
    fn an_unrecognised_share_role_grants_nothing() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_member("t1", "u2", "viewer");
        f.share("t1", "file-1", "owner", "u1");

        assert_eq!(f.role("u2", "file-1"), None);
    }

    /// The file's own owner is unaffected by lending it: they still hold the grant the upload wrote
    /// them, and a share is not a transfer.
    #[test]
    fn lending_a_file_leaves_its_owner_the_owner() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.grant("file", "file-1", "u1", "owner");
        f.add_team("t1", "u1");
        f.add_member("t1", "u1", "owner");
        f.share("t1", "file-1", "viewer", "u1");

        assert_eq!(f.role("u1", "file-1").as_deref(), Some("owner"));
    }

    /// Team ownership still short-circuits ahead of everything, shares included. A file the team
    /// owns is governed by membership, and a lend of it — which the service will not create anyway
    /// — must not become a second, quieter way in.
    #[test]
    fn team_ownership_still_beats_a_stale_share() {
        let f = Fixture::new();
        f.add_file("file-1", "u1", None);
        f.add_team("t1", "u1");
        f.add_team("t2", "u1");
        f.add_member("t2", "u2", "viewer");
        f.share("t2", "file-1", "editor", "u1");

        // The file then joins t1, which u2 is not in.
        diesel::update(files::table.filter(files::id.eq("file-1")))
            .set(files::team_id.eq("t1"))
            .execute(&mut f.conn())
            .expect("claim");

        assert_eq!(f.role("u2", "file-1"), None);
    }
}
