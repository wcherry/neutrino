// ── drive::fonts::api ─────────────────────────────────────────────────────────

use actix_multipart::Multipart;
use actix_web::{delete, get, post, web, HttpRequest, HttpResponse};
use futures_util::StreamExt;
use serde::Serialize;
use std::sync::Arc;
use tokio::io::{AsyncWriteExt, BufWriter};
use utoipa::OpenApi;
use uuid::Uuid;

use super::model::CustomFontRecord;
use super::service::{FontsService, MAX_FONT_SIZE_BYTES};
use crate::shared::{AdminUser, ApiError, AuthenticatedUser};

// ── State ─────────────────────────────────────────────────────────────────────

pub struct FontsApiState {
    pub service: Arc<FontsService>,
}

// ── DTOs ──────────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CustomFontDto {
    pub id: String,
    pub display_name: String,
    pub format: String,
    pub file_url: String,
}

impl From<CustomFontRecord> for CustomFontDto {
    fn from(record: CustomFontRecord) -> Self {
        CustomFontDto {
            file_url: format!("/api/v1/fonts/{}/file", record.id),
            id: record.id,
            display_name: record.display_name,
            format: record.format,
        }
    }
}

// ── Handlers ──────────────────────────────────────────────────────────────────

/// List all admin-uploaded custom fonts. Available to any authenticated user
/// (fonts are a global, non-per-user resource selectable in every editor).
#[utoipa::path(
    get,
    path = "/api/v1/fonts",
    responses(
        (status = 200, description = "List of custom fonts", body = Vec<CustomFontDto>),
        (status = 401, description = "Missing or invalid authentication token"),
    ),
    security(("bearer_auth" = [])),
    tag = "fonts"
)]
#[get("/fonts")]
async fn list_fonts(
    state: web::Data<FontsApiState>,
    _user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let fonts = state.service.list()?;
    let dtos: Vec<CustomFontDto> = fonts.into_iter().map(CustomFontDto::from).collect();
    Ok(HttpResponse::Ok().json(dtos))
}

/// Serve a custom font's raw bytes with the correct `Content-Type` for
/// `@font-face`. Requires authentication (not a bare public static route —
/// see the plan doc for why: the frontend fetches this as a `Blob` via the
/// authenticated API client and points `@font-face src` at an object URL).
#[utoipa::path(
    get,
    path = "/api/v1/fonts/{id}/file",
    params(("id" = String, Path, description = "Font ID")),
    responses(
        (status = 200, description = "Font file bytes"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 404, description = "Font not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "fonts"
)]
#[get("/fonts/{id}/file")]
async fn get_font_file(
    state: web::Data<FontsApiState>,
    _user: AuthenticatedUser,
    path: web::Path<String>,
    req: HttpRequest,
) -> Result<HttpResponse, ApiError> {
    let font_id = path.into_inner();
    let (file_path, content_type, _file_name) = state.service.resolve_file(&font_id)?;

    let mime: mime::Mime = content_type
        .parse()
        .unwrap_or(mime::APPLICATION_OCTET_STREAM);

    let named_file = actix_files::NamedFile::open(&file_path)
        .map_err(|e| {
            tracing::error!("Failed to open font file {:?}: {:?}", file_path, e);
            ApiError::internal("Failed to serve font")
        })?
        .set_content_type(mime)
        .use_etag(false)
        .use_last_modified(false);

    let mut response = named_file.into_response(&req);
    response.headers_mut().insert(
        actix_web::http::header::CACHE_CONTROL,
        actix_web::http::header::HeaderValue::from_static("no-store"),
    );
    Ok(response)
}

