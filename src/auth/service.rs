use super::dto::{
    AdminCreateUserRequest, AdminUpdateUserRequest, AdminUserListResponse, AdminUserResponse,
    AuthResponse, ChangePasswordRequest, EmailPreferences, LoginResponse, PublicProfileResponse,
    RefreshRequest, RegisterRequest, RegisterResponse, SessionListResponse, SessionResponse,
    SocialLinks, TwoFactorDisableRequest, TwoFactorEnrollResponse, TwoFactorStatusResponse,
    UpdateProfileRequest, UserLookupResponse, UserProfileDetailsResponse, UserProfileResponse,
};
use super::password_policy::{
    password_expiry, validate_password, PasswordPolicyRecord, PasswordPolicyRepository,
    MAX_HISTORY_COUNT,
};
use super::repository::{
    AuthRepository, NewRefreshToken, NewTotpBackupCode, NewUser, UpsertUserProfile, User,
};
use super::tokens::{hash_token, TokenService};
use super::totp::{generate_otpauth_uri, generate_secret, verify_totp};

use super::dto::LoginRequest;
use crate::shared::ApiError;
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use rand::Rng;
use serde_json;
use std::sync::Arc;
use uuid::Uuid;

/// How long a soft-deleted account is kept before the worker purges it.
///
/// Deletion is two-stage: `delete_own_account` (or `admin_delete_user`) sets
/// `deleted_at`, which makes the account unreachable immediately, and the
/// background worker erases the rows and the stored files once this window has
/// closed. The worker enforces the same number from its own crate — see
/// `PURGE_GRACE_DAYS` in `worker/src/purge.rs`, which cannot import this one —
/// so the two must be changed together.
pub const PURGE_GRACE_DAYS: i64 = 30;

/// When an account soft-deleted at `deleted_at` becomes eligible for purging.
///
/// Sent to the admin console so the countdown it shows comes from the policy
/// rather than from a second copy of the number in the browser.
pub fn purge_after(deleted_at: chrono::NaiveDateTime) -> chrono::NaiveDateTime {
    deleted_at + chrono::Duration::days(PURGE_GRACE_DAYS)
}

/// How long a refresh token stays usable after it has been rotated away.
///
/// Refresh is rotating, so presenting a token retires it. Retiring it *and*
/// refusing it from that instant makes a client with two requests in flight
/// lose a race it cannot see coming — and the browser answers a failed refresh
/// by clearing the session, which is why a long-running Takeout import would
/// stop halfway with "Invalid refresh token". A short window absorbs the
/// concurrent presentation without letting a spent token live on: it is
/// measured from the first rotation, not from each replay.
pub const REFRESH_REUSE_GRACE_SECS: i64 = 60;

/// `REFRESH_REUSE_GRACE_SECS` as a `Duration`, for the repository call.
pub fn refresh_reuse_grace() -> chrono::Duration {
    chrono::Duration::seconds(REFRESH_REUSE_GRACE_SECS)
}

pub struct AuthService {
    repo: Arc<AuthRepository>,
    token_service: Arc<TokenService>,
    /// The workspace password rules, read wherever a password is set and by
    /// sign-in for the maximum-age check.
    password_policy: Arc<PasswordPolicyRepository>,
}

impl AuthService {
    pub fn new(
        repo: Arc<AuthRepository>,
        token_service: Arc<TokenService>,
        password_policy: Arc<PasswordPolicyRepository>,
    ) -> Self {
        AuthService {
            repo,
            token_service,
            password_policy,
        }
    }

    /// Hash a password with Argon2 after checking it against the policy.
    ///
    /// Every path that stores a password goes through here — registration, an
    /// admin creating an account, an admin resetting one, and a user changing
    /// their own — so no route can set a password the policy would refuse.
    fn hash_new_password(&self, password: &str) -> Result<String, ApiError> {
        let policy = self.password_policy.get()?;
        validate_password(password, &policy)?;

        let salt = SaltString::generate(&mut OsRng);
        Ok(Argon2::default()
            .hash_password(password.as_bytes(), &salt)
            .map_err(|e| {
                tracing::error!("Password hashing error: {:?}", e);
                ApiError::internal("Failed to hash password")
            })?
            .to_string())
    }

    /// Keep a password hash for the reuse check.
    ///
    /// Called on every path that stores a password, including the first one an
    /// account ever has: a history that only started at the *second* password
    /// would let the original be set again the moment the rule was turned on.
    ///
    /// Always the module's cap, never the policy's current count, so raising
    /// the count later still has history to check against.
    fn record_password(&self, user_id: &str, password_hash: &str) -> Result<(), ApiError> {
        self.repo
            .record_password_history(user_id, password_hash, MAX_HISTORY_COUNT as i64)
    }

    /// Refuse a password this account has used within the policy's window.
    ///
    /// Argon2 salts every hash, so this cannot be a lookup: the candidate is
    /// verified against each stored hash in turn. That is also why the count is
    /// capped — every comparison is a full Argon2 hash, deliberately slow.
    fn check_password_not_reused(&self, user_id: &str, password: &str) -> Result<(), ApiError> {
        let policy = self.password_policy.get()?;
        if policy.history_count <= 0 {
            return Ok(());
        }

        let recent = self
            .repo
            .recent_password_hashes(user_id, policy.history_count as i64)?;
        let reused = recent.iter().any(|stored| {
            PasswordHash::new(stored)
                .map(|parsed| {
                    Argon2::default()
                        .verify_password(password.as_bytes(), &parsed)
                        .is_ok()
                })
                // A hash that will not parse is a row we cannot compare against,
                // not a match. Refusing every password over one bad row would
                // lock the account out of changing its own password.
                .unwrap_or(false)
        });

        if reused {
            return Err(ApiError::bad_request(format!(
                "This password has been used before. Choose one that is not among the last {} passwords on this account.",
                policy.history_count
            )));
        }
        Ok(())
    }

    /// Count a sign-in that got the password wrong, locking the account if that
    /// reaches the policy's threshold.
    ///
    /// The caller still answers with the same "invalid email or password" it
    /// gives an unknown address. Saying "that attempt locked the account" at the
    /// moment of the failure would confirm the address has an account, and would
    /// confirm it to precisely whoever was guessing at the password.
    fn count_failed_login(&self, user: &User) -> Result<(), ApiError> {
        let policy = self.password_policy.get()?;
        if policy.lockout_threshold <= 0 {
            return Ok(());
        }

        let attempts = self.repo.record_failed_login(&user.id)?;
        if attempts >= policy.lockout_threshold && user.locked_out_at.is_none() {
            tracing::warn!(
                "Locking account {} after {} failed sign-in attempts",
                user.id,
                attempts
            );
            self.repo.lock_out_user(&user.id)?;
        }
        Ok(())
    }

    pub fn register(&self, req: RegisterRequest) -> Result<RegisterResponse, ApiError> {
        if req.email.is_empty() {
            return Err(ApiError::bad_request("Email is required"));
        }
        if req.name.is_empty() {
            return Err(ApiError::bad_request("Name is required"));
        }

        let password_hash = self.hash_new_password(&req.password)?;

        if self.repo.find_user_by_email(&req.email)?.is_some() {
            return Err(ApiError::conflict("Email already registered"));
        }

        let user_id = Uuid::new_v4().to_string();
        let new_user = NewUser {
            id: &user_id,
            email: &req.email,
            name: &req.name,
            password_hash: &password_hash,
            role: None,
            password_changed_at: Some(Utc::now().naive_utc()),
            password_expired_at: None,
        };

        let user = self.repo.create_user(new_user)?;
        self.record_password(&user.id, &password_hash)?;

        Ok(RegisterResponse {
            id: user.id,
            email: user.email,
            name: user.name,
        })
    }

