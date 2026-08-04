use crate::search::{
    dto::{SnapshotMetaResponse, UploadSnapshotParams, SNAPSHOT_VERSION_CONFLICT},
    service::{SearchSnapshotService, UploadOutcome},
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, put, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SearchApiState {
    pub service: Arc<SearchSnapshotService>,
}

/// Metadata for the caller's stored search index snapshot.
///
/// Clients poll this before downloading: an unchanged `version` means the
/// local index already reflects the snapshot, and a matching `deviceId` means
/// this device wrote it, so neither case needs the blob.
#[utoipa::path(
    get,
    path = "/api/v1/search/index/meta",
    responses(
        (status = 200, description = "Snapshot metadata", body = SnapshotMetaResponse),
        (status = 404, description = "No snapshot stored for this user"),
    ),
    security(("bearer_auth" = [])),
    tag = "search"
)]
#[get("/search/index/meta")]
pub async fn get_snapshot_meta(
    state: web::Data<SearchApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<SnapshotMetaResponse>, ApiError> {
    let meta = state
        .service
        .get_meta(&user.user_id)?
        .ok_or_else(|| ApiError::not_found("No search index snapshot stored"))?;
    Ok(web::Json(meta))
}

/// Download the encrypted snapshot.
///
/// The response body is ciphertext, self-describing apart from the wrapped key
/// on the metadata endpoint. The server holds no key that decrypts this.
#[utoipa::path(
    get,
    path = "/api/v1/search/index",
    responses(
        (status = 200, description = "Encrypted snapshot bytes", content_type = "application/octet-stream"),
        (status = 404, description = "No snapshot stored for this user"),
    ),
    security(("bearer_auth" = [])),
    tag = "search"
)]
#[get("/search/index")]
pub async fn download_snapshot(
    state: web::Data<SearchApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let bytes = state.service.download(&user.user_id)?;
    Ok(HttpResponse::Ok()
        .content_type("application/octet-stream")
        // The snapshot changes on every upload and is per-user secret material;
        // an intermediary must never keep a copy.
        .insert_header(("Cache-Control", "no-store, private"))
        .body(bytes))
}

/// Upload an encrypted snapshot, replacing the stored one.
///
/// `expectedVersion` is the concurrency token from `search.md`: send the
/// version you last saw and the write is rejected with 409 if the server has
/// moved on, so a device with a partial index cannot overwrite a fuller one.
/// Omit it to claim there is no snapshot yet. `force=true` overrides the check.
#[utoipa::path(
    put,
    path = "/api/v1/search/index",
    params(UploadSnapshotParams),
    request_body(content = Vec<u8>, description = "Encrypted snapshot bytes", content_type = "application/octet-stream"),
    responses(
        (status = 200, description = "Snapshot stored", body = SnapshotMetaResponse),
        (status = 400, description = "Empty body"),
        (status = 404, description = "Expected a version but no snapshot is stored"),
        (status = 409, description = "Version mismatch — pull and retry, or force"),
    ),
    security(("bearer_auth" = [])),
    tag = "search"
)]
#[put("/search/index")]
pub async fn upload_snapshot(
    state: web::Data<SearchApiState>,
    user: AuthenticatedUser,
    params: web::Query<UploadSnapshotParams>,
    body: web::Bytes,
) -> Result<HttpResponse, ApiError> {
    let outcome = state
        .service
        .upload(&user.user_id, &params.into_inner(), &body)?;

    match outcome {
        UploadOutcome::Stored(meta) => Ok(HttpResponse::Ok().json(meta)),
        // Reported through the standard `{ error: { code, message } }` envelope
        // so the shared API client surfaces the code like any other failure.
        // The version is in the message for logs only — a client recovering
        // from this re-pulls the snapshot anyway, and gets the version with it.
        UploadOutcome::Conflict { current_version } => Err(ApiError::new(
            409,
            SNAPSHOT_VERSION_CONFLICT,
            format!(
                "The stored snapshot is at version {current_version}; \
                 pull it before uploading, or retry with force."
            ),
        )),
    }
}

