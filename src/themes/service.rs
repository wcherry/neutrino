// ── themes::service ───────────────────────────────────────────────────────────
//
// Mirrors `src/slides/slides/service.rs`'s theme methods. Ownership
// pass-through and `is_owner` computation are implemented for real. Token/
// color validation is DELIBERATELY STUBBED for the TDD red phase — see the
// TODO below — so the token-allowlist tests in this file's `#[cfg(test)]`
// block are expected to fail until `rust-developer` implements it.

use std::collections::HashMap;
use std::sync::{Arc, OnceLock};

use chrono::Utc;
use regex::Regex;
use uuid::Uuid;

use super::dto::{
    CreateThemeRequest, ListThemesResponse, ThemeResponse, UpdateThemeRequest,
    CANONICAL_THEME_TOKENS,
};
use super::model::{CustomThemeRecord, NewCustomThemeRecord, UpdateCustomThemeRecord};
use super::repository::CustomThemesRepository;
use crate::shared::{ApiError, AuthenticatedUser};

pub struct CustomThemesService {
    repo: Arc<CustomThemesRepository>,
}

impl CustomThemesService {
    pub fn new(repo: Arc<CustomThemesRepository>) -> Self {
        Self { repo }
    }

    pub fn list_themes(&self, user: &AuthenticatedUser) -> Result<ListThemesResponse, ApiError> {
        let records = self.repo.list_visible_themes_for_user(&user.user_id)?;
        let themes = records
            .into_iter()
            .map(|r| record_to_response(r, &user.user_id))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ListThemesResponse { themes })
    }

    pub fn create_theme(
        &self,
        user: &AuthenticatedUser,
        req: CreateThemeRequest,
    ) -> Result<ThemeResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Theme name cannot be empty"));
        }
        if req.color_scheme != "light" && req.color_scheme != "dark" {
            return Err(ApiError::bad_request(
                "colorScheme must be 'light' or 'dark'",
            ));
        }
        validate_tokens(&req.tokens)?;

        let tokens_json = serde_json::to_string(&req.tokens).map_err(|e| {
            tracing::error!("Failed to serialize theme tokens: {:?}", e);
            ApiError::internal("Failed to serialize theme tokens")
        })?;

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let new_theme = NewCustomThemeRecord {
            id: &id,
            user_id: &user.user_id,
            name: &name,
            is_public: req.is_public,
            color_scheme: &req.color_scheme,
            tokens: &tokens_json,
            created_at: &now,
            updated_at: &now,
        };
        let record = self.repo.insert_theme(new_theme)?;
        record_to_response(record, &user.user_id)
    }

    pub fn update_theme(
        &self,
        user: &AuthenticatedUser,
        theme_id: &str,
        req: UpdateThemeRequest,
    ) -> Result<ThemeResponse, ApiError> {
        if let Some(ref name) = req.name {
            if name.trim().is_empty() {
                return Err(ApiError::bad_request("Theme name cannot be empty"));
            }
        }
        if let Some(ref cs) = req.color_scheme {
            if cs != "light" && cs != "dark" {
                return Err(ApiError::bad_request(
                    "colorScheme must be 'light' or 'dark'",
                ));
            }
        }
        if let Some(ref tokens) = req.tokens {
            validate_tokens(tokens)?;
        }

        let tokens_json = req
            .tokens
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| {
                tracing::error!("Failed to serialize theme tokens: {:?}", e);
                ApiError::internal("Failed to serialize theme tokens")
            })?;

        let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string();
        let changes = UpdateCustomThemeRecord {
            name: req.name.map(|n| n.trim().to_string()),
            is_public: req.is_public,
            color_scheme: req.color_scheme,
            tokens: tokens_json,
            updated_at: now,
        };
        let record = self.repo.update_theme(theme_id, &user.user_id, changes)?;
        record_to_response(record, &user.user_id)
    }

    pub fn delete_theme(&self, user: &AuthenticatedUser, theme_id: &str) -> Result<(), ApiError> {
        self.repo.delete_theme(theme_id, &user.user_id)
    }
}