    pub fn login(
        &self,
        req: LoginRequest,
        device_name: Option<String>,
        user_agent: Option<String>,
        ip_address: Option<String>,
    ) -> Result<LoginResponse, ApiError> {
        let user = self
            .repo
            .find_user_by_email(&req.email)?
            .ok_or_else(|| ApiError::unauthorized("Invalid email or password"))?;

        let parsed_hash = PasswordHash::new(&user.password_hash).map_err(|e| {
            tracing::error!("Password hash parse error: {:?}", e);
            ApiError::internal("Authentication error")
        })?;

        if Argon2::default()
            .verify_password(req.password.as_bytes(), &parsed_hash)
            .is_err()
        {
            self.count_failed_login(&user)?;
            return Err(ApiError::unauthorized("Invalid email or password"));
        }

        // Checked only once the password is known to be right: refusing a
        // disabled, locked or expired account before that would let anyone learn
        // which addresses have accounts, and in what state, without a password.
        if user.disabled_at.is_some() {
            return Err(ApiError::new(
                403,
                "ACCOUNT_DISABLED",
                "This account has been disabled. Contact an administrator.",
            ));
        }
        if user.locked_out_at.is_some() {
            return Err(ApiError::new(
                403,
                "ACCOUNT_LOCKED",
                "This account is locked after too many failed sign-in attempts. Contact an administrator.",
            ));
        }
        if self.is_password_expired(&user)? {
            return Err(ApiError::new(
                403,
                "PASSWORD_EXPIRED",
                "This password has expired. Set a new one to sign in.",
            ));
        }

        // The run of failures is over, so it stops counting towards a lockout —
        // a typo today and a typo next week are not one attack. Written only
        // when there is something to clear, so an ordinary sign-in stays a read.
        if user.failed_login_attempts > 0 {
            self.repo.clear_lockout(&user.id)?;
        }

        // Check if 2FA is required
        if user.totp_enabled == 1 {
            match &req.totp_code {
                None => {
                    return Ok(LoginResponse {
                        auth: None,
                        requires_two_factor: true,
                    });
                }
                Some(code) => {
                    let secret = user
                        .totp_secret
                        .as_deref()
                        .ok_or_else(|| ApiError::internal("TOTP configuration error"))?;
                    if !verify_totp(secret, code) {
                        return Err(ApiError::unauthorized("Invalid two-factor code"));
                    }
                }
            }
        }

        let is_admin = user.role == "admin";
        let access_token =
            self.token_service
                .generate_access_token_with_admin(&user.id, &user.email, is_admin)?;
        let (refresh_token_raw, expires_at) = self.token_service.generate_refresh_token()?;
        let token_hash = hash_token(&refresh_token_raw);

        let token_id = Uuid::new_v4().to_string();
        self.repo.create_refresh_token(NewRefreshToken {
            id: &token_id,
            user_id: &user.id,
            token_hash: &token_hash,
            expires_at,
            device_name: device_name.as_deref(),
            user_agent: user_agent.as_deref(),
            ip_address: ip_address.as_deref(),
        })?;

        Ok(LoginResponse {
            auth: Some(AuthResponse {
                access_token,
                refresh_token: refresh_token_raw.to_string(),
                token_type: "Bearer".to_string(),
                expires_in: self.token_service.access_expiry_secs(),
            }),
            requires_two_factor: false,
        })
    }

    pub fn refresh(&self, req: RefreshRequest) -> Result<AuthResponse, ApiError> {
        let token_hash = hash_token(&req.refresh_token);

        let now = Utc::now().naive_utc();
        let stored_token =
            self.repo
                .consume_refresh_token(&token_hash, now, refresh_reuse_grace())?;

        let user = self
            .repo
            .find_user_by_id(&stored_token.user_id)?
            .ok_or_else(|| ApiError::unauthorized("User not found"))?;

        // Disabling revokes the account's refresh tokens, so this is the
        // belt to that braces: a token issued a moment before the lock-out, or
        // one this instance has not seen revoked, must not mint a new session.
        if user.disabled_at.is_some() {
            return Err(ApiError::new(
                403,
                "ACCOUNT_DISABLED",
                "This account has been disabled. Contact an administrator.",
            ));
        }

        let is_admin = user.role == "admin";
        let access_token =
            self.token_service
                .generate_access_token_with_admin(&user.id, &user.email, is_admin)?;
        let (new_refresh_token_raw, new_expires_at) =
            self.token_service.generate_refresh_token()?;
        let new_token_hash = hash_token(&new_refresh_token_raw);

        let token_id = Uuid::new_v4().to_string();
        self.repo.create_refresh_token(NewRefreshToken {
            id: &token_id,
            user_id: &user.id,
            token_hash: &new_token_hash,
            expires_at: new_expires_at,
            device_name: stored_token.device_name.as_deref(),
            user_agent: stored_token.user_agent.as_deref(),
            ip_address: stored_token.ip_address.as_deref(),
        })?;

        Ok(AuthResponse {
            access_token,
            refresh_token: new_refresh_token_raw.to_string(),
            token_type: "Bearer".to_string(),
            expires_in: self.token_service.access_expiry_secs(),
        })
    }

    pub fn get_profile(&self, user_id: &str) -> Result<UserProfileResponse, ApiError> {
        let user = self
            .repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        Ok(UserProfileResponse {
            id: user.id,
            email: user.email,
            name: user.name,
            created_at: user.created_at,
            role: user.role,
            totp_enabled: user.totp_enabled == 1,
        })
    }

    pub fn lookup_user_by_email(
        &self,
        email: &str,
    ) -> Result<Option<UserLookupResponse>, ApiError> {
        let user = self.repo.find_user_by_email(email)?;
        Ok(user.map(|u| UserLookupResponse {
            id: u.id,
            email: u.email,
            name: u.name,
        }))
    }

    pub fn search_users(&self, query: &str) -> Result<Vec<UserLookupResponse>, ApiError> {
        let users = self.repo.search_users(query, 10)?;
        Ok(users.into_iter().map(|u| UserLookupResponse {
            id: u.id,
            email: u.email,
            name: u.name,
        }).collect())
    }

    pub fn get_user_by_id(&self, user_id: &str) -> Result<Option<UserLookupResponse>, ApiError> {
        let user = self.repo.find_user_by_id(user_id)?;
        Ok(user.map(|u| UserLookupResponse {
            id: u.id,
            email: u.email,
            name: u.name,
        }))
    }

    // ── 2FA ───────────────────────────────────────────────────────────────────

    pub fn get_two_factor_status(
        &self,
        user_id: &str,
    ) -> Result<TwoFactorStatusResponse, ApiError> {
        let user = self
            .repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        Ok(TwoFactorStatusResponse {
            enabled: user.totp_enabled == 1,
        })
    }

    pub fn enroll_two_factor(
        &self,
        user_id: &str,
        email: &str,
    ) -> Result<TwoFactorEnrollResponse, ApiError> {
        let secret = generate_secret();
        let otpauth_uri = generate_otpauth_uri(&secret, email, "Neutrino")
            .map_err(|e| ApiError::internal(&format!("TOTP error: {e}")))?;

        // Store secret (not yet enabled)
        self.repo.update_user_totp(user_id, Some(&secret), false)?;

        // Generate 10 backup codes
        let mut rng = rand::thread_rng();
        let mut plaintext_codes = Vec::new();
        let mut db_codes = Vec::new();
        let argon2 = Argon2::default();

        for _ in 0..10 {
            let code: String = format!("{:08x}", rng.gen::<u32>());
            let salt = SaltString::generate(&mut OsRng);
            let hash = argon2
                .hash_password(code.as_bytes(), &salt)
                .map_err(|_| ApiError::internal("Failed to hash backup code"))?
                .to_string();
            plaintext_codes.push(code.clone());
            db_codes.push((Uuid::new_v4().to_string(), hash));
        }

        let new_codes: Vec<NewTotpBackupCode> = db_codes
            .iter()
            .map(|(id, hash): &(String, String)| NewTotpBackupCode {
                id: id.as_str(),
                user_id,
                code_hash: hash.as_str(),
            })
            .collect();

        self.repo.create_backup_codes(new_codes)?;

        Ok(TwoFactorEnrollResponse {
            otpauth_uri,
            secret: secret.clone(),
            backup_codes: plaintext_codes,
        })
    }

    pub fn confirm_two_factor(&self, user_id: &str, code: &str) -> Result<(), ApiError> {
        let user = self
            .repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;

        let secret = user
            .totp_secret
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("2FA enrollment not started"))?;

        if !verify_totp(secret, code) {
            return Err(ApiError::bad_request("Invalid verification code"));
        }

