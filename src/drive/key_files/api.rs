use crate::drive::key_files::{
    dto::{
        ArchivedKey, KeyFileResponse, KeyVersionUsage, KeyVersionUsageParams,
        KeyVersionUsageResponse, PutKeyFileRequest,
    },
    service::KeyFileService,
};
use crate::shared::{ApiError, AuthenticatedUser};
use actix_web::{delete, get, put, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct KeyFilesApiState {
    pub service: Arc<KeyFileService>,
}

/// A key file is wrapped secret material. It must not sit in a proxy cache or
/// a browser's disk cache, however short-lived.
fn no_store(mut resp: actix_web::HttpResponseBuilder, body: impl serde::Serialize) -> HttpResponse {
    resp.insert_header(("Cache-Control", "no-store, private"))
        .json(body)
}

/// Fetch the caller's key file.
///
/// Every entry is ciphertext the client wrapped; the server holds no key that
/// opens any of it.
#[utoipa::path(
    get,
    path = "/api/v1/drive/key-file",
    responses(
        (status = 200, description = "The caller's stored keys", body = KeyFileResponse),
        (status = 404, description = "No key file stored for this user"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-key-files"
)]
#[get("/key-file")]
pub async fn get_key_file(
    state: web::Data<KeyFilesApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    let key_file = state
        .service
        .get(&user.user_id)?
        .ok_or_else(|| ApiError::not_found("No key file stored"))?;
    Ok(no_store(HttpResponse::Ok(), key_file))
}

/// Store the caller's key file, replacing any existing one.
///
/// The request carries the complete set of keys, not a delta: dropping an
/// entry is how a client retires a key, so a merge here would make retirement
/// impossible. Check `/drive/key-versions` before dropping one — files still
/// sealed to it become unreadable the moment the last copy of the key is gone.
#[utoipa::path(
    put,
    path = "/api/v1/drive/key-file",
    request_body = PutKeyFileRequest,
    responses(
        (status = 200, description = "Key file stored", body = KeyFileResponse),
        (status = 400, description = "Empty, oversized, or duplicated keys"),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-key-files"
)]
#[put("/key-file")]
pub async fn put_key_file(
    state: web::Data<KeyFilesApiState>,
    user: AuthenticatedUser,
    body: web::Json<PutKeyFileRequest>,
) -> Result<HttpResponse, ApiError> {
    let stored = state
        .service
        .upsert(&user.user_id, body.into_inner().keys)?;
    Ok(no_store(HttpResponse::Ok(), stored))
}

/// Discard the caller's key file.
///
/// Irreversible, and the server never had a copy of what is inside: any file
/// still sealed to a version only this file held is unreadable afterwards.
#[utoipa::path(
    delete,
    path = "/api/v1/drive/key-file",
    responses((status = 204, description = "Key file discarded")),
    security(("bearer_auth" = [])),
    tag = "drive-key-files"
)]
#[delete("/key-file")]
pub async fn delete_key_file(
    state: web::Data<KeyFilesApiState>,
    user: AuthenticatedUser,
) -> Result<HttpResponse, ApiError> {
    state.service.delete(&user.user_id)?;
    Ok(HttpResponse::NoContent().finish())
}

/// How many of the caller's files each key version still opens, and which.
///
/// `countOnly=true` returns the same JSON with every `fileIds` empty — the
/// counts are the cheap question, and an account with a hundred thousand files
/// should not have to receive all their ids to ask it.
#[utoipa::path(
    get,
    path = "/api/v1/drive/key-versions",
    params(KeyVersionUsageParams),
    responses(
        (status = 200, description = "File counts, and ids, per key version", body = KeyVersionUsageResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "drive-key-files"
)]
#[get("/key-versions")]
pub async fn get_key_version_usage(
    state: web::Data<KeyFilesApiState>,
    user: AuthenticatedUser,
    params: web::Query<KeyVersionUsageParams>,
) -> Result<web::Json<KeyVersionUsageResponse>, ApiError> {
    let usage = state
        .service
        .usage(&user.user_id, params.into_inner().count_only)?;
    Ok(web::Json(usage))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(get_key_file)
        .service(put_key_file)
        .service(delete_key_file)
        .service(get_key_version_usage);
}

