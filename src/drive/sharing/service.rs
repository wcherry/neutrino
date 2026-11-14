use crate::drive::permissions::service::PermissionsService;
use crate::drive::sharing::{
    dto::{
        GuestSessionResponse, KeyRecipient, KeyRecipientsResponse, ResolvedShareLinkResponse,
        ShareLinkResponse, UnkeyedFilesResponse, UpdateShareLinkRequest, UpsertShareLinkRequest,
    },
    model::{
        file_key_subject, GuestSubject, NewShareLinkRecord, ShareLinkRecord,
        UpdateShareLinkRecord,
    },
    repository::SharingRepository,
};
use crate::drive::workspace::service::WorkspaceService;
use crate::shared::{ApiError, TokenService};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use base64::engine::general_purpose::{URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use chrono::{NaiveDateTime, Utc};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use uuid::Uuid;

const GUEST_SESSION_EXPIRY_SECS: i64 = 3600;

/// Wrong passwords allowed per link within [`ATTEMPT_WINDOW`] before the link answers 429.
const MAX_PASSWORD_FAILURES: u32 = 10;
const ATTEMPT_WINDOW: Duration = Duration::from_secs(15 * 60);

const MIN_PASSWORD_LEN: usize = 4;
const MAX_PASSWORD_LEN: usize = 256;

/// How many unkeyed files one `unkeyed-files` call returns.
const UNKEYED_PAGE: i64 = 200;

/// Wrong-password failures per link token, kept in memory.
///
/// Per process: a deployment running several instances multiplies the allowance by the instance
/// count. Argon2 already makes each guess expensive; this stops a single link being ground down.
#[derive(Default)]
struct AttemptLimiter {
    failures: Mutex<HashMap<String, (u32, Instant)>>,
}

impl AttemptLimiter {
    fn check(&self, key: &str) -> Result<(), ApiError> {
        let mut map = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((count, since)) = map.get(key).copied() {
            if since.elapsed() > ATTEMPT_WINDOW {
                map.remove(key);
            } else if count >= MAX_PASSWORD_FAILURES {
                return Err(ApiError::new(
                    429,
                    "TOO_MANY_ATTEMPTS",
                    "Too many wrong passwords. Try again later.",
                ));
            }
        }
        Ok(())
    }

    fn fail(&self, key: &str) {
        let mut map = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        let entry = map.entry(key.to_string()).or_insert((0, Instant::now()));
        if entry.1.elapsed() > ATTEMPT_WINDOW {
            *entry = (0, Instant::now());
        }
        entry.0 += 1;
    }

    fn clear(&self, key: &str) {
        let mut map = self.failures.lock().unwrap_or_else(|e| e.into_inner());
        map.remove(key);
    }
}

pub struct SharingService {
    repo: Arc<SharingRepository>,
    permissions: Arc<PermissionsService>,
    workspace: Arc<WorkspaceService>,
    token_service: Arc<TokenService>,
    attempts: AttemptLimiter,
}

impl SharingService {
    pub fn new(
        repo: Arc<SharingRepository>,
        permissions: Arc<PermissionsService>,
        workspace: Arc<WorkspaceService>,
        token_service: Arc<TokenService>,
    ) -> Self {
        SharingService {
            repo,
            permissions,
            workspace,
            token_service,
            attempts: AttemptLimiter::default(),
        }
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
    ///
    /// Replacing mints a new id and token, so the old URL stops working and the keys sealed to the
    /// old link are dropped.
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

        let expires_at = req.expires_at.as_deref().map(parse_datetime).transpose()?;
        let password_hash = match req.password.as_deref().filter(|p| !p.is_empty()) {
            Some(p) => Some(hash_link_password(p)?),
            None => None,
        };
        let public_key = req
            .public_key
            .as_deref()
            .map(validate_public_key)
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
            password_hash: password_hash.as_deref(),
            session_epoch: 0,
            public_key: public_key.as_deref(),
            sealed_seed: req.sealed_seed.as_deref(),
            sealed_seed_key_version: req.sealed_seed.as_ref().map(|_| req.sealed_seed_key_version.unwrap_or(1)),
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
        let existing = self
            .repo
            .find_by_resource(resource_type, resource_id)?
            .ok_or_else(|| ApiError::not_found("Share link not found"))?;

        let expires_at = req
            .expires_at
            .map(|opt| opt.as_deref().map(parse_datetime).transpose())
            .transpose()?;

        // Any password change, removal included, ends every session opened with the old one.
        let password_hash = match req.password {
            None => None,
            Some(None) => Some(None),
            Some(Some(p)) if p.is_empty() => Some(None),
            Some(Some(p)) => Some(Some(hash_link_password(&p)?)),
        };
        let session_epoch = password_hash
            .as_ref()
            .map(|_| existing.session_epoch + 1);

        let public_key = match req.public_key {
            None => None,
            Some(None) => Some(None),
            Some(Some(k)) => Some(Some(validate_public_key(&k)?)),
        };

        let sealed_seed_key_version = req
            .sealed_seed
            .as_ref()
            .map(|seed| seed.as_ref().map(|_| req.sealed_seed_key_version.unwrap_or(1)));

        let changeset = UpdateShareLinkRecord {
            visibility: req.visibility.map(|v| v.as_str().to_string()),
            role: req.role.map(|r| r.as_str().to_string()),
            expires_at,
            is_active: req.is_active,
            updated_at: Utc::now().naive_utc(),
            password_hash,
            session_epoch,
            public_key,
            sealed_seed: req.sealed_seed,
            sealed_seed_key_version,
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
    ///
    /// A link with a password says so and nothing else: not the name, the id or the role. Those
    /// come back from `create_guest_session` once the password has been given.
    pub fn resolve_token(&self, token: &str) -> Result<ResolvedShareLinkResponse, ApiError> {
        let link = self.live_link_by_token(token)?;

        let domain_only = self.workspace.is_domain_only_links()?;
        let allowed_domain = if domain_only {
            self.workspace.get_allowed_domain()?
        } else {
            None
        };

        if link.password_hash.is_some() {
            return Ok(ResolvedShareLinkResponse {
                password_required: true,
                resource_type: link.resource_type,
                resource_id: String::new(),
                role: String::new(),
                visibility: link.visibility,
                expires_at: None,
                resource_name: String::new(),
                mime_type: None,
                domain_only,
                allowed_domain,
            });
        }

        self.resolved(link, domain_only, allowed_domain)
    }

    /// Resolve for the public download and preview routes. A password-protected link needs a guest
    /// session for that same link, presented as the bearer (`caller`).
    pub fn resolve_for_download(
        &self,
        token: &str,
        caller: Option<&str>,
    ) -> Result<ResolvedShareLinkResponse, ApiError> {
        let link = self.live_link_by_token(token)?;
        if link.password_hash.is_some() && caller != Some(link.session_subject().as_str()) {
            return Err(ApiError::new(
                401,
                "SHARE_PASSWORD_REQUIRED",
                "This link needs a password",
            ));
        }
        self.resolved(link, false, None)
    }

    /// Exchange a valid share token (and its password, when it has one) for a short-lived guest
    /// session.
    ///
    /// Writes nothing: the session's subject names the link and its epoch, and
    /// `PermissionsService::get_effective_role` reads the live link on every request. Disabling,
    /// deleting, expiring or re-passwording the link therefore ends the session at once.
    pub fn create_guest_session(
        &self,
        token: &str,
        password: Option<&str>,
    ) -> Result<GuestSessionResponse, ApiError> {
        let link = self.live_link_by_token(token)?;

        if let Some(hash) = link.password_hash.as_deref() {
            self.attempts.check(token)?;
            let Some(given) = password.filter(|p| !p.is_empty()) else {
                return Err(ApiError::new(
                    401,
                    "SHARE_PASSWORD_REQUIRED",
                    "This link needs a password",
                ));
            };
            if !verify_link_password(given, hash) {
                self.attempts.fail(token);
                return Err(ApiError::new(
                    401,
                    "SHARE_PASSWORD_INVALID",
                    "That password is not right",
                ));
            }
            self.attempts.clear(token);
        }

        let access_token = self.token_service.generate_access_token_with_admin(
            &link.session_subject(),
            "guest@share",
            false,
        )?;

        let resource_name = self
            .repo
            .get_resource_name(&link.resource_type, &link.resource_id)?
            .unwrap_or_else(|| link.resource_id.clone());

        Ok(GuestSessionResponse {
            access_token,
            expires_in: GUEST_SESSION_EXPIRY_SECS,
            role: link.role.clone(),
            resource_type: link.resource_type.clone(),
            resource_id: link.resource_id.clone(),
            resource_name,
            key_subject: link.key_subject(),
            public_key: link.public_key.clone(),
        })
    }

    /// The live link a guest session belongs to, or 401 when the session no longer stands: not a
    /// guest, link gone, disabled, expired, or the password changed since it was issued.
    pub fn guest_link(&self, caller_id: &str) -> Result<ShareLinkRecord, ApiError> {
        let expired = || ApiError::unauthorized("This link session has ended");
        let subject = GuestSubject::parse(caller_id).ok_or_else(expired)?;
        let epoch = subject.epoch.ok_or_else(expired)?;
        let link = self
            .repo
            .find_by_id(&subject.link_id)?
            .ok_or_else(expired)?;
        if !link.is_live(Utc::now().naive_utc()) || link.session_epoch != epoch {
            return Err(expired());
        }
        Ok(link)
    }

    /// Who a new file in `folder_id` must have its key sealed to, besides the uploader: the folder's
    /// owner and every keyed folder link covering it. The caller needs edit access to the folder.
    pub fn key_recipients(
        &self,
        caller_id: &str,
        folder_id: &str,
    ) -> Result<KeyRecipientsResponse, ApiError> {
        let role = self
            .permissions
            .get_effective_role(caller_id, "folder", folder_id)?
            .ok_or_else(|| ApiError::new(403, "FORBIDDEN", "Access denied"))?;
        if role != "owner" && role != "editor" {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        let me = file_key_subject(caller_id);
        let mut recipients = Vec::new();

        if let Some(owner) = self.repo.folder_owner(folder_id)? {
            if owner != me {
                if let Some((public_key, key_version)) = self.repo.active_public_key(&owner)? {
                    recipients.push(KeyRecipient {
                        recipient_id: owner,
                        kind: "owner".into(),
                        public_key,
                        key_version,
                    });
                }
            }
        }

        for link in self.repo.keyed_links_covering_folder(folder_id)? {
            let subject = link.key_subject();
            if subject == me {
                continue;
            }
            if let Some(public_key) = link.public_key {
                recipients.push(KeyRecipient {
                    recipient_id: subject,
                    kind: "link".into(),
                    public_key,
                    // A link key is never rotated in place: a new key is a new link.
                    key_version: 1,
                });
            }
        }

        Ok(KeyRecipientsResponse { recipients })
    }

    /// Encrypted files under a folder's link that are not yet sealed to the link key. Owners only:
    /// the owner's browser opens each DEK and seals it to the link, then asks again until
    /// `hasMore` is false.
    pub fn unkeyed_files(
        &self,
        caller_id: &str,
        folder_id: &str,
    ) -> Result<UnkeyedFilesResponse, ApiError> {
        self.require_owner(caller_id, "folder", folder_id)?;
        let link = self
            .repo
            .find_by_resource("folder", folder_id)?
            .ok_or_else(|| ApiError::not_found("Share link not found"))?;
        let subject = link.key_subject();
        let folders = self.repo.subtree_folder_ids(folder_id)?;
        let file_ids = self.repo.unkeyed_files(&folders, &subject, UNKEYED_PAGE)?;
        Ok(UnkeyedFilesResponse {
            has_more: file_ids.len() as i64 >= UNKEYED_PAGE,
            key_subject: subject,
            public_key: link.public_key,
            file_ids,
        })
    }

    fn live_link_by_token(&self, token: &str) -> Result<ShareLinkRecord, ApiError> {
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
        Ok(link)
    }

    fn resolved(
        &self,
        link: ShareLinkRecord,
        domain_only: bool,
        allowed_domain: Option<String>,
    ) -> Result<ResolvedShareLinkResponse, ApiError> {
        let resource_name = self
            .repo
            .get_resource_name(&link.resource_type, &link.resource_id)?
            .unwrap_or_else(|| link.resource_id.clone());

        let mime_type = if link.resource_type == "file" {
            self.repo.get_file_mime_type(&link.resource_id)?
        } else {
            None
        };

        Ok(ResolvedShareLinkResponse {
            password_required: false,
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

fn hash_link_password(password: &str) -> Result<String, ApiError> {
    let len = password.chars().count();
    if !(MIN_PASSWORD_LEN..=MAX_PASSWORD_LEN).contains(&len) {
        return Err(ApiError::bad_request(&format!(
            "A link password must be {MIN_PASSWORD_LEN} to {MAX_PASSWORD_LEN} characters"
        )));
    }
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| {
            tracing::error!("Link password hashing error: {:?}", e);
            ApiError::internal("Failed to hash password")
        })?
        .to_string())
}

fn verify_link_password(password: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .map(|parsed| {
            Argon2::default()
                .verify_password(password.as_bytes(), &parsed)
                .is_ok()
        })
        .unwrap_or(false)
}

/// A link public key is a 32-byte X25519 key in base64url; normalised to unpadded.
fn validate_public_key(key: &str) -> Result<String, ApiError> {
    let bytes = URL_SAFE_NO_PAD
        .decode(key.trim_end_matches('='))
        .or_else(|_| URL_SAFE.decode(key))
        .map_err(|_| ApiError::bad_request("publicKey must be base64url"))?;
    if bytes.len() != 32 {
        return Err(ApiError::bad_request("publicKey must be a 32-byte X25519 key"));
    }
    Ok(URL_SAFE_NO_PAD.encode(bytes))
}

fn parse_datetime(s: &str) -> Result<NaiveDateTime, ApiError> {
    NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S")
        .or_else(|_| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S"))
        .map_err(|_| {
            ApiError::bad_request("Invalid datetime format. Use ISO 8601, e.g. 2026-12-31T23:59:59")
        })
}