/// Upload a new custom font. Admin-only. Accepts `multipart/form-data` with
/// a `display_name` text field and a `file` field (woff2/woff/ttf/otf, max
/// 50 MB, validated against both the file extension and declared/sniffed MIME
/// type).
#[utoipa::path(
    post,
    path = "/api/v1/admin/fonts",
    responses(
        (status = 201, description = "Font uploaded", body = CustomFontDto),
        (status = 400, description = "Missing display name, no file, or disallowed format"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 413, description = "File exceeds the 50 MB limit"),
    ),
    security(("bearer_auth" = [])),
    tag = "fonts"
)]
#[post("/fonts")]
async fn upload_font(
    state: web::Data<FontsApiState>,
    admin: AdminUser,
    mut payload: Multipart,
) -> Result<HttpResponse, ApiError> {
    let mut display_name: Option<String> = None;

    while let Some(field) = payload.next().await {
        let mut field = field.map_err(|e| {
            tracing::error!("Multipart error: {:?}", e);
            ApiError::bad_request("Invalid multipart data")
        })?;

        let field_name = field
            .content_disposition()
            .and_then(|cd| cd.get_name().map(|s| s.to_string()))
            .unwrap_or_default();

        // Non-file text field — read scalar value.
        if field
            .content_disposition()
            .and_then(|cd| cd.get_filename())
            .is_none()
        {
            if field_name == "display_name" {
                let mut buf = Vec::new();
                while let Some(chunk) = field.next().await {
                    let data = chunk.map_err(|e| {
                        tracing::error!("Chunk read error: {:?}", e);
                        ApiError::bad_request("Upload interrupted")
                    })?;
                    buf.extend_from_slice(&data);
                }
                let value = String::from_utf8_lossy(&buf).trim().to_string();
                if !value.is_empty() {
                    display_name = Some(value);
                }
            }
            continue;
        }

        let file_name = field
            .content_disposition()
            .and_then(|cd| cd.get_filename())
            .unwrap_or("untitled")
            .to_string();

        let declared_mime = field
            .content_type()
            .map(|m| m.to_string())
            .unwrap_or_default();

        // Validate extension + MIME type before writing anything to disk.
        let format = state.service.validate_format(&file_name, &declared_mime)?;

        let display_name = display_name
            .clone()
            .ok_or_else(|| ApiError::bad_request("display_name is required"))?;

        state
            .service
            .ensure_fonts_temp_dir()
            .map_err(ApiError::internal)?;

        let temp_id = Uuid::new_v4().to_string();
        let temp_path = state.service.temp_path(&temp_id);

        let raw_file = tokio::fs::File::create(&temp_path).await.map_err(|e| {
            tracing::error!("Failed to create temp file: {:?}", e);
            ApiError::internal("Failed to initialize upload")
        })?;
        let mut file = BufWriter::with_capacity(1 << 20, raw_file);

        let mut size: u64 = 0;
        while let Some(chunk) = field.next().await {
            let data = chunk.map_err(|e| {
                tracing::error!("Chunk read error: {:?}", e);
                ApiError::bad_request("Upload interrupted")
            })?;
            size += data.len() as u64;
            if size > MAX_FONT_SIZE_BYTES {
                drop(file);
                let _ = std::fs::remove_file(&temp_path);
                return Err(ApiError::new(
                    413,
                    "PAYLOAD_TOO_LARGE",
                    "Font file exceeds the 50MB limit",
                ));
            }
            file.write_all(&data).await.map_err(|e| {
                tracing::error!("Write error: {:?}", e);
                ApiError::internal("Failed to write upload data")
            })?;
        }

        file.flush().await.map_err(|e| {
            tracing::error!("Flush error: {:?}", e);
            ApiError::internal("Failed to finalize upload")
        })?;
        drop(file);

        let record = state
            .service
            .finalize_upload(&admin.user_id, &display_name, &file_name, &format, &temp_path)
            .inspect_err(|_| {
                let _ = std::fs::remove_file(&temp_path);
            })?;

        return Ok(HttpResponse::Created().json(CustomFontDto::from(record)));
    }

    Err(ApiError::bad_request("No file provided in multipart body"))
}

