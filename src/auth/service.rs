use super::dto::{
    AdminUpdateUserRequest, AdminUserListResponse, AdminUserResponse, AuthResponse,
    EmailPreferences, LoginResponse, PublicProfileResponse, RefreshRequest, RegisterRequest,
    RegisterResponse, SessionListResponse, SessionResponse, SocialLinks, TwoFactorDisableRequest,
    TwoFactorEnrollResponse, TwoFactorStatusResponse, UpdateProfileRequest, UserLookupResponse,
    UserProfileDetailsResponse, UserProfileResponse,
};
use super::repository::{
    AuthRepository, NewRefreshToken, NewTotpBackupCode, NewUser, UpsertUserProfile,
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

pub struct AuthService {
    repo: Arc<AuthRepository>,
    token_service: Arc<TokenService>,
}

impl AuthService {
    pub fn new(repo: Arc<AuthRepository>, token_service: Arc<TokenService>) -> Self {
        AuthService {
            repo,
            token_service,
        }
    }

    pub fn register(&self, req: RegisterRequest) -> Result<RegisterResponse, ApiError> {
        if req.email.is_empty() {
            return Err(ApiError::bad_request("Email is required"));
        }
        if req.password.len() < 8 {
            return Err(ApiError::bad_request(
                "Password must be at least 8 characters",
            ));
        }
        if req.name.is_empty() {
            return Err(ApiError::bad_request("Name is required"));
        }

        if self.repo.find_user_by_email(&req.email)?.is_some() {
            return Err(ApiError::conflict("Email already registered"));
        }

        let salt = SaltString::generate(&mut OsRng);
        let argon2 = Argon2::default();
        let password_hash = argon2
            .hash_password(req.password.as_bytes(), &salt)
            .map_err(|e| {
                tracing::error!("Password hashing error: {:?}", e);
                ApiError::internal("Failed to hash password")
            })?
            .to_string();

        let user_id = Uuid::new_v4().to_string();
        let new_user = NewUser {
            id: &user_id,
            email: &req.email,
            name: &req.name,
            password_hash: &password_hash,
        };

        let user = self.repo.create_user(new_user)?;

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

        Argon2::default()
            .verify_password(req.password.as_bytes(), &parsed_hash)
            .map_err(|_| ApiError::unauthorized("Invalid email or password"))?;

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

        let stored_token = self
            .repo
            .find_refresh_token_by_hash(&token_hash)?
            .ok_or_else(|| ApiError::unauthorized("Invalid refresh token"))?;

        let now = Utc::now().naive_utc();
        if stored_token.expires_at < now {
            let _ = self.repo.delete_refresh_token(&stored_token.id);
            return Err(ApiError::unauthorized("Refresh token has expired"));
        }

        let user = self
            .repo
            .find_user_by_id(&stored_token.user_id)?
            .ok_or_else(|| ApiError::unauthorized("User not found"))?;

        self.repo.delete_refresh_token(&stored_token.id)?;

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

    // ── Admin ─────────────────────────────────────────────────────────────────

    pub fn admin_list_users(
        &self,
        page: i64,
        page_size: i64,
    ) -> Result<AdminUserListResponse, ApiError> {
        let page_size = page_size.min(100).max(1);
        let page = page.max(1);
        let (users, total) = self.repo.list_users(page, page_size)?;
        let items = users
            .into_iter()
            .map(|u| AdminUserResponse {
                id: u.id,
                email: u.email,
                name: u.name,
                role: u.role,
                totp_enabled: u.totp_enabled == 1,
                created_at: u.created_at,
                deleted_at: u.deleted_at,
            })
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
        Ok(AdminUserResponse {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            totp_enabled: user.totp_enabled == 1,
            created_at: user.created_at,
            deleted_at: user.deleted_at,
        })
    }

    pub fn admin_update_user(
        &self,
        user_id: &str,
        req: AdminUpdateUserRequest,
    ) -> Result<AdminUserResponse, ApiError> {
        if let Some(ref role) = req.role {
            if role != "user" && role != "admin" {
                return Err(ApiError::bad_request("Role must be 'user' or 'admin'"));
            }
            self.repo.update_user_role(user_id, role)?;
        }
        if let Some(enabled) = req.totp_enabled {
            if !enabled {
                // Admin force-disabling 2FA
                self.repo.update_user_totp(user_id, None, false)?;
            }
        }
        self.admin_get_user(user_id)
    }

    pub fn admin_delete_user(&self, user_id: &str) -> Result<(), ApiError> {
        self.repo.soft_delete_user(user_id)
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
        Ok(profile_to_response(user_id, Some(saved)))
    }

    // ── E2EE key management ───────────────────────────────────────────────────

    pub fn set_public_key(&self, user_id: &str, public_key: &str) -> Result<(), ApiError> {
        self.repo.set_public_key(user_id, public_key)
    }

    pub fn get_public_key(&self, user_id: &str) -> Result<Option<String>, ApiError> {
        self.repo.get_public_key(user_id)
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
        let repo = Arc::new(AuthRepository::new(pool));
        AuthService::new(repo, token_service)
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
    fn refresh_token_can_only_be_used_once() {
        let svc = make_service();
        svc.register(reg("eve@test.com", "password123", "Eve"))
            .unwrap();
        let login_resp = svc
            .login(login_req("eve@test.com", "password123"), None, None, None)
            .unwrap();
        let refresh_token = login_resp.auth.unwrap().refresh_token;

        svc.refresh(RefreshRequest {
            refresh_token: refresh_token.clone(),
        })
        .unwrap();
        let err = svc.refresh(RefreshRequest { refresh_token }).unwrap_err();
        assert_eq!(err.status, 401);
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
        let result = svc.admin_list_users(0, 200).unwrap();
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
                    name: None,
                    role: Some("superuser".to_string()),
                    totp_enabled: None,
                },
            )
            .unwrap_err();
        assert_eq!(err.status, 400);
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