        self.repo.update_user_totp(user_id, Some(secret), true)?;
        Ok(())
    }

    pub fn disable_two_factor(
        &self,
        user_id: &str,
        req: TwoFactorDisableRequest,
    ) -> Result<(), ApiError> {
        let user = self
            .repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;

        let parsed_hash = PasswordHash::new(&user.password_hash)
            .map_err(|_| ApiError::internal("Authentication error"))?;
        Argon2::default()
            .verify_password(req.password.as_bytes(), &parsed_hash)
            .map_err(|_| ApiError::unauthorized("Invalid password"))?;

        let secret = user
            .totp_secret
            .as_deref()
            .ok_or_else(|| ApiError::bad_request("2FA is not enabled"))?;
        if !verify_totp(secret, &req.code) {
            return Err(ApiError::unauthorized("Invalid two-factor code"));
        }

        self.repo.update_user_totp(user_id, None, false)?;
        Ok(())
    }

    // ── Sessions ──────────────────────────────────────────────────────────────

    pub fn list_sessions(&self, user_id: &str) -> Result<SessionListResponse, ApiError> {
        let tokens = self.repo.list_refresh_tokens_for_user(user_id)?;
        let sessions = tokens
            .into_iter()
            .map(|t| SessionResponse {
                id: t.id,
                device_name: t.device_name,
                user_agent: t.user_agent,
                ip_address: t.ip_address.map(|ip| anonymize_ip(&ip)),
                created_at: t.created_at,
                last_used_at: t.last_used_at,
            })
            .collect();
        Ok(SessionListResponse { sessions })
    }

    pub fn revoke_session(&self, user_id: &str, session_id: &str) -> Result<(), ApiError> {
        // Verify the session belongs to this user by checking the token list
        let tokens = self.repo.list_refresh_tokens_for_user(user_id)?;
        let belongs = tokens.iter().any(|t| t.id == session_id);
        if !belongs {
            return Err(ApiError::not_found("Session not found"));
        }
        self.repo.delete_refresh_token(session_id)
    }

    pub fn revoke_all_sessions(&self, user_id: &str) -> Result<(), ApiError> {
        self.repo.delete_all_refresh_tokens_for_user(user_id)
    }

    // ── Password expiry ───────────────────────────────────────────────────────

    /// Whether this account's password is currently refused at sign-in.
    ///
    /// Two rules, either of which is enough: an admin forced it to expire, or
    /// the policy's maximum age has passed since it was set. They are folded
    /// together here so no caller has to remember both.
    fn is_password_expired(&self, user: &User) -> Result<bool, ApiError> {
        if user.password_expired_at.is_some() {
            return Ok(true);
        }
        let policy = self.password_policy.get()?;
        Ok(Self::expiry_of(user, &policy).is_some_and(|at| at <= Utc::now().naive_utc()))
    }

    fn expiry_of(user: &User, policy: &PasswordPolicyRecord) -> Option<chrono::NaiveDateTime> {
        password_expiry(user.password_changed_at, policy)
    }

    /// Build the admin view of a user, resolving both expiry rules against the
    /// policy passed in — the caller reads the policy once per listing rather
    /// than once per row.
    fn admin_view(user: User, policy: &PasswordPolicyRecord) -> AdminUserResponse {
        let expires_at = Self::expiry_of(&user, policy);
        AdminUserResponse {
            purge_after: user.deleted_at.map(purge_after),
            password_expired: user.password_expired_at.is_some()
                || expires_at.is_some_and(|at| at <= Utc::now().naive_utc()),
            password_expires_at: expires_at,
            password_changed_at: user.password_changed_at,
            disabled_at: user.disabled_at,
            locked_out_at: user.locked_out_at,
            failed_login_attempts: user.failed_login_attempts,
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            totp_enabled: user.totp_enabled == 1,
            created_at: user.created_at,
            deleted_at: user.deleted_at,
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn admin_list_users(
        &self,
        page: i64,
        page_size: i64,
        include_deleted: bool,
    ) -> Result<AdminUserListResponse, ApiError> {
        let page_size = page_size.clamp(1, 100);
        let page = page.max(1);
        let (users, total) = self.repo.list_users(page, page_size, include_deleted)?;
        let policy = self.password_policy.get()?;
        let items = users
            .into_iter()
            .map(|u| Self::admin_view(u, &policy))
            .collect();
        Ok(AdminUserListResponse {
            users: items,
            total,
            page,
            page_size,
        })
    }

    pub fn admin_get_user(&self, user_id: &str) -> Result<AdminUserResponse, ApiError> {
        let user = self
            .repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        let policy = self.password_policy.get()?;
        Ok(Self::admin_view(user, &policy))
    }

    /// Create a fully registered account on an admin's behalf.
    ///
    /// Everything self-serve registration produces — the same validation, the
    /// same policy check, the same live account — plus the two things only an
    /// admin can decide up front: the role, and whether the password they chose
    /// must be replaced before the account can sign in.
    ///
    /// The caller still seeds the default folders, exactly as the registration
    /// handler does; this returns the account so it can.
    pub fn admin_create_user(
        &self,
        req: AdminCreateUserRequest,
    ) -> Result<RegisterResponse, ApiError> {
        let email = req.email.trim();
        let name = req.name.trim();
        if email.is_empty() {
            return Err(ApiError::bad_request("Email is required"));
        }
        if name.is_empty() {
            return Err(ApiError::bad_request("Name is required"));
        }
        let role = req.role.as_deref().unwrap_or("user");
        if role != "user" && role != "admin" {
            return Err(ApiError::bad_request("Role must be 'user' or 'admin'"));
        }

        let password_hash = self.hash_new_password(&req.password)?;

        if self.repo.find_user_by_email(email)?.is_some() {
            return Err(ApiError::conflict("Email already registered"));
        }

        let now = Utc::now().naive_utc();
        let user_id = Uuid::new_v4().to_string();
        let user = self.repo.create_user(NewUser {
            id: &user_id,
            email,
            name,
            password_hash: &password_hash,
            role: Some(role),
            password_changed_at: Some(now),
            // Expired from the outset when asked for, so the password the admin
            // typed — and therefore knows — cannot become the one the account
            // keeps using.
            password_expired_at: req.require_password_change.unwrap_or(false).then_some(now),
        })?;
        self.record_password(&user.id, &password_hash)?;

        Ok(RegisterResponse {
            id: user.id,
            email: user.email,
            name: user.name,
        })
    }

    /// Change a password by proving knowledge of the current one.
    ///
    /// Unauthenticated on purpose: an expired password is refused at sign-in,
    /// so there is no token to authenticate the change with. The proof is the
    /// same one sign-in takes — the current password, and a two-factor code if
    /// the account has it — and a disabled account is refused outright, since
    /// setting a new password must not be a way back into one.
    pub fn change_password(&self, req: ChangePasswordRequest) -> Result<(), ApiError> {
        let user = self
            .repo
            .find_user_by_email(&req.email)?
            .ok_or_else(|| ApiError::unauthorized("Invalid email or password"))?;

        let parsed_hash = PasswordHash::new(&user.password_hash).map_err(|e| {
            tracing::error!("Password hash parse error: {:?}", e);
            ApiError::internal("Authentication error")
        })?;
        Argon2::default()
            .verify_password(req.current_password.as_bytes(), &parsed_hash)
            .map_err(|_| ApiError::unauthorized("Invalid email or password"))?;

        if user.disabled_at.is_some() {
            return Err(ApiError::new(
                403,
                "ACCOUNT_DISABLED",
                "This account has been disabled. Contact an administrator.",
            ));
        }
        // Same reasoning as a disabled account: choosing a new password must not
        // be a way out of a lockout, or the threshold would be advisory.
        if user.locked_out_at.is_some() {
            return Err(ApiError::new(
                403,
                "ACCOUNT_LOCKED",
                "This account is locked after too many failed sign-in attempts. Contact an administrator.",
            ));
        }

        if user.totp_enabled == 1 {
            let code = req
                .totp_code
                .as_deref()
                .ok_or_else(|| ApiError::unauthorized("Two-factor code required"))?;
            let secret = user
                .totp_secret
                .as_deref()
                .ok_or_else(|| ApiError::internal("TOTP configuration error"))?;
            if !verify_totp(secret, code) {
                return Err(ApiError::unauthorized("Invalid two-factor code"));
            }
        }

        // Refused rather than accepted as a no-op: re-setting the same password
        // would clear the expiry and hand back exactly the password that was
        // expired, which is the one outcome expiring it was meant to prevent.
        if Argon2::default()
            .verify_password(req.new_password.as_bytes(), &parsed_hash)
            .is_ok()
        {
            return Err(ApiError::bad_request(
                "The new password must be different from the current one",
            ));
        }
        // The policy's own version of that rule, reaching back over however many
        // passwords it is set to. Checked before hashing, so a refused password
        // costs one Argon2 pass per stored hash and no write at all.
        self.check_password_not_reused(&user.id, &req.new_password)?;

        let password_hash = self.hash_new_password(&req.new_password)?;
        self.repo.update_user_password(&user.id, &password_hash)?;
        self.record_password(&user.id, &password_hash)?;
        // Every session predates the change, and a password is changed after a
        // scare as often as on a schedule.
        self.repo.delete_all_refresh_tokens_for_user(&user.id)
    }

    /// Undoes a soft delete, whoever performed it.
    ///
    /// Only meaningful inside the grace window: after the worker's purge there
    /// is no row left, so this reports 404 exactly as it would for an id that
    /// never existed — which is the honest answer, since nothing can bring that
    /// account back. Restoring an account that is not deleted is refused rather
    /// than treated as a no-op, so an admin double-clicking Restore on a stale
    /// page learns the list moved under them.
    pub fn admin_restore_user(&self, user_id: &str) -> Result<AdminUserResponse, ApiError> {
        let user = self
            .repo
            .find_user_by_id_including_deleted(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        if user.deleted_at.is_none() {
            return Err(ApiError::bad_request("User is not deleted"));
        }
        self.repo.restore_user(user_id)?;
        self.admin_get_user(user_id)
    }

    /// Apply an admin's edits to one account.
    ///
    /// Every field is optional and applied independently, so the console can
    /// send one change at a time. Validation happens before anything is
    /// written, so a request carrying one good field and one bad one changes
    /// nothing rather than half of what was asked.
    pub fn admin_update_user(
        &self,
        user_id: &str,
        req: AdminUpdateUserRequest,
    ) -> Result<AdminUserResponse, ApiError> {
        // Confirms the account exists before any of the writes below, which are
        // updates by id and would otherwise report success having matched no
        // rows.
        self.repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;

        if let Some(ref role) = req.role {
            if role != "user" && role != "admin" {
                return Err(ApiError::bad_request("Role must be 'user' or 'admin'"));
            }
        }
        let new_name = match req.name {
            Some(ref name) if name.trim().is_empty() => {
                return Err(ApiError::bad_request("Name cannot be empty"))
            }
            Some(ref name) => Some(name.trim().to_string()),
            None => None,
        };
        // Hashed — and so policy-checked, reuse included — before the first
        // write, for the same reason: a password the policy refuses must not
        // leave a role change applied behind it.
        if let Some(ref password) = req.password {
            self.check_password_not_reused(user_id, password)?;
        }
        let new_password_hash = req
            .password
            .as_deref()
            .map(|p| self.hash_new_password(p))
            .transpose()?;

        if let Some(role) = req.role {
            self.repo.update_user_role(user_id, &role)?;
        }
        if let Some(name) = new_name {
            self.repo.update_user_name(user_id, &name)?;
        }
        if let Some(enabled) = req.totp_enabled {
            if !enabled {
                // Admin force-disabling 2FA
                self.repo.update_user_totp(user_id, None, false)?;
            }
        }
        if let Some(disabled) = req.disabled {
            self.repo.set_user_disabled(user_id, disabled)?;
            if disabled {
                // The access token they hold stays valid until it expires;
                // leaving them a refresh token would let them mint another and
                // work on past the lock-out.
                self.repo.delete_all_refresh_tokens_for_user(user_id)?;
            }
        }
        // Unlock before any password reset, so an admin doing both in one
        // request does not have the reset's own clear undone by an explicit
        // `unlock: false` arriving in the same body.
        if let Some(unlock) = req.unlock {
            if unlock {
                self.repo.clear_lockout(user_id)?;
            }
        }
        if let Some(hash) = new_password_hash {
            self.repo.update_user_password(user_id, &hash)?;
            self.record_password(user_id, &hash)?;
            // The failures that locked this account were against a password
            // that no longer exists, so the count that survives them would be
            // counting nothing. Same reasoning as `update_user_password`
            // clearing a forced expiry.
            self.repo.clear_lockout(user_id)?;
            self.repo.delete_all_refresh_tokens_for_user(user_id)?;
        }
        // Applied after any password reset, so an admin can set a password
        // *and* require the user to replace it in one request; the reset clears
        // the expiry the flag then puts back.
        if let Some(expire) = req.expire_password {
            self.repo.set_password_expired(user_id, expire)?;
            if expire {
                self.repo.delete_all_refresh_tokens_for_user(user_id)?;
            }
        }
        self.admin_get_user(user_id)
    }

    /// Soft-deletes an account on an admin's behalf, starting the same
    /// [`PURGE_GRACE_DAYS`] countdown a self-delete starts.
    ///
    /// Refresh tokens go too, for the reason spelled out on
    /// `delete_own_account`: the target's access token stays valid until it
    /// expires, and leaving them a refresh token lets them mint a new one and
    /// carry on working in an account an admin has just removed.
    pub fn admin_delete_user(&self, user_id: &str) -> Result<(), ApiError> {
        self.repo.soft_delete_user(user_id)?;
        self.repo.delete_all_refresh_tokens_for_user(user_id)
    }

    // ── Self-Serve Deletion ───────────────────────────────────────────────────

    /// Deletes the caller's own account — what Settings → Account → Delete
    /// account is behind.
    ///
    /// The row is soft-deleted, the same state `admin_delete_user` leaves a
    /// user in: every lookup filters on `deleted_at IS NULL`, so the account
    /// can no longer sign in or be found. Refresh tokens are then dropped,
    /// because the access token the caller is still holding stays valid until
    /// it expires — without this they could quietly mint a fresh one and keep
    /// the session alive past the deletion.
    ///
    /// Looking the user up first is what turns a repeat call into a 404
    /// instead of a silent success: `soft_delete_user` updates by id and an
    /// update matching no rows is not an error in Diesel.
    pub fn delete_own_account(&self, user_id: &str) -> Result<(), ApiError> {
        self.repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        self.repo.soft_delete_user(user_id)?;
        self.repo.delete_all_refresh_tokens_for_user(user_id)
    }

    // ── User Profile ──────────────────────────────────────────────────────────

    pub fn get_public_profile(&self, user_id: &str) -> Result<PublicProfileResponse, ApiError> {
        let user = self
            .repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;
        let profile = self.repo.get_user_profile(user_id)?;
        let (bio, avatar, profile_image, website, social_links, language, country) = match profile {
            None => (None, None, None, None, SocialLinks::default(), None, None),
            Some(p) => {
                let sl = p
                    .social_links
                    .as_deref()
                    .and_then(|s| serde_json::from_str(s).ok())
                    .map(SocialLinks)
                    .unwrap_or_default();
                (
                    p.bio,
                    p.avatar,
                    p.profile_image,
                    p.website,
                    sl,
                    p.language,
                    p.country,
                )
            }
        };
        Ok(PublicProfileResponse {
            user_id: user.id,
            name: user.name,
            bio,
            avatar,
            profile_image,
            website,
            social_links,
            language,
            country,
        })
    }

    pub fn get_extended_profile(
        &self,
        user_id: &str,
    ) -> Result<UserProfileDetailsResponse, ApiError> {
        // Verify user exists
        self.repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;

        let profile = self.repo.get_user_profile(user_id)?;
        Ok(profile_to_response(user_id, profile))
    }

    pub fn update_extended_profile(
        &self,
        user_id: &str,
        req: UpdateProfileRequest,
    ) -> Result<UserProfileDetailsResponse, ApiError> {
        // Verify user exists
        self.repo
            .find_user_by_id(user_id)?
            .ok_or_else(|| ApiError::not_found("User not found"))?;

        // The name is the one field here that belongs to the user row, not the
        // profile row. Validated before anything is written so a rejected name
        // does not leave the rest of the patch applied behind it.
        let new_name = match req.name {
            Some(ref name) if name.trim().is_empty() => {
                return Err(ApiError::bad_request("Name cannot be empty"))
            }
            Some(ref name) => Some(name.trim().to_string()),
            None => None,
        };

        // Load existing profile (or defaults) to merge with the patch
        let existing = self.repo.get_user_profile(user_id)?;
        let defaults = EmailPreferences::default();

        let (cur_marketing, cur_general, cur_updates, cur_critical) = match &existing {
            Some(p) => (
                p.email_marketing,
                p.email_general,
                p.email_updates,
                p.email_critical,
            ),
            None => (
                defaults.marketing as i32,
                defaults.general as i32,
                defaults.updates as i32,
                defaults.critical as i32,
            ),
        };

        let email_prefs = req.email_preferences.unwrap_or(EmailPreferences {
            marketing: cur_marketing != 0,
            general: cur_general != 0,
            updates: cur_updates != 0,
            critical: cur_critical != 0,
        });

        let social_json = req
            .social_links
            .as_ref()
            .map(|sl| serde_json::to_string(&sl.0))
            .transpose()
            .map_err(|e| {
                tracing::error!("Failed to serialize social_links: {:?}", e);
                ApiError::internal("Failed to serialize social links")
            })?;

        let now = chrono::Utc::now().naive_utc();
        let upsert = UpsertUserProfile {
            user_id,
            theme: req.theme.as_deref(),
            bio: req.bio.as_deref(),
            avatar: req.avatar.as_deref(),
            profile_image: req.profile_image.as_deref(),
            website: req.website.as_deref(),
            social_links: social_json.as_deref(),
            language: req.language.as_deref(),
            timezone: req.timezone.as_deref(),
            country: req.country.as_deref(),
            email_marketing: email_prefs.marketing as i32,
            email_general: email_prefs.general as i32,
            email_updates: email_prefs.updates as i32,
            email_critical: email_prefs.critical as i32,
            updated_at: now,
        };

        let saved = self.repo.upsert_user_profile(upsert)?;

        if let Some(ref name) = new_name {
            self.repo.update_user_name(user_id, name)?;
        }

        Ok(profile_to_response(user_id, Some(saved)))
    }

    // ── E2EE key management ───────────────────────────────────────────────────

    /// Publish a new identity version. See `AuthRepository::publish_public_key`
    /// for why this appends rather than overwrites.
    pub fn publish_public_key(
        &self,
        user_id: &str,
        public_key: &str,
    ) -> Result<super::repository::UserPublicKey, ApiError> {
        self.repo.publish_public_key(user_id, public_key)
    }

    /// Every version `user_id` has published, oldest first.
    pub fn list_public_keys(
        &self,
        user_id: &str,
    ) -> Result<Vec<super::repository::UserPublicKey>, ApiError> {
        self.repo.list_public_keys(user_id)
    }
}

fn profile_to_response(
    user_id: &str,
    profile: Option<super::repository::UserProfile>,
) -> UserProfileDetailsResponse {
    let defaults = EmailPreferences::default();
    match profile {
        None => UserProfileDetailsResponse {
            user_id: user_id.to_string(),
            theme: None,
            bio: None,
            avatar: None,
            profile_image: None,
            website: None,
            social_links: SocialLinks::default(),
            language: None,
            timezone: None,
            country: None,
            email_preferences: defaults,
        },
        Some(p) => {
            let social_links = p
                .social_links
                .as_deref()
                .and_then(|s| serde_json::from_str(s).ok())
                .map(SocialLinks)
                .unwrap_or_default();

            UserProfileDetailsResponse {
                user_id: p.user_id,
                theme: p.theme,
                bio: p.bio,
                avatar: p.avatar,
                profile_image: p.profile_image,
                website: p.website,
                social_links,
                language: p.language,
                timezone: p.timezone,
                country: p.country,
                email_preferences: EmailPreferences {
                    marketing: p.email_marketing != 0,
                    general: p.email_general != 0,
                    updates: p.email_updates != 0,
                    critical: p.email_critical != 0,
                },
            }
        }
    }
}

fn anonymize_ip(ip: &str) -> String {
    // Strip last octet from IPv4 for privacy
    if let Some(pos) = ip.rfind('.') {
        format!("{}.xxx", &ip[..pos])
    } else {
        ip.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::password_policy::repository::PasswordPolicyUpdate;
    // use crate::auth::repository::AuthRepository;
    // use crate::auth::tokens::TokenService;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;

    fn make_test_pool() -> Pool<ConnectionManager<SqliteConnection>> {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .test_on_check_out(true)
            .build(manager)
            .expect("Failed to create test pool");
        pool.get()
            .unwrap()
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("Failed to run migrations");
        pool
    }

    fn make_service() -> AuthService {
        let pool = make_test_pool();
        let token_service = Arc::new(TokenService::new_with_expiry(
            "test-secret-key".to_string(),
            900,
            604800,
        ));
        make_service_with_policy().0
    }

    /// The service and the policy repository behind it, for the tests that have
    /// to tighten a rule before exercising it.
    fn make_service_with_policy() -> (AuthService, Arc<PasswordPolicyRepository>) {
        let pool = make_test_pool();
        let token_service = Arc::new(TokenService::new_with_expiry(
            "test-secret-key".to_string(),
            900,
            604800,
        ));
        let repo = Arc::new(AuthRepository::new(pool.clone()));
        let policy = Arc::new(PasswordPolicyRepository::new(pool));
        (
            AuthService::new(repo, token_service, policy.clone()),
            policy,
        )
    }

    fn reg(email: &str, password: &str, name: &str) -> RegisterRequest {
        RegisterRequest {
            email: email.to_string(),
            password: password.to_string(),
            name: name.to_string(),
        }
    }

    fn login_req(email: &str, password: &str) -> LoginRequest {
        LoginRequest {
            email: email.to_string(),
            password: password.to_string(),
            totp_code: None,
        }
    }

    /// An admin edit that changes nothing, to spread the one field under test
    /// over. Every field is optional and independent, so spelling them all out
    /// at each call site would bury the change being made.
    fn admin_update() -> AdminUpdateUserRequest {
        AdminUpdateUserRequest {
            name: None,
            role: None,
            totp_enabled: None,
            disabled: None,
            expire_password: None,
            password: None,
            unlock: None,
        }
    }

    // ── register ──────────────────────────────────────────────────────────────

    #[test]
    fn register_success_returns_user_info() {
        let svc = make_service();
        let resp = svc
            .register(reg("alice@test.com", "password123", "Alice"))
            .unwrap();
        assert_eq!(resp.email, "alice@test.com");
        assert_eq!(resp.name, "Alice");
        assert!(!resp.id.is_empty());
    }

    #[test]
    fn register_empty_email_returns_400() {
        let svc = make_service();
        let err = svc.register(reg("", "password123", "Alice")).unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn register_password_too_short_returns_400() {
        let svc = make_service();
        let err = svc
            .register(reg("alice@test.com", "short", "Alice"))
            .unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn register_empty_name_returns_400() {
        let svc = make_service();
        let err = svc
            .register(reg("alice@test.com", "password123", ""))
            .unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn register_duplicate_email_returns_409() {
        let svc = make_service();
        svc.register(reg("dup@test.com", "password123", "First"))
            .unwrap();
        let err = svc
            .register(reg("dup@test.com", "password456", "Second"))
            .unwrap_err();
        assert_eq!(err.status, 409);
    }

    // ── login ─────────────────────────────────────────────────────────────────

    #[test]
    fn login_success_returns_tokens() {
        let svc = make_service();
        svc.register(reg("bob@test.com", "mypassword", "Bob"))
            .unwrap();
        let resp = svc
            .login(login_req("bob@test.com", "mypassword"), None, None, None)
            .unwrap();
        assert!(!resp.requires_two_factor);
        let auth = resp.auth.unwrap();
        assert!(!auth.access_token.is_empty());
        assert!(!auth.refresh_token.is_empty());
        assert_eq!(auth.token_type, "Bearer");
    }

    #[test]
    fn login_wrong_password_returns_401() {
        let svc = make_service();
        svc.register(reg("carol@test.com", "correct-password", "Carol"))
            .unwrap();
        let err = svc
            .login(
                login_req("carol@test.com", "wrongpassword"),
                None,
                None,
                None,
            )
            .unwrap_err();
        assert_eq!(err.status, 401);
    }

    #[test]
    fn login_unknown_user_returns_401() {
        let svc = make_service();
        let err = svc
            .login(login_req("nobody@test.com", "anything"), None, None, None)
            .unwrap_err();
        assert_eq!(err.status, 401);
    }

    // ── refresh ───────────────────────────────────────────────────────────────

    #[test]
    fn refresh_with_valid_token_returns_new_tokens() {
        let svc = make_service();
        svc.register(reg("dave@test.com", "password123", "Dave"))
            .unwrap();
        let login_resp = svc
            .login(login_req("dave@test.com", "password123"), None, None, None)
            .unwrap();
        let old_refresh = login_resp.auth.unwrap().refresh_token;

        let result = svc
            .refresh(RefreshRequest {
                refresh_token: old_refresh.clone(),
            })
            .unwrap();
        assert!(!result.access_token.is_empty());
        assert_ne!(result.refresh_token, old_refresh, "Token should be rotated");
    }

    #[test]
    fn refresh_with_invalid_token_returns_401() {
        let svc = make_service();
        let err = svc
            .refresh(RefreshRequest {
                refresh_token: "fake-token".to_string(),
            })
            .unwrap_err();
        assert_eq!(err.status, 401);
    }

    #[test]
    fn refresh_token_presented_twice_at_once_is_honoured_both_times() {
        // Rotation used to make the second presentation a 401, which is a race
        // any client with two requests in flight loses — and a failed refresh
        // signs the user out. A Takeout import, which runs for hours across a
        // fifteen-minute access token, hit it every time. Inside
        // `REFRESH_REUSE_GRACE_SECS` both callers get a usable session; the
        // window closing is `refresh_token_is_refused_once_its_grace_expires`
        // in the repository tests, which can name the clock.
        let svc = make_service();
        svc.register(reg("eve@test.com", "password123", "Eve"))
            .unwrap();
        let login_resp = svc
            .login(login_req("eve@test.com", "password123"), None, None, None)
            .unwrap();
        let refresh_token = login_resp.auth.unwrap().refresh_token;

        let first = svc
            .refresh(RefreshRequest {
                refresh_token: refresh_token.clone(),
            })
            .unwrap();
        let second = svc
            .refresh(RefreshRequest {
                refresh_token: refresh_token.clone(),
            })
            .unwrap();

        assert_ne!(first.refresh_token, refresh_token);
        assert_ne!(second.refresh_token, refresh_token);
        assert_ne!(
            first.refresh_token, second.refresh_token,
            "each caller should leave with a token of its own"
        );
        // Both successors are live sessions, so whichever one the client
        // happens to store keeps working.
        for token in [first.refresh_token, second.refresh_token] {
            svc.refresh(RefreshRequest {
                refresh_token: token,
            })
            .unwrap();
        }
    }

    // ── get_profile ───────────────────────────────────────────────────────────

    #[test]
    fn get_profile_returns_correct_data() {
        let svc = make_service();
        let reg_resp = svc
            .register(reg("frank@test.com", "password123", "Frank"))
            .unwrap();
        let profile = svc.get_profile(&reg_resp.id).unwrap();
        assert_eq!(profile.email, "frank@test.com");
        assert_eq!(profile.name, "Frank");
        assert_eq!(profile.role, "user");
        assert!(!profile.totp_enabled);
    }

    #[test]
    fn get_profile_nonexistent_user_returns_404() {
        let svc = make_service();
        let err = svc.get_profile("nonexistent-id-xyz").unwrap_err();
        assert_eq!(err.status, 404);
    }

    // ── sessions ──────────────────────────────────────────────────────────────

    #[test]
    fn list_sessions_returns_one_after_login() {
        let svc = make_service();
        svc.register(reg("grace@test.com", "password123", "Grace"))
            .unwrap();
        svc.login(
            login_req("grace@test.com", "password123"),
            Some("iPhone".into()),
            None,
            None,
        )
        .unwrap();
        let user = svc.lookup_user_by_email("grace@test.com").unwrap().unwrap();
        let sessions = svc.list_sessions(&user.id).unwrap();
        assert_eq!(sessions.sessions.len(), 1);
    }

    #[test]
    fn revoke_session_removes_it() {
        let svc = make_service();
        svc.register(reg("henry@test.com", "password123", "Henry"))
            .unwrap();
        svc.login(login_req("henry@test.com", "password123"), None, None, None)
            .unwrap();
        let user = svc.lookup_user_by_email("henry@test.com").unwrap().unwrap();
        let sessions = svc.list_sessions(&user.id).unwrap();
        let session_id = sessions.sessions[0].id.clone();

        svc.revoke_session(&user.id, &session_id).unwrap();
        assert!(svc.list_sessions(&user.id).unwrap().sessions.is_empty());
    }

    // ── admin ─────────────────────────────────────────────────────────────────

    #[test]
    fn admin_list_users_clamps_page_and_size() {
        let svc = make_service();
        let result = svc.admin_list_users(0, 200, false).unwrap();
        assert_eq!(result.page, 1, "page < 1 should be clamped to 1");
        assert_eq!(
            result.page_size, 100,
            "page_size > 100 should be clamped to 100"
        );
    }

    #[test]
    fn admin_update_user_invalid_role_returns_400() {
        let svc = make_service();
        let reg_resp = svc
            .register(reg("admin@test.com", "password123", "Admin"))
            .unwrap();
        let err = svc
            .admin_update_user(
                &reg_resp.id,
                AdminUpdateUserRequest {
                    role: Some("superuser".to_string()),
                    ..admin_update()
                },
            )
            .unwrap_err();
        assert_eq!(err.status, 400);
    }

    // ── admin: creating an account ────────────────────────────────────────────

    fn create_req(email: &str, password: &str) -> AdminCreateUserRequest {
        AdminCreateUserRequest {
            email: email.to_string(),
            name: "Created".to_string(),
            password: password.to_string(),
            role: None,
            require_password_change: None,
        }
    }

    /// "Fully registered" is the whole point: the account an admin makes must
    /// be able to sign in, not wait for an invitation to be completed.
    #[test]
    fn an_admin_created_account_can_sign_in_immediately() {
        let svc = make_service();
        let created = svc
            .admin_create_user(create_req("made@test.com", "password123"))
            .expect("create");
        assert_eq!(created.email, "made@test.com");
        let resp = svc
            .login(login_req("made@test.com", "password123"), None, None, None)
            .expect("login");
        assert!(resp.auth.is_some());
    }

    #[test]
    fn an_admin_created_account_takes_the_role_it_was_given() {
        let svc = make_service();
        let created = svc
            .admin_create_user(AdminCreateUserRequest {
                role: Some("admin".to_string()),
                ..create_req("boss@test.com", "password123")
            })
            .expect("create");
        assert_eq!(svc.admin_get_user(&created.id).expect("get").role, "admin");
    }

    #[test]
    fn an_admin_cannot_invent_a_role() {
        let svc = make_service();
        let err = svc
            .admin_create_user(AdminCreateUserRequest {
                role: Some("superuser".to_string()),
                ..create_req("odd@test.com", "password123")
            })
            .unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn an_admin_cannot_reuse_an_address() {
        let svc = make_service();
        svc.register(reg("taken@test.com", "password123", "First"))
            .expect("register");
        let err = svc
            .admin_create_user(create_req("taken@test.com", "password456"))
            .unwrap_err();
        assert_eq!(err.status, 409);
    }

    /// The password an admin types is one they know, so requiring a change is
    /// what stops it staying the account's password.
    #[test]
    fn requiring_a_password_change_expires_the_password_at_once() {
        let svc = make_service();
        let created = svc
            .admin_create_user(AdminCreateUserRequest {
                require_password_change: Some(true),
                ..create_req("fresh@test.com", "password123")
            })
            .expect("create");
        assert!(svc.admin_get_user(&created.id).expect("get").password_expired);

        let err = svc
            .login(login_req("fresh@test.com", "password123"), None, None, None)
            .unwrap_err();
        assert_eq!(err.code, "PASSWORD_EXPIRED");

        svc.change_password(ChangePasswordRequest {
            email: "fresh@test.com".to_string(),
            current_password: "password123".to_string(),
            new_password: "adifferentpassword".to_string(),
            totp_code: None,
        })
        .expect("change");
        assert!(svc
            .login(
                login_req("fresh@test.com", "adifferentpassword"),
                None,
                None,
                None
            )
            .expect("login")
            .auth
            .is_some());
    }

    // ── admin: locking an account out ─────────────────────────────────────────

    #[test]
    fn a_disabled_account_cannot_sign_in_and_keeps_no_sessions() {
        let svc = make_service();
        let created = svc
            .register(reg("locked@test.com", "password123", "Locked"))
            .expect("register");
        let session = svc
            .login(login_req("locked@test.com", "password123"), None, None, None)
            .expect("login")
            .auth
            .expect("tokens");

        let view = svc
            .admin_update_user(
                &created.id,
                AdminUpdateUserRequest {
                    disabled: Some(true),
                    ..admin_update()
                },
            )
            .expect("disable");
        assert!(view.disabled_at.is_some());

        let err = svc
            .login(login_req("locked@test.com", "password123"), None, None, None)
            .unwrap_err();
        assert_eq!(err.status, 403);
        assert_eq!(err.code, "ACCOUNT_DISABLED");

        // The refresh token they were holding must not mint a new session.
        let err = svc
            .refresh(RefreshRequest {
                refresh_token: session.refresh_token,
            })
            .unwrap_err();
        assert!(err.status == 401 || err.status == 403, "{}", err);
    }

    /// A lock-out is not a deletion: re-enabling gives the same account back,
    /// password and all.
    #[test]
    fn re_enabling_an_account_lets_it_sign_in_again() {
        let svc = make_service();
        let created = svc
            .register(reg("back@test.com", "password123", "Back"))
            .expect("register");
        svc.admin_update_user(
            &created.id,
            AdminUpdateUserRequest {
                disabled: Some(true),
                ..admin_update()
            },
        )
        .expect("disable");
        svc.admin_update_user(
            &created.id,
            AdminUpdateUserRequest {
                disabled: Some(false),
                ..admin_update()
            },
        )
        .expect("enable");
        assert!(svc
            .login(login_req("back@test.com", "password123"), None, None, None)
            .expect("login")
            .auth
            .is_some());
    }

    // ── admin: expiring and resetting a password ──────────────────────────────

    #[test]
    fn expiring_a_password_refuses_sign_in_until_it_is_changed() {
        let svc = make_service();
        let created = svc
            .register(reg("stale@test.com", "password123", "Stale"))
            .expect("register");
        svc.admin_update_user(
            &created.id,
            AdminUpdateUserRequest {
                expire_password: Some(true),
                ..admin_update()
            },
        )
        .expect("expire");

        let err = svc
            .login(login_req("stale@test.com", "password123"), None, None, None)
            .unwrap_err();
        assert_eq!(err.code, "PASSWORD_EXPIRED");
    }

    /// Setting the expired password again would clear the expiry and hand back
    /// exactly the password that was expired.
    #[test]
    fn a_password_change_must_actually_change_the_password() {
        let svc = make_service();
        svc.register(reg("same@test.com", "password123", "Same"))
            .expect("register");
        let err = svc
            .change_password(ChangePasswordRequest {
                email: "same@test.com".to_string(),
                current_password: "password123".to_string(),
                new_password: "password123".to_string(),
                totp_code: None,
            })
            .unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn a_password_change_needs_the_current_password() {
        let svc = make_service();
        svc.register(reg("proof@test.com", "password123", "Proof"))
            .expect("register");
        let err = svc
            .change_password(ChangePasswordRequest {
                email: "proof@test.com".to_string(),
                current_password: "not-it".to_string(),
                new_password: "anotherpassword".to_string(),
                totp_code: None,
            })
            .unwrap_err();
        assert_eq!(err.status, 401);
    }

    /// Setting a new password must not be a way back into an account an admin
    /// has locked.
    #[test]
    fn a_disabled_account_cannot_change_its_password() {
        let svc = make_service();
        let created = svc
            .register(reg("shut@test.com", "password123", "Shut"))
            .expect("register");
        svc.admin_update_user(
            &created.id,
            AdminUpdateUserRequest {
                disabled: Some(true),
                ..admin_update()
            },
        )
        .expect("disable");
        let err = svc
            .change_password(ChangePasswordRequest {
                email: "shut@test.com".to_string(),
                current_password: "password123".to_string(),
                new_password: "anotherpassword".to_string(),
                totp_code: None,
            })
            .unwrap_err();
        assert_eq!(err.code, "ACCOUNT_DISABLED");
    }

    #[test]
    fn an_admin_reset_password_is_the_one_that_works() {
        let svc = make_service();
        let created = svc
            .register(reg("reset@test.com", "password123", "Reset"))
            .expect("register");
        svc.admin_update_user(
            &created.id,
            AdminUpdateUserRequest {
                password: Some("brandnewpassword".to_string()),
                ..admin_update()
            },
        )
        .expect("reset");

        assert!(svc
            .login(login_req("reset@test.com", "password123"), None, None, None)
            .is_err());
        assert!(svc
            .login(
                login_req("reset@test.com", "brandnewpassword"),
                None,
                None,
                None
            )
            .expect("login")
            .auth
            .is_some());
    }

    /// One request can both set a password and require it to be replaced —
    /// which only works if the expiry is applied after the reset that clears it.
    #[test]
    fn a_reset_can_be_expired_in_the_same_request() {
        let svc = make_service();
        let created = svc
            .register(reg("both@test.com", "password123", "Both"))
            .expect("register");
        let view = svc
            .admin_update_user(
                &created.id,
                AdminUpdateUserRequest {
                    password: Some("temporarypassword".to_string()),
                    expire_password: Some(true),
                    ..admin_update()
                },
            )
            .expect("reset and expire");
        assert!(view.password_expired);
    }

    /// A refused field must not leave the accepted ones half-applied.
    #[test]
    fn an_edit_with_a_bad_field_changes_nothing() {
        let svc = make_service();
        let created = svc
            .register(reg("atomic@test.com", "password123", "Atomic"))
            .expect("register");
        let err = svc
            .admin_update_user(
                &created.id,
                AdminUpdateUserRequest {
                    role: Some("admin".to_string()),
                    password: Some("short".to_string()),
                    ..admin_update()
                },
            )
            .unwrap_err();
        assert_eq!(err.code, "PASSWORD_POLICY");
        assert_eq!(
            svc.admin_get_user(&created.id).expect("get").role,
            "user",
            "the role must not have moved",
        );
    }

    // ── policy: forbidden characters ──────────────────────────────────────────

    #[test]
    fn a_password_containing_a_forbidden_character_is_refused() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                forbidden_characters: Some("<>&".to_string()),
                ..Default::default()
            })
            .expect("policy");

        let err = svc
            .register(reg("angle@test.com", "pass<word>here", "Angle"))
            .unwrap_err();
        assert_eq!(err.code, "PASSWORD_POLICY");
        assert!(
            svc.register(reg("plain@test.com", "passwordhere", "Plain"))
                .is_ok(),
            "a password clear of the set must still be accepted",
        );
    }

    // ── policy: lockout after failed sign-ins ─────────────────────────────────

    #[test]
    fn the_account_locks_after_the_threshold_of_failed_sign_ins() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                lockout_threshold: Some(3),
                ..Default::default()
            })
            .expect("policy");
        svc.register(reg("lock@test.com", "password123", "Lock"))
            .expect("register");

        for _ in 0..3 {
            let err = svc
                .login(login_req("lock@test.com", "wrongpassword"), None, None, None)
                .unwrap_err();
            assert_eq!(
                err.status, 401,
                "a failed attempt must not announce the lockout it caused",
            );
        }

        // The *right* password now, and it is refused — which is the whole
        // point of the rule.
        let err = svc
            .login(login_req("lock@test.com", "password123"), None, None, None)
            .unwrap_err();
        assert_eq!(err.status, 403);
        assert_eq!(err.code, "ACCOUNT_LOCKED");
    }

    /// A typo today and a typo next week are not one attack.
    #[test]
    fn a_successful_sign_in_ends_the_run_of_failures() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                lockout_threshold: Some(3),
                ..Default::default()
            })
            .expect("policy");
        let created = svc
            .register(reg("reset@test.com", "password123", "Reset"))
            .expect("register");

        for _ in 0..2 {
            assert!(svc
                .login(
                    login_req("reset@test.com", "wrongpassword"),
                    None,
                    None,
                    None
                )
                .is_err());
        }
        svc.login(login_req("reset@test.com", "password123"), None, None, None)
            .expect("login");
        assert_eq!(
            svc.admin_get_user(&created.id)
                .expect("get")
                .failed_login_attempts,
            0,
        );

        // Two more failures would have locked it had the count survived.
        for _ in 0..2 {
            assert!(svc
                .login(
                    login_req("reset@test.com", "wrongpassword"),
                    None,
                    None,
                    None
                )
                .is_err());
        }
        assert!(svc
            .login(login_req("reset@test.com", "password123"), None, None, None)
            .is_ok());
    }

    #[test]
    fn no_threshold_means_failures_never_lock_the_account() {
        let svc = make_service();
        svc.register(reg("free@test.com", "password123", "Free"))
            .expect("register");
        for _ in 0..10 {
            assert!(svc
                .login(login_req("free@test.com", "wrongpassword"), None, None, None)
                .is_err());
        }
        assert!(svc
            .login(login_req("free@test.com", "password123"), None, None, None)
            .is_ok());
    }

    #[test]
    fn an_admin_unlocks_a_locked_account() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                lockout_threshold: Some(2),
                ..Default::default()
            })
            .expect("policy");
        let created = svc
            .register(reg("unlock@test.com", "password123", "Unlock"))
            .expect("register");
        for _ in 0..2 {
            assert!(svc
                .login(
                    login_req("unlock@test.com", "wrongpassword"),
                    None,
                    None,
                    None
                )
                .is_err());
        }
        assert!(svc
            .admin_get_user(&created.id)
            .expect("get")
            .locked_out_at
            .is_some());

        let view = svc
            .admin_update_user(
                &created.id,
                AdminUpdateUserRequest {
                    unlock: Some(true),
                    ..admin_update()
                },
            )
            .expect("unlock");
        assert!(view.locked_out_at.is_none());
        assert_eq!(view.failed_login_attempts, 0);
        assert!(svc
            .login(login_req("unlock@test.com", "password123"), None, None, None)
            .is_ok());
    }

    /// The failures were against a password that no longer exists, so the reset
    /// that replaced it releases the account too.
    #[test]
    fn an_admin_password_reset_releases_the_lockout() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                lockout_threshold: Some(2),
                ..Default::default()
            })
            .expect("policy");
        let created = svc
            .register(reg("relock@test.com", "password123", "Relock"))
            .expect("register");
        for _ in 0..2 {
            assert!(svc
                .login(
                    login_req("relock@test.com", "wrongpassword"),
                    None,
                    None,
                    None
                )
                .is_err());
        }

        let view = svc
            .admin_update_user(
                &created.id,
                AdminUpdateUserRequest {
                    password: Some("anotherpassword".to_string()),
                    ..admin_update()
                },
            )
            .expect("reset");
        assert!(view.locked_out_at.is_none());
        assert!(svc
            .login(
                login_req("relock@test.com", "anotherpassword"),
                None,
                None,
                None
            )
            .is_ok());
    }

    // ── policy: password reuse history ────────────────────────────────────────

    #[test]
    fn a_password_within_the_history_window_cannot_be_set_again() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                history_count: Some(3),
                ..Default::default()
            })
            .expect("policy");
        svc.register(reg("reuse@test.com", "firstpassword", "Reuse"))
            .expect("register");

        svc.change_password(ChangePasswordRequest {
            email: "reuse@test.com".to_string(),
            current_password: "firstpassword".to_string(),
            new_password: "secondpassword".to_string(),
            totp_code: None,
        })
        .expect("second");

        // Back to the first, which is still inside the window.
        let err = svc
            .change_password(ChangePasswordRequest {
                email: "reuse@test.com".to_string(),
                current_password: "secondpassword".to_string(),
                new_password: "firstpassword".to_string(),
                totp_code: None,
            })
            .unwrap_err();
        assert_eq!(err.status, 400);
        assert!(err.message.contains("used before"), "{}", err.message);
    }

    /// The window has a length, and a password that falls out of it is free
    /// again — otherwise the rule would be "never reuse anything, ever".
    #[test]
    fn a_password_older_than_the_window_can_be_set_again() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                history_count: Some(2),
                ..Default::default()
            })
            .expect("policy");
        svc.register(reg("window@test.com", "firstpassword", "Window"))
            .expect("register");

        for (current, next) in [
            ("firstpassword", "secondpassword"),
            ("secondpassword", "thirdpassword"),
        ] {
            svc.change_password(ChangePasswordRequest {
                email: "window@test.com".to_string(),
                current_password: current.to_string(),
                new_password: next.to_string(),
                totp_code: None,
            })
            .expect("change");
        }

        // The window holds the second and third; the first has fallen out.
        svc.change_password(ChangePasswordRequest {
            email: "window@test.com".to_string(),
            current_password: "thirdpassword".to_string(),
            new_password: "firstpassword".to_string(),
            totp_code: None,
        })
        .expect("the first password is outside the window");
    }

    /// The rule reaches the account's very first password, or turning it on
    /// would leave the original free to be set again.
    #[test]
    fn the_history_includes_the_password_the_account_was_created_with() {
        let (svc, policy) = make_service_with_policy();
        policy
            .update(PasswordPolicyUpdate {
                history_count: Some(5),
                ..Default::default()
            })
            .expect("policy");
        let created = svc
            .register(reg("origin@test.com", "originalpass", "Origin"))
            .expect("register");

        let err = svc
            .admin_update_user(
                &created.id,
                AdminUpdateUserRequest {
                    password: Some("originalpass".to_string()),
                    ..admin_update()
                },
            )
            .unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn no_history_count_lets_any_previous_password_come_back() {
        let svc = make_service();
        svc.register(reg("nohist@test.com", "firstpassword", "NoHist"))
            .expect("register");
        svc.change_password(ChangePasswordRequest {
            email: "nohist@test.com".to_string(),
            current_password: "firstpassword".to_string(),
            new_password: "secondpassword".to_string(),
            totp_code: None,
        })
        .expect("second");
        svc.change_password(ChangePasswordRequest {
            email: "nohist@test.com".to_string(),
            current_password: "secondpassword".to_string(),
            new_password: "firstpassword".to_string(),
            totp_code: None,
        })
        .expect("the rule is off, so the first password is free");
    }

    #[test]
    fn editing_an_unknown_account_is_a_404() {
        let svc = make_service();
        let err = svc
            .admin_update_user(
                "no-such-user",
                AdminUpdateUserRequest {
                    disabled: Some(true),
                    ..admin_update()
                },
            )
            .unwrap_err();
        assert_eq!(err.status, 404);
    }

    // ── self-serve deletion ───────────────────────────────────────────────────

    #[test]
    fn delete_own_account_blocks_sign_in_and_drops_sessions() {
        let svc = make_service();
        svc.register(reg("ivy@test.com", "password123", "Ivy"))
            .unwrap();
        svc.login(login_req("ivy@test.com", "password123"), None, None, None)
            .unwrap();
        let user = svc.lookup_user_by_email("ivy@test.com").unwrap().unwrap();

        svc.delete_own_account(&user.id).unwrap();

        // The account is gone as far as every `deleted_at IS NULL` lookup goes.
        assert!(svc.lookup_user_by_email("ivy@test.com").unwrap().is_none());
        assert!(svc
            .login(login_req("ivy@test.com", "password123"), None, None, None)
            .is_err());
        // And the refresh tokens went with it — otherwise the access token the
        // caller still holds could be traded for a fresh one after deletion.
        assert!(svc.list_sessions(&user.id).unwrap().sessions.is_empty());
    }

    #[test]
    fn delete_own_account_twice_returns_404() {
        let svc = make_service();
        let reg_resp = svc
            .register(reg("jack@test.com", "password123", "Jack"))
            .unwrap();

        svc.delete_own_account(&reg_resp.id).unwrap();
        let err = svc.delete_own_account(&reg_resp.id).unwrap_err();
        assert_eq!(
            err.status, 404,
            "a soft-deleted row still matches the update, so the lookup is what makes this a 404"
        );
    }

    // ── restore ───────────────────────────────────────────────────────────────

    #[test]
    fn deleted_users_are_hidden_from_the_admin_list_unless_asked_for() {
        let svc = make_service();
        let kept = svc
            .register(reg("kept@test.com", "password123", "Kept"))
            .unwrap();
        let gone = svc
            .register(reg("gone@test.com", "password123", "Gone"))
            .unwrap();
        svc.admin_delete_user(&gone.id).unwrap();

        let default = svc.admin_list_users(1, 20, false).unwrap();
        assert_eq!(default.total, 1);
        assert_eq!(default.users[0].id, kept.id);

        // Without this the console has no row to press Restore on.
        let with_deleted = svc.admin_list_users(1, 20, true).unwrap();
        assert_eq!(with_deleted.total, 2);
        let deleted = with_deleted
            .users
            .iter()
            .find(|u| u.id == gone.id)
            .expect("deleted user missing from include_deleted listing");
        assert!(deleted.deleted_at.is_some());
        assert_eq!(
            deleted.purge_after,
            deleted.deleted_at.map(purge_after),
            "the console counts down to this, so it has to come from the policy",
        );
    }

    #[test]
    fn restore_brings_a_deleted_account_back() {
        let svc = make_service();
        svc.register(reg("kim@test.com", "password123", "Kim"))
            .unwrap();
        let user = svc.lookup_user_by_email("kim@test.com").unwrap().unwrap();
        svc.delete_own_account(&user.id).unwrap();

        let restored = svc.admin_restore_user(&user.id).unwrap();
        assert!(restored.deleted_at.is_none());
        assert!(restored.purge_after.is_none());

        // Restored means usable, not merely visible.
        assert!(svc.lookup_user_by_email("kim@test.com").unwrap().is_some());
        assert!(svc
            .login(login_req("kim@test.com", "password123"), None, None, None)
            .is_ok());
    }

    #[test]
    fn restoring_a_live_account_returns_400() {
        let svc = make_service();
        let user = svc
            .register(reg("liv@test.com", "password123", "Liv"))
            .unwrap();
        let err = svc.admin_restore_user(&user.id).unwrap_err();
        assert_eq!(err.status, 400);
    }

    #[test]
    fn restoring_an_unknown_account_returns_404() {
        let svc = make_service();
        // Also the answer once the worker's purge has run: the row is gone, and
        // nothing can bring it back.
        let err = svc.admin_restore_user("no-such-user").unwrap_err();
        assert_eq!(err.status, 404);
    }

    // ── update_extended_profile ───────────────────────────────────────────────

    /// A profile patch that changes nothing, to spread the one field under test
    /// over — every field is optional and independent.
    fn profile_update() -> UpdateProfileRequest {
        UpdateProfileRequest {
            name: None,
            theme: None,
            bio: None,
            avatar: None,
            profile_image: None,
            website: None,
            social_links: None,
            language: None,
            timezone: None,
            country: None,
            email_preferences: None,
        }
    }

    #[test]
    fn updating_the_profile_renames_the_user() {
        let svc = make_service();
        let user = svc
            .register(reg("nia@test.com", "password123", "Nia"))
            .unwrap();

        svc.update_extended_profile(
            &user.id,
            UpdateProfileRequest {
                name: Some("  Nia Okafor  ".to_string()),
                ..profile_update()
            },
        )
        .unwrap();

        // Trimmed: the display name is shown verbatim beside every file and
        // comment, so leading whitespace is a rendering bug waiting to happen.
        assert_eq!(svc.get_profile(&user.id).unwrap().name, "Nia Okafor");
    }

    #[test]
    fn a_profile_patch_without_a_name_leaves_the_name_alone() {
        let svc = make_service();
        let user = svc
            .register(reg("omar@test.com", "password123", "Omar"))
            .unwrap();

        // Every other screen that saves a profile — notifications, the theme
        // picker — sends a patch with no `name` in it, and must not blank it.
        svc.update_extended_profile(
            &user.id,
            UpdateProfileRequest {
                bio: Some("Hello".to_string()),
                ..profile_update()
            },
        )
        .unwrap();

        assert_eq!(svc.get_profile(&user.id).unwrap().name, "Omar");
    }

    #[test]
    fn a_blank_name_is_rejected() {
        let svc = make_service();
        let user = svc
            .register(reg("pia@test.com", "password123", "Pia"))
            .unwrap();

        let err = svc
            .update_extended_profile(
                &user.id,
                UpdateProfileRequest {
                    name: Some("   ".to_string()),
                    ..profile_update()
                },
            )
            .unwrap_err();

        assert_eq!(err.status, 400);
        assert_eq!(svc.get_profile(&user.id).unwrap().name, "Pia");
    }

    // ── anonymize_ip ──────────────────────────────────────────────────────────

    #[test]
    fn anonymize_ip_strips_last_ipv4_octet() {
        assert_eq!(anonymize_ip("192.168.1.100"), "192.168.1.xxx");
        assert_eq!(anonymize_ip("10.0.0.1"), "10.0.0.xxx");
    }

    #[test]
    fn anonymize_ip_passes_through_non_ipv4() {
        let ipv6 = "2001:db8::1";
        assert_eq!(anonymize_ip(ipv6), ipv6);
    }
}