#[derive(OpenApi)]
#[openapi(
    paths(get_key_file, put_key_file, delete_key_file, get_key_version_usage),
    components(schemas(
        ArchivedKey,
        PutKeyFileRequest,
        KeyFileResponse,
        KeyVersionUsage,
        KeyVersionUsageResponse
    )),
    tags((
        name = "drive-key-files",
        description = "The archive of a user's retired identity keys, itself sealed to their active public key. Rotation retires a key rather than destroying it, so older files stay openable; the key file is stored whole rather than merged, because dropping an entry is how a client retires a key. The key-versions endpoint reports how many files each version still opens, so a client can see what it would lose before dropping one."
    )),
    security(("bearer_auth" = []))
)]
pub struct KeyFilesApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::private_store::PrivateStore;
    use crate::search::repository::{insert_test_user, test_pool, DbPool};
    use crate::shared::TokenService;
    use actix_web::{test, App};
    use serde_json::json;

    /// Scratch directory that removes itself. Mirrors `search::api`'s helper;
    /// the project has no `tempfile` dependency.
    struct TestDir(std::path::PathBuf);

    impl TestDir {
        fn new() -> Self {
            let path = std::env::temp_dir()
                .join(format!("neutrino-key-files-api-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("temp dir");
            TestDir(path)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    fn test_state(dir: &TestDir, pool: DbPool) -> web::Data<KeyFilesApiState> {
        let store = Arc::new(PrivateStore::new(&dir.0).expect("private store"));
        let repo = Arc::new(EncryptionRepository::new(pool));
        web::Data::new(KeyFilesApiState {
            service: Arc::new(KeyFileService::new(store, repo)),
        })
    }

    fn seeded_pool() -> DbPool {
        let pool = test_pool();
        insert_test_user(&pool, "user-a");
        insert_test_user(&pool, "user-b");
        pool
    }

    fn insert_file(pool: &DbPool, file_id: &str, owner: &str) {
        use diesel::RunQueryDsl;
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(format!(
            "INSERT INTO files (id, user_id, name, size_bytes, mime_type, storage_path, \
             created_at, updated_at, is_starred, content_version) \
             VALUES ('{file_id}', '{owner}', '{file_id}.bin', 10, 'application/octet-stream', \
             '/tmp/{file_id}', '2026-08-03 00:00:00', '2026-08-03 00:00:00', 0, 1)"
        ))
        .execute(&mut conn)
        .expect("insert file");
    }

    /// Inserts the key ref directly rather than through the repository, so a
    /// ref can be pointed at a file id that does not exist — which is exactly
    /// what a permanent delete leaves behind.
    fn insert_key_ref(pool: &DbPool, file_id: &str, user_id: &str, key_version: i32) {
        use diesel::RunQueryDsl;
        let mut conn = pool.get().expect("conn");
        diesel::sql_query(format!(
            "INSERT INTO file_key_refs (id, file_id, user_id, encrypted_file_key, created_at, key_version) \
             VALUES ('{file_id}-{user_id}', '{file_id}', '{user_id}', 'sealed', \
             '2026-08-03 00:00:00', {key_version})"
        ))
        .execute(&mut conn)
        .expect("insert key ref");
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
    async fn every_route_requires_authentication() {
        let dir = TestDir::new();
        let app = make_app!(test_state(&dir, seeded_pool()), make_token_service());

        for req in [
            test::TestRequest::get().uri("/key-file").to_request(),
            test::TestRequest::put()
                .uri("/key-file")
                .set_json(json!({ "keys": [] }))
                .to_request(),
            test::TestRequest::delete().uri("/key-file").to_request(),
            test::TestRequest::get().uri("/key-versions").to_request(),
        ] {
            assert_eq!(test::call_service(&app, req).await.status(), 401);
        }
    }

    #[actix_web::test]
    async fn the_key_file_is_404_before_anything_is_stored() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());

        let req = test::TestRequest::get()
            .uri("/key-file")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 404);
    }

    #[actix_web::test]
    async fn a_stored_key_file_comes_back_verbatim_and_version_sorted() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/key-file")
            .insert_header(("Authorization", token.clone()))
            .set_json(json!({
                "keys": [
                    { "keyVersion": 2, "encryptedKey": "wrapped-v2" },
                    { "keyVersion": 1, "encryptedKey": "wrapped-v1", "publicKey": "pk-v1" },
                ]
            }))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        let req = test::TestRequest::get()
            .uri("/key-file")
            .insert_header(("Authorization", token))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;

        assert_eq!(body["userId"], "user-a");
        assert_eq!(body["keys"][0]["keyVersion"], 1);
        assert_eq!(body["keys"][0]["encryptedKey"], "wrapped-v1");
        assert_eq!(body["keys"][0]["publicKey"], "pk-v1");
        assert_eq!(body["keys"][1]["keyVersion"], 2);
        assert_eq!(body["keys"][1]["encryptedKey"], "wrapped-v2");
        // Absent rather than null, so a client can't mistake "no public key
        // was sent" for "the public key is empty".
        assert!(body["keys"][1].get("publicKey").is_none());
    }

    #[actix_web::test]
    async fn a_second_put_replaces_the_stored_set_rather_than_merging_it() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        for keys in [
            json!([
                { "keyVersion": 1, "encryptedKey": "wrapped-v1" },
                { "keyVersion": 2, "encryptedKey": "wrapped-v2" },
            ]),
            json!([{ "keyVersion": 2, "encryptedKey": "wrapped-v2" }]),
        ] {
            let req = test::TestRequest::put()
                .uri("/key-file")
                .insert_header(("Authorization", token.clone()))
                .set_json(json!({ "keys": keys }))
                .to_request();
            assert_eq!(test::call_service(&app, req).await.status(), 200);
        }

        let req = test::TestRequest::get()
            .uri("/key-file")
            .insert_header(("Authorization", token))
            .to_request();
        let body: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;
        assert_eq!(body["keys"].as_array().expect("keys").len(), 1);
        assert_eq!(body["keys"][0]["keyVersion"], 2);
    }

    #[actix_web::test]
    async fn a_replacement_keeps_the_original_creation_time() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let put = |payload: serde_json::Value| {
            test::TestRequest::put()
                .uri("/key-file")
                .insert_header(("Authorization", token.clone()))
                .set_json(payload)
                .to_request()
        };

        let first: serde_json::Value = test::read_body_json(
            test::call_service(
                &app,
                put(json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "a" }] })),
            )
            .await,
        )
        .await;
        let second: serde_json::Value = test::read_body_json(
            test::call_service(
                &app,
                put(json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "b" }] })),
            )
            .await,
        )
        .await;

        assert_eq!(first["createdAt"], second["createdAt"]);
    }

    #[actix_web::test]
    async fn a_key_file_nothing_could_use_is_rejected() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        for payload in [
            // No keys at all — that is what DELETE is for.
            json!({ "keys": [] }),
            // Version 0 matches no `user_public_keys.version`.
            json!({ "keys": [{ "keyVersion": 0, "encryptedKey": "wrapped" }] }),
            // An entry that unwraps to nothing.
            json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "" }] }),
            // Two entries for one version: one is wrong and the server cannot
            // tell which.
            json!({ "keys": [
                { "keyVersion": 1, "encryptedKey": "a" },
                { "keyVersion": 1, "encryptedKey": "b" },
            ]}),
        ] {
            let req = test::TestRequest::put()
                .uri("/key-file")
                .insert_header(("Authorization", token.clone()))
                .set_json(&payload)
                .to_request();
            assert_eq!(
                test::call_service(&app, req).await.status(),
                400,
                "expected 400 for {payload}"
            );
        }
    }

    #[actix_web::test]
    async fn a_rejected_put_leaves_the_stored_key_file_untouched() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/key-file")
            .insert_header(("Authorization", token.clone()))
            .set_json(json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "good" }] }))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        let req = test::TestRequest::put()
            .uri("/key-file")
            .insert_header(("Authorization", token.clone()))
            .set_json(json!({ "keys": [] }))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 400);

        let req = test::TestRequest::get()
            .uri("/key-file")
            .insert_header(("Authorization", token))
            .to_request();
        let body: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;
        assert_eq!(body["keys"][0]["encryptedKey"], "good");
    }

    #[actix_web::test]
    async fn delete_discards_the_key_file_and_is_idempotent() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/key-file")
            .insert_header(("Authorization", token.clone()))
            .set_json(json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "wrapped" }] }))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        for _ in 0..2 {
            let req = test::TestRequest::delete()
                .uri("/key-file")
                .insert_header(("Authorization", token.clone()))
                .to_request();
            assert_eq!(test::call_service(&app, req).await.status(), 204);
        }

        let req = test::TestRequest::get()
            .uri("/key-file")
            .insert_header(("Authorization", token))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 404);
    }

    #[actix_web::test]
    async fn one_users_key_file_is_invisible_to_another() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());

        let req = test::TestRequest::put()
            .uri("/key-file")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .set_json(json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "user-a-secret" }] }))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 200);

        let req = test::TestRequest::get()
            .uri("/key-file")
            .insert_header(("Authorization", bearer_for(&ts, "user-b")))
            .to_request();
        assert_eq!(test::call_service(&app, req).await.status(), 404);
    }

    #[actix_web::test]
    async fn the_key_file_response_is_never_cached() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());
        let token = bearer_for(&ts, "user-a");

        let req = test::TestRequest::put()
            .uri("/key-file")
            .insert_header(("Authorization", token.clone()))
            .set_json(json!({ "keys": [{ "keyVersion": 1, "encryptedKey": "wrapped" }] }))
            .to_request();
        let resp = test::call_service(&app, req).await;
        let put_cache_control = resp
            .headers()
            .get("Cache-Control")
            .and_then(|v| v.to_str().ok())
            .unwrap_or_default()
            .to_string();
        assert!(put_cache_control.contains("no-store"));

        let req = test::TestRequest::get()
            .uri("/key-file")
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

    /// A pool where user-a has two files on version 1, one on version 2, an
    /// orphaned ref left by a permanent delete, and user-b has one of their own.
    fn pool_with_key_refs() -> DbPool {
        let pool = seeded_pool();
        for (file_id, owner, version) in [
            ("file-1", "user-a", 1),
            ("file-2", "user-a", 1),
            ("file-3", "user-a", 2),
            ("file-4", "user-b", 1),
        ] {
            insert_file(&pool, file_id, owner);
            insert_key_ref(&pool, file_id, owner, version);
        }
        // No `files` row: the file was permanently deleted, the ref survived.
        insert_key_ref(&pool, "file-gone", "user-a", 1);
        pool
    }

    #[actix_web::test]
    async fn usage_reports_counts_and_file_ids_per_key_version() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, pool_with_key_refs()), ts.clone());

        let req = test::TestRequest::get()
            .uri("/key-versions")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .to_request();
        let resp = test::call_service(&app, req).await;
        assert_eq!(resp.status(), 200);
        let body: serde_json::Value = test::read_body_json(resp).await;

        assert_eq!(body["userId"], "user-a");
        assert_eq!(body["countOnly"], false);
        assert_eq!(body["totalFiles"], 3);
        assert_eq!(body["keyVersions"][0]["keyVersion"], 1);
        assert_eq!(body["keyVersions"][0]["count"], 2);
        assert_eq!(
            body["keyVersions"][0]["fileIds"],
            json!(["file-1", "file-2"])
        );
        assert_eq!(body["keyVersions"][1]["keyVersion"], 2);
        assert_eq!(body["keyVersions"][1]["count"], 1);
        assert_eq!(body["keyVersions"][1]["fileIds"], json!(["file-3"]));
    }

    #[actix_web::test]
    async fn count_only_keeps_the_same_shape_with_the_ids_left_out() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, pool_with_key_refs()), ts.clone());

        for uri in [
            "/key-versions?countOnly=true",
            "/key-versions?count_only=true",
        ] {
            let req = test::TestRequest::get()
                .uri(uri)
                .insert_header(("Authorization", bearer_for(&ts, "user-a")))
                .to_request();
            let body: serde_json::Value =
                test::read_body_json(test::call_service(&app, req).await).await;

            assert_eq!(body["countOnly"], true, "for {uri}");
            assert_eq!(body["totalFiles"], 3, "for {uri}");
            assert_eq!(body["keyVersions"][0]["keyVersion"], 1);
            assert_eq!(body["keyVersions"][0]["count"], 2);
            assert_eq!(body["keyVersions"][0]["fileIds"], json!([]));
            assert_eq!(body["keyVersions"][1]["count"], 1);
            assert_eq!(body["keyVersions"][1]["fileIds"], json!([]));
        }
    }

    /// The counts exist to answer "is this key still load bearing". A ref whose
    /// file is gone would answer yes when nothing is left to re-seal.
    #[actix_web::test]
    async fn a_ref_left_behind_by_a_permanent_delete_is_not_counted() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, pool_with_key_refs()), ts.clone());

        for uri in ["/key-versions", "/key-versions?countOnly=true"] {
            let req = test::TestRequest::get()
                .uri(uri)
                .insert_header(("Authorization", bearer_for(&ts, "user-a")))
                .to_request();
            let body: serde_json::Value =
                test::read_body_json(test::call_service(&app, req).await).await;
            assert_eq!(body["keyVersions"][0]["count"], 2, "for {uri}");
        }
    }

    #[actix_web::test]
    async fn usage_counts_only_the_callers_own_key_refs() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, pool_with_key_refs()), ts.clone());

        let req = test::TestRequest::get()
            .uri("/key-versions")
            .insert_header(("Authorization", bearer_for(&ts, "user-b")))
            .to_request();
        let body: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;

        assert_eq!(body["totalFiles"], 1);
        assert_eq!(body["keyVersions"][0]["fileIds"], json!(["file-4"]));
    }

    #[actix_web::test]
    async fn usage_is_empty_for_a_user_with_no_encrypted_files() {
        let dir = TestDir::new();
        let ts = make_token_service();
        let app = make_app!(test_state(&dir, seeded_pool()), ts.clone());

        let req = test::TestRequest::get()
            .uri("/key-versions")
            .insert_header(("Authorization", bearer_for(&ts, "user-a")))
            .to_request();
        let body: serde_json::Value =
            test::read_body_json(test::call_service(&app, req).await).await;

        assert_eq!(body["totalFiles"], 0);
        assert_eq!(body["keyVersions"], json!([]));
    }
}