/// Validate that `tokens` contains only allowlisted keys with well-formed
/// color values.
///
/// Every key must be one of `CANONICAL_THEME_TOKENS` (see `dto.rs`) and every
/// value must match a strict CSS color literal: `#rgb`, `#rrggbb`,
/// `#rrggbbaa` hex forms, or a numeric `rgb(...)`/`rgba(...)` form. Anything
/// else — CSS keywords, `var(...)`, `url(...)`, `javascript:`, or any other
/// free-form string — is rejected. This is intentionally strict (an
/// allowlist of forms, not a denylist of bad patterns) because these values
/// get interpolated verbatim into a `<style>` tag served to every user who
/// views the theme; a permissive validator here is a stored-injection
/// vector.
fn validate_tokens(tokens: &HashMap<String, String>) -> Result<(), ApiError> {
    for (key, value) in tokens {
        if !CANONICAL_THEME_TOKENS.contains(&key.as_str()) {
            return Err(ApiError::bad_request(format!(
                "Unknown theme token key: {key}"
            )));
        }
        if !is_valid_css_color(value) {
            return Err(ApiError::bad_request(format!(
                "Invalid color value for token {key}"
            )));
        }
    }
    Ok(())
}

/// Matches a strict allowlist of CSS color literal forms:
/// - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` hex colors
/// - `rgb(r, g, b)` / `rgba(r, g, b, a)` with plain numeric channels and an
///   optional numeric (0-1, decimal allowed) or percentage alpha
///
/// Anchored on both ends so no trailing/leading garbage (e.g.
/// `#111111; background-image: url(...)`) can sneak through.
fn color_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r"(?x)
            ^
            (?:
                \#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})
                |
                rgba?\(
                    \s*[0-9]{1,3}\s*,
                    \s*[0-9]{1,3}\s*,
                    \s*[0-9]{1,3}\s*
                    (?:,\s*(?:0|1|0?\.[0-9]+|[0-9]{1,3}%)\s*)?
                \)
            )
            $
            ",
        )
        .expect("static color regex is valid")
    })
}

fn is_valid_css_color(value: &str) -> bool {
    color_pattern().is_match(value.trim())
}