/// Delete a custom font's DB row and on-disk file. Admin-only.
#[utoipa::path(
    delete,
    path = "/api/v1/admin/fonts/{id}",
    params(("id" = String, Path, description = "Font ID")),
    responses(
        (status = 204, description = "Font deleted"),
        (status = 401, description = "Missing or invalid authentication token"),
        (status = 403, description = "Authenticated user is not an admin"),
        (status = 404, description = "Font not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "fonts"
)]
#[delete("/fonts/{id}")]
async fn delete_font(
    state: web::Data<FontsApiState>,
    _admin: AdminUser,
    path: web::Path<String>,
) -> Result<HttpResponse, ApiError> {
    let font_id = path.into_inner();
    state.service.delete(&font_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure_public(cfg: &mut web::ServiceConfig) {
    cfg.service(list_fonts).service(get_font_file);
}

pub fn configure_admin(cfg: &mut web::ServiceConfig) {
    cfg.service(upload_font).service(delete_font);
}

// ── OpenAPI doc ───────────────────────────────────────────────────────────────

#[derive(OpenApi)]
#[openapi(
    paths(list_fonts, get_font_file, upload_font, delete_font),
    components(schemas(CustomFontDto)),
    tags((name = "fonts", description = "Admin-uploadable custom fonts — public read, admin write")),
    modifiers(&SecurityAddon)
)]
pub struct FontsApiDoc;

struct SecurityAddon;
impl utoipa::Modify for SecurityAddon {
    fn modify(&self, openapi: &mut utoipa::openapi::OpenApi) {
        if let Some(components) = openapi.components.as_mut() {
            components.add_security_scheme(
                "bearer_auth",
                utoipa::openapi::security::SecurityScheme::Http(
                    utoipa::openapi::security::HttpBuilder::new()
                        .scheme(utoipa::openapi::security::HttpAuthScheme::Bearer)
                        .bearer_format("JWT")
                        .build(),
                ),
            );
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::{test, web, App};
    use std::sync::Arc;

    use crate::drive::fonts::repository::FontsRepository;
    use crate::drive::fonts::service::FontsService;
    use crate::drive::storage::store::LocalFileStore;
    use crate::shared::{DbPool, TokenService};

    const WOFF2_CONTENT_TYPE: &str = "font/woff2";
    const FAKE_WOFF2_BYTES: &[u8] = b"wOF2fake-font-bytes-for-testing-only";

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

    fn test_store() -> Arc<LocalFileStore> {
        let base = std::env::temp_dir().join(format!(
            "neutrino_fonts_api_test_{}",
            uuid::Uuid::new_v4()
        ));
        Arc::new(LocalFileStore::new(&base).expect("create store"))
    }

    fn test_state() -> web::Data<FontsApiState> {
        let pool = test_pool();
        let repo = Arc::new(FontsRepository::new(pool));
        let store = test_store();
        let service = Arc::new(FontsService::new(repo, store));
        web::Data::new(FontsApiState { service })
    }

    fn make_token_service() -> Arc<TokenService> {
        Arc::new(TokenService::new("test-secret-for-tests".to_string()))
    }

    fn admin_bearer(ts: &TokenService) -> String {
        let tok = ts
            .generate_access_token_with_admin("admin-1", "admin@example.com", true)
            .expect("token");
        format!("Bearer {}", tok)
    }

    fn non_admin_bearer(ts: &TokenService) -> String {
        let tok = ts
            .generate_access_token("user-1", "user@example.com")
            .expect("token");
        format!("Bearer {}", tok)
    }

    macro_rules! make_app {
        ($state:expr, $ts:expr) => {{
            let ts_data = web::Data::new($ts);
            test::init_service(
                App::new()
                    .app_data($state)
                    .app_data(ts_data)
                    .configure(configure_public)
                    .service(web::scope("/admin").configure(configure_admin)),
            )
            .await
        }};
    }

    /// Builds a raw `multipart/form-data` body with a `display_name` text
    /// field and a `file` field carrying the given filename/content-type/bytes,
    /// mirroring the shape the browser's `FormData` produces for
    /// `adminApi.uploadFont(file, displayName)`.
    fn build_multipart_body(
        boundary: &str,
        display_name: &str,
        filename: &str,
        content_type: &str,
        bytes: &[u8],
    ) -> Vec<u8> {
        let mut body = Vec::new();
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            b"Content-Disposition: form-data; name=\"display_name\"\r\n\r\n",
        );
        body.extend_from_slice(display_name.as_bytes());
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        body.extend_from_slice(
            format!(
                "Content-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            )
            .as_bytes(),
        );
        body.extend_from_slice(format!("Content-Type: {content_type}\r\n\r\n").as_bytes());
        body.extend_from_slice(bytes);
        body.extend_from_slice(b"\r\n");
        body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
        body
    }

    fn multipart_content_type(boundary: &str) -> String {
        format!("multipart/form-data; boundary={boundary}")
    }

    // ── GET /fonts ──────────────────────────────────────────────────────────

    #[actix_web::test]
    async fn list_fonts_requires_authentication() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get().uri("/fonts").to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn list_fonts_returns_empty_array_for_any_authenticated_user() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = non_admin_bearer(&ts);
        let req = test::TestRequest::get()
            .uri("/fonts")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert!(body.is_array());
        assert!(body.as_array().unwrap().is_empty());
    }

    // ── POST /admin/fonts ───────────────────────────────────────────────────

    #[actix_web::test]
    async fn upload_font_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let boundary = "X-BOUNDARY-1";
        let body = build_multipart_body(
            boundary,
            "My Font",
            "test.woff2",
            WOFF2_CONTENT_TYPE,
            FAKE_WOFF2_BYTES,
        );
        let req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn upload_font_rejects_non_admin() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = non_admin_bearer(&ts);
        let boundary = "X-BOUNDARY-2";
        let body = build_multipart_body(
            boundary,
            "My Font",
            "test.woff2",
            WOFF2_CONTENT_TYPE,
            FAKE_WOFF2_BYTES,
        );
        let req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", token))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 403);
    }

