use crate::drive::sharing::{
    dto::{
        GuestSessionResponse, ResolvedShareLinkResponse, ShareLinkResponse,
        UpdateShareLinkRequest, UpsertShareLinkRequest,
    },
    model::{NewShareLinkRecord, UpdateShareLinkRecord},
    repository::SharingRepository,
};
use crate::drive::permissions::service::PermissionsService;
use crate::drive::workspace::service::WorkspaceService;
use crate::shared::{ApiError, TokenService};
use chrono::{NaiveDateTime, Utc};
use std::sync::Arc;
use uuid::Uuid;

const GUEST_SESSION_EXPIRY_SECS: i64 = 3600;

pub struct SharingService {
    repo: Arc<SharingRepository>,
    permissions: Arc<PermissionsService>,
    workspace: Arc<WorkspaceService>,
    token_service: Arc<TokenService>,
}

impl SharingService {
    pub fn new(
        repo: Arc<SharingRepository>,
        permissions: Arc<PermissionsService>,
        workspace: Arc<WorkspaceService>,
        token_service: Arc<TokenService>,
    ) -> Self {
        SharingService { repo, permissions, workspace, token_service }
    }

    pub fn get_share_link(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<Option<ShareLinkResponse>, ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;
        let link = self.repo.find_by_resource(resource_type, resource_id)?;
        Ok(link.map(ShareLinkResponse::from))
    }

    /// Create or replace the share link for a resource.
    pub fn upsert_share_link(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: UpsertShareLinkRequest,
    ) -> Result<ShareLinkResponse, ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;
        // Check workspace policy: block external link sharing if configured
        self.workspace.check_link_sharing_allowed()?;

        let expires_at = req
            .expires_at
            .as_deref()
            .map(parse_datetime)
            .transpose()?;

        let id = Uuid::new_v4().to_string();
        let token = Uuid::new_v4().simple().to_string();

        let record = NewShareLinkRecord {
            id: &id,
            resource_type,
            resource_id,
            token: &token,
            visibility: req.visibility.as_str(),
            role: req.role.as_str(),
            expires_at,
            is_active: true,
            created_by: caller_id,
        };

        let link = self.repo.upsert_share_link(&record)?;
        Ok(ShareLinkResponse::from(link))
    }

    pub fn update_share_link(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
        req: UpdateShareLinkRequest,
    ) -> Result<ShareLinkResponse, ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;

        // Ensure a link exists
        self.repo
            .find_by_resource(resource_type, resource_id)?
            .ok_or_else(|| ApiError::not_found("Share link not found"))?;

        let expires_at = req
            .expires_at
            .map(|opt| opt.as_deref().map(parse_datetime).transpose())
            .transpose()?;

        let changeset = UpdateShareLinkRecord {
            visibility: req.visibility.map(|v| v.as_str().to_string()),
            role: req.role.map(|r| r.as_str().to_string()),
            expires_at,
            is_active: req.is_active,
            updated_at: Utc::now().naive_utc(),
        };

        let link = self
            .repo
            .update_share_link(resource_type, resource_id, changeset)?;
        Ok(ShareLinkResponse::from(link))
    }

    /// Disable link sharing by deleting the share link record.
    pub fn delete_share_link(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        self.require_owner(caller_id, resource_type, resource_id)?;
        let deleted = self.repo.delete_share_link(resource_type, resource_id)?;
        if deleted == 0 {
            return Err(ApiError::not_found("Share link not found"));
        }
        Ok(())
    }

    /// Public endpoint — resolve a share link by token. No auth required.
    pub fn resolve_token(&self, token: &str) -> Result<ResolvedShareLinkResponse, ApiError> {
        let link = self
            .repo
            .find_by_token(token)?
            .ok_or_else(|| ApiError::not_found("Share link not found"))?;

        if !link.is_active {
            return Err(ApiError::not_found("Share link is disabled"));
        }

        if let Some(expires_at) = link.expires_at {
            if expires_at < Utc::now().naive_utc() {
                return Err(ApiError::new(410, "LINK_EXPIRED", "Share link has expired"));
            }
        }

        let resource_name = self
            .repo
            .get_resource_name(&link.resource_type, &link.resource_id)?
            .unwrap_or_else(|| link.resource_id.clone());

        let mime_type = if link.resource_type == "file" {
            self.repo.get_file_mime_type(&link.resource_id)?
        } else {
            None
        };

        let domain_only = self.workspace.is_domain_only_links()?;
        let allowed_domain = if domain_only {
            self.workspace.get_allowed_domain()?
        } else {
            None
        };

        Ok(ResolvedShareLinkResponse {
            resource_type: link.resource_type,
            resource_id: link.resource_id,
            role: link.role,
            visibility: link.visibility,
            expires_at: link.expires_at.map(|dt| dt.to_string()),
            resource_name,
            mime_type,
            domain_only,
            allowed_domain,
        })
    }

    /// Exchange a valid share token for a short-lived guest session JWT.
    pub fn create_guest_session(&self, token: &str) -> Result<GuestSessionResponse, ApiError> {
        let link = self
            .repo
            .find_by_token(token)?
            .ok_or_else(|| ApiError::not_found("Share link not found"))?;

        if !link.is_active {
            return Err(ApiError::not_found("Share link is disabled"));
        }

        if let Some(expires_at) = link.expires_at {
            if expires_at < Utc::now().naive_utc() {
                return Err(ApiError::new(410, "LINK_EXPIRED", "Share link has expired"));
            }
        }

        let guest_user_id = format!("guest:{}", token);
        self.permissions.grant_guest_access(
            &link.resource_type,
            &link.resource_id,
            &guest_user_id,
            &link.role,
        )?;

        let access_token = self.token_service.generate_access_token_with_admin(
            &guest_user_id,
            "guest@share",
            false,
        )?;

        Ok(GuestSessionResponse {
            access_token,
            expires_in: GUEST_SESSION_EXPIRY_SECS,
            role: link.role,
        })
    }

    fn require_owner(
        &self,
        caller_id: &str,
        resource_type: &str,
        resource_id: &str,
    ) -> Result<(), ApiError> {
        let role = self
            .permissions
            .get_effective_role(caller_id, resource_type, resource_id)?;
        if role.as_deref() != Some("owner") {
            return Err(ApiError::new(
                403,
                "FORBIDDEN",
                "Only owners can manage share links",
            ));
        }
        Ok(())
    }
}

fn parse_datetime(s: &str) -> Result<NaiveDateTime, ApiError> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .map_err(|_| {
            ApiError::bad_request(
                "Invalid datetime format. Use ISO 8601, e.g. 2026-12-31T23:59:59",
            )
        })
}