/// Discard the stored snapshot. Local indexes are untouched.
#[utoipa::path(
    delete,
    path = "/api/v1/search/index",
    responses((status = 204, description = "Snapshot discarded")),
    security(("bearer_auth" = [])),
    tag = "search"
)]
#[delete("/search/index")]
pub async fn delete_snapshot(
    state: web::Data<SearchApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    state.service.delete(&user.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(get_snapshot_meta)
        .service(download_snapshot)
        .service(upload_snapshot)
        .service(delete_snapshot);
}

#[derive(OpenApi)]
#[openapi(
    paths(get_snapshot_meta, download_snapshot, upload_snapshot, delete_snapshot),
    components(schemas(SnapshotMetaResponse)),
    tags((name = "search", description = "Encrypted client search index sync")),
    security(("bearer_auth" = []))
)]
pub struct SearchApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::private_store::PrivateStore;
    use crate::search::repository::{insert_test_user, test_pool, SearchSnapshotRepository};
    use crate::shared::TokenService;
    use actix_web::{test, App};

    /// Scratch directory that removes itself. Mirrors the service tests' helper;
    /// the project has no `tempfile` dependency.
    struct TestDir(std::path::PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("neutrino-search-api-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("temp dir");
            TestDir(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn test_state(dir: &TestDir) -> web::Data<SearchApiState> {
        let pool = test_pool();
        insert_test_user(&pool, "user-a");
        insert_test_user(&pool, "user-b");
        let store = Arc::new(PrivateStore::new(&dir.0).expect("private store"));
        let repo = Arc::new(SearchSnapshotRepository::new(pool));
        web::Data::new(SearchApiState {
            service: Arc::new(SearchSnapshotService::new(repo, store)),
        })
    }

    fn make_token_service() -> Arc<TokenService> {
        Arc::new(TokenService::new("test-secret-for-tests".to_string()))
    }

    fn bearer_for(ts: &TokenService, user_id: &str) -> String {
        let tok = ts
            .generate_access_token(user_id, &format!("{user_id}@example.com"))
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
                    .configure(configure),
            )
            .await
        }};
    }

    #[actix_web::test]
    async fn download_requires_authentication() {
        let dir = TestDir::new();
        let app = make_app!(test_state(&dir), make_token_service());
        let req = test::TestRequest::get().uri("/search/index").to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 401);
    }

    #[actix_web::test]
    async fn upload_requires_authentication() {
        let dir = TestDir::new();
        let app = make_app!(test_state(&dir), make_token_service());
        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=k&deviceId=d")
            .set_payload("bytes")
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 401);
    }

    #[actix_web::test]
    async fn meta_is_404_before_anything_is_uploaded() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let req = test::TestRequest::get()
            .uri("/search/index/meta")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 404);
    }

    #[actix_web::test]
    async fn upload_then_download_returns_the_same_bytes() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=sealed&deviceId=device-a")
            .insert_header(("Authorization", token.clone()))
            .set_payload("ciphertext-bytes")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["version"], 1);
        assert_eq!(body["wrappedKey"], "sealed");

        let req = test::TestRequest::get()
            .uri("/search/index")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        assert_eq!(test::read_body(resp).await.as_ref(), b"ciphertext-bytes");
    }

    #[actix_web::test]
    async fn a_stale_expected_version_is_rejected_with_the_conflict_code() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let token = bearer_for(&ts, "user-a");

        for uri in [
            "/search/index?wrappedKey=k&deviceId=a",
            "/search/index?expectedVersion=1&wrappedKey=k&deviceId=a",
        ] {
            let req = test::TestRequest::put()
                .uri(uri)
                .insert_header(("Authorization", token.clone()))
                .set_payload("good")
                .to_request();
            assert_eq!(test::call_service(&app, req).await.status(), 200);
        }

        // Now at version 2; a device still holding version 1 must lose.
        let req = test::TestRequest::put()
            .uri("/search/index?expectedVersion=1&wrappedKey=k&deviceId=b")
            .insert_header(("Authorization", token.clone()))
            .set_payload("stale")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 409);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["error"]["code"], "SNAPSHOT_VERSION_CONFLICT");

        // ...and the good snapshot is still what a download returns.
        let req = test::TestRequest::get()
            .uri("/search/index")
            .insert_header(("Authorization", token))
            .to_request();
        assert_eq!(
            test::read_body(test::call_service(&app, req).await)
                .await
                .as_ref(),
            b"good"
        );
    }

    #[actix_web::test]
    async fn force_overrides_the_version_check() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=k&deviceId=a")
            .insert_header(("Authorization", token.clone()))
            .set_payload("first")
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        let req = test::TestRequest::put()
            .uri("/search/index?expectedVersion=99&force=true&wrappedKey=k&deviceId=b")
            .insert_header(("Authorization", token.clone()))
            .set_payload("forced")
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;
        assert_eq!(body["version"], 2);

        let req = test::TestRequest::get()
            .uri("/search/index")
            .insert_header(("Authorization", token))
            .to_request();
        assert_eq!(
            test::read_body(test::call_service(&app, req).await)
                .await
                .as_ref(),
            b"forced"
        );
    }

    #[actix_web::test]
    async fn one_users_snapshot_is_invisible_to_another() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());

        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=k&deviceId=a")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .set_payload("user-a-secrets")
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        let req = test::TestRequest::get()
            .uri("/search/index")
            .insert_header(("Authorization", bearer_for(&ts, "user-b")))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 404);
    }

    #[actix_web::test]
    async fn an_empty_upload_is_rejected() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=k&deviceId=a")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 400);
    }

    #[actix_web::test]
    async fn delete_discards_the_snapshot() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=k&deviceId=a")
            .insert_header(("Authorization", token.clone()))
            .set_payload("bytes")
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        let req = test::TestRequest::delete()
            .uri("/search/index")
            .insert_header(("Authorization", token.clone()))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 204);

        let req = test::TestRequest::get()
            .uri("/search/index/meta")
            .insert_header(("Authorization", token))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 404);
    }

    #[actix_web::test]
    async fn the_snapshot_response_is_never_cached() {
        // It is per-user secret material that changes on every upload.
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/search/index?wrappedKey=k&deviceId=a")
            .insert_header(("Authorization", token.clone()))
            .set_payload("bytes")
            .to_request();
        test::call_service(&app, req).await;

        let req = test::TestRequest::get()
            .uri("/search/index")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        let cache_control = resp
            .headers()
            .get("Cache-Control")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(cache_control.contains("no-store"), "got {cache_control:?}");
    }
}