    #[actix_web::test]
    async fn upload_font_succeeds_for_admin_with_valid_woff2() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let boundary = "X-BOUNDARY-3";
        let body = build_multipart_body(
            boundary,
            "My Custom Font",
            "test.woff2",
            WOFF2_CONTENT_TYPE,
            FAKE_WOFF2_BYTES,
        );
        let req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", token))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert!(
            resp.status() == 200 || resp.status() == 201,
            "expected 200 or 201, got {}",
            resp.status()
        );
        let json: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(json["displayName"], "My Custom Font");
        assert_eq!(json["format"], "woff2");
        assert!(json["id"].is_string());
    }

    #[actix_web::test]
    async fn upload_font_rejects_disallowed_extension() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let boundary = "X-BOUNDARY-4";
        let body = build_multipart_body(
            boundary,
            "Not A Font",
            "malicious.exe",
            "application/octet-stream",
            b"not a font at all",
        );
        let req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", token))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);
    }

    #[actix_web::test]
    async fn upload_font_rejects_disallowed_text_extension() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let boundary = "X-BOUNDARY-5";
        let body = build_multipart_body(
            boundary,
            "Renamed Text File",
            "notes.txt",
            "text/plain",
            b"just some plain text",
        );
        let req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", token))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 400);
    }

    #[actix_web::test]
    async fn upload_font_rejects_file_over_50mb() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = admin_bearer(&ts);
        let boundary = "X-BOUNDARY-6";
        // 50 MB limit — send 50 MB + 1 byte of filler payload.
        let oversized = vec![0u8; 50 * 1024 * 1024 + 1];
        let body = build_multipart_body(
            boundary,
            "Too Big",
            "big.woff2",
            WOFF2_CONTENT_TYPE,
            &oversized,
        );
        let req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", token))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(body)
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(
            resp.status(),
            413,
            "expected 413 Payload Too Large for a file over the 50MB limit, got {}",
            resp.status()
        );
    }

    // ── DELETE /admin/fonts/{id} ────────────────────────────────────────────

    #[actix_web::test]
    async fn delete_font_requires_admin_auth() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::delete()
            .uri("/admin/fonts/some-id")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn delete_font_rejects_non_admin() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let token = non_admin_bearer(&ts);
        let req = test::TestRequest::delete()
            .uri("/admin/fonts/some-id")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 403);
    }

    #[actix_web::test]
    async fn delete_font_removes_it_from_a_subsequent_list() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let admin_token = admin_bearer(&ts);
        let non_admin_token = non_admin_bearer(&ts);

        // Upload a font first.
        let boundary = "X-BOUNDARY-7";
        let upload_body = build_multipart_body(
            boundary,
            "Deletable Font",
            "deletable.woff2",
            WOFF2_CONTENT_TYPE,
            FAKE_WOFF2_BYTES,
        );
        let upload_req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", admin_token.clone()))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(upload_body)
            .to_request();
        let upload_resp = test::call_service(&app, upload_req).await;
        assert!(upload_resp.status().is_success());
        let uploaded: serde_json::Value = test::read_body_json(upload_resp).await;
        let font_id = uploaded["id"].as_str().expect("id").to_string();

        // Delete it as admin.
        let delete_req = test::TestRequest::delete()
            .uri(&format!("/admin/fonts/{font_id}"))
            .insert_header(("Authorization", admin_token))
            .to_request();
        let delete_resp = test::call_service(&app, delete_req).await;
        assert!(delete_resp.status().is_success());

        // It should no longer appear in the public list.
        let list_req = test::TestRequest::get()
            .uri("/fonts")
            .insert_header(("Authorization", non_admin_token))
            .to_request();
        let list_resp = test::call_service(&app, list_req).await;
        let list_body: serde_json::Value = test::read_body_json(list_resp).await;
        let ids: Vec<&str> = list_body
            .as_array()
            .unwrap()
            .iter()
            .map(|f| f["id"].as_str().unwrap())
            .collect();
        assert!(!ids.contains(&font_id.as_str()));
    }

    // ── GET /fonts/{id}/file ────────────────────────────────────────────────

    #[actix_web::test]
    async fn get_font_file_requires_authentication() {
        let app = make_app!(test_state(), make_token_service());
        let req = test::TestRequest::get()
            .uri("/fonts/some-id/file")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 401);
    }

    #[actix_web::test]
    async fn get_font_file_serves_bytes_with_correct_content_type() {
        let ts = make_token_service();
        let app = make_app!(test_state(), ts.clone());
        let admin_token = admin_bearer(&ts);
        let non_admin_token = non_admin_bearer(&ts);

        let boundary = "X-BOUNDARY-8";
        let upload_body = build_multipart_body(
            boundary,
            "Servable Font",
            "servable.woff2",
            WOFF2_CONTENT_TYPE,
            FAKE_WOFF2_BYTES,
        );
        let upload_req = test::TestRequest::post()
            .uri("/admin/fonts")
            .insert_header(("Authorization", admin_token))
            .insert_header(("Content-Type", multipart_content_type(boundary)))
            .set_payload(upload_body)
            .to_request();
        let upload_resp = test::call_service(&app, upload_req).await;
        assert!(upload_resp.status().is_success());
        let uploaded: serde_json::Value = test::read_body_json(upload_resp).await;
        let font_id = uploaded["id"].as_str().expect("id").to_string();

        let file_req = test::TestRequest::get()
            .uri(&format!("/fonts/{font_id}/file"))
            .insert_header(("Authorization", non_admin_token))
            .to_request();
        let file_resp = test::call_service(&app, file_req).await;
        assert_eq!(file_resp.status(), 200);
        let content_type = file_resp
            .headers()
            .get("content-type")
            .expect("content-type header")
            .to_str()
            .expect("valid header string");
        assert_eq!(content_type, WOFF2_CONTENT_TYPE);
        let bytes = test::read_body(file_resp).await;
        assert_eq!(&bytes[..], FAKE_WOFF2_BYTES);
    }
}