fn record_to_response(
    record: CustomThemeRecord,
    requesting_user_id: &str,
) -> Result<ThemeResponse, ApiError> {
    let tokens: HashMap<String, String> = serde_json::from_str(&record.tokens).map_err(|e| {
        tracing::error!("Failed to deserialize theme tokens: {:?}", e);
        ApiError::internal("Failed to deserialize theme tokens")
    })?;
    Ok(ThemeResponse {
        is_owner: record.user_id == requesting_user_id,
        id: record.id,
        user_id: record.user_id,
        name: record.name,
        is_public: record.is_public,
        color_scheme: record.color_scheme,
        tokens,
        created_at: record.created_at,
        updated_at: record.updated_at,
    })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use crate::themes::repository::DbPool;

    fn test_pool() -> DbPool {
        use crate::MIGRATIONS;
        use diesel::r2d2::{ConnectionManager, Pool};
        use diesel::SqliteConnection;
        use diesel_migrations::MigrationHarness;

        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder()
            .max_size(1)
            .build(manager)
            .expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(MIGRATIONS)
            .expect("migrations");
        pool
    }

    fn insert_user(pool: &DbPool, id: &str, email: &str) {
        use diesel::prelude::*;
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(
            "INSERT INTO users (id, email, name, password_hash, created_at, role, totp_enabled) \
             VALUES (?, ?, ?, 'hash', datetime('now'), 'user', 0)",
        )
        .bind::<diesel::sql_types::Text, _>(id)
        .bind::<diesel::sql_types::Text, _>(email)
        .bind::<diesel::sql_types::Text, _>(id)
        .execute(&mut conn)
        .expect("insert user");
    }

    fn test_user(user_id: &str) -> AuthenticatedUser {
        AuthenticatedUser {
            user_id: user_id.to_string(),
            email: format!("{user_id}@example.com"),
            token: "test-token".to_string(),
            is_admin: false,
        }
    }

    fn test_service() -> (CustomThemesService, AuthenticatedUser, AuthenticatedUser) {
        let pool = test_pool();
        insert_user(&pool, "user-a", "a@example.com");
        insert_user(&pool, "user-b", "b@example.com");
        let repo = Arc::new(CustomThemesRepository::new(pool));
        (
            CustomThemesService::new(repo),
            test_user("user-a"),
            test_user("user-b"),
        )
    }

    fn valid_tokens() -> HashMap<String, String> {
        let mut m = HashMap::new();
        m.insert("--color-bg".to_string(), "#111111".to_string());
        m.insert("--color-accent".to_string(), "#4f46e5".to_string());
        m
    }

    #[test]
    fn create_theme_rejects_an_empty_name() {
        let (service, user_a, _user_b) = test_service();
        let req = CreateThemeRequest {
            name: "   ".to_string(),
            color_scheme: "dark".to_string(),
            tokens: valid_tokens(),
            is_public: false,
        };
        let err = service
            .create_theme(&user_a, req)
            .expect_err("expected empty/whitespace name to be rejected");
        assert_eq!(err.status, 400);
    }

    #[test]
    fn create_theme_succeeds_with_a_valid_name() {
        let (service, user_a, _user_b) = test_service();
        let req = CreateThemeRequest {
            name: "My Theme".to_string(),
            color_scheme: "dark".to_string(),
            tokens: valid_tokens(),
            is_public: false,
        };
        let created = service.create_theme(&user_a, req).expect("create_theme");
        assert_eq!(created.name, "My Theme");
        assert!(created.is_owner);
    }

    #[test]
    fn is_owner_is_true_for_the_creating_user() {
        let (service, user_a, _user_b) = test_service();
        let created = service
            .create_theme(
                &user_a,
                CreateThemeRequest {
                    name: "Owned".to_string(),
                    color_scheme: "dark".to_string(),
                    tokens: valid_tokens(),
                    is_public: true,
                },
            )
            .expect("create_theme");
        assert!(created.is_owner);
    }

    #[test]
    fn is_owner_is_false_for_a_different_requesting_user() {
        let (service, user_a, user_b) = test_service();
        service
            .create_theme(
                &user_a,
                CreateThemeRequest {
                    name: "A's Public Theme".to_string(),
                    color_scheme: "dark".to_string(),
                    tokens: valid_tokens(),
                    is_public: true,
                },
            )
            .expect("create_theme");

        let listed = service.list_themes(&user_b).expect("list_themes");
        let theirs = listed
            .themes
            .iter()
            .find(|t| t.name == "A's Public Theme")
            .expect("theme visible to user_b");
        assert!(!theirs.is_owner);
    }

    // RED PHASE: expected to fail until rust-developer implements validation
    // (see the `TODO(rust-developer)` above `validate_tokens`). The stub
    // currently accepts any token key, so this assertion that an unknown key
    // is rejected with 400 will fail against it.
    #[test]
    fn create_theme_rejects_an_unknown_token_key() {
        let (service, user_a, _user_b) = test_service();
        let mut tokens = valid_tokens();
        tokens.insert(
            "--not-a-real-token".to_string(),
            "#111111".to_string(),
        );
        let req = CreateThemeRequest {
            name: "Sneaky Theme".to_string(),
            color_scheme: "dark".to_string(),
            tokens,
            is_public: false,
        };
        let err = service
            .create_theme(&user_a, req)
            .expect_err("expected unknown token key to be rejected with 400");
        assert_eq!(err.status, 400);
    }

    // RED PHASE: expected to fail until rust-developer implements validation.
    #[test]
    fn create_theme_rejects_a_malformed_color_value() {
        let (service, user_a, _user_b) = test_service();
        let mut tokens = valid_tokens();
        tokens.insert(
            "--color-bg".to_string(),
            "javascript:alert(1)".to_string(),
        );
        let req = CreateThemeRequest {
            name: "Injection Attempt".to_string(),
            color_scheme: "dark".to_string(),
            tokens,
            is_public: false,
        };
        let err = service
            .create_theme(&user_a, req)
            .expect_err("expected malformed color value to be rejected with 400");
        assert_eq!(err.status, 400);
    }

    // RED PHASE: expected to fail until rust-developer implements validation.
    #[test]
    fn update_theme_rejects_an_unknown_token_key() {
        let (service, user_a, _user_b) = test_service();
        let created = service
            .create_theme(
                &user_a,
                CreateThemeRequest {
                    name: "Editable".to_string(),
                    color_scheme: "dark".to_string(),
                    tokens: valid_tokens(),
                    is_public: false,
                },
            )
            .expect("create_theme");

        let mut bad_tokens = HashMap::new();
        bad_tokens.insert("--totally-unknown".to_string(), "#000000".to_string());

        let err = service
            .update_theme(
                &user_a,
                &created.id,
                UpdateThemeRequest {
                    name: None,
                    color_scheme: None,
                    tokens: Some(bad_tokens),
                    is_public: None,
                },
            )
            .expect_err("expected unknown token key on update to be rejected with 400");
        assert_eq!(err.status, 400);
    }
}
