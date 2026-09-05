use actix_web::{get, web, HttpRequest, HttpResponse, ResponseError};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tracing::warn;

use crate::shared::drive_client::DriveClient;
use crate::shared::file_events::state::FileEventsState;
use crate::shared::{AuthenticatedUser, TokenService};

/// Messages are relayed verbatim to the other clients in the room; the server
/// never inspects the payloads.
///
/// * `1` — awareness (who is viewing the file).
/// * `2` — file-updated signal. Only a signal: the payload carries no file
///   content, so peers re-read the file through its normal (E2EE-aware) read
///   path instead of the server relaying plaintext it must not see.
enum ParsedMessage {
    Awareness(Vec<u8>),
    FileUpdated(Vec<u8>),
    Other,
}

fn parse_message(data: &[u8]) -> ParsedMessage {
    let Some((msg_type, c1)) = crate::shared::collab_protocol::read_varint(data) else {
        return ParsedMessage::Other;
    };
    match msg_type {
        1 => ParsedMessage::Awareness(data[c1..].to_vec()),
        2 => ParsedMessage::FileUpdated(data[c1..].to_vec()),
        _ => ParsedMessage::Other,
    }
}

/// Authenticates `?token=` and checks the caller has at least read access to
/// `file_id`, returning the user on success. WebSockets cannot set an
/// `Authorization` header, so the token travels in the query string — the
/// same convention every other collab/presence socket in this codebase uses.
async fn authenticate(
    req: &HttpRequest,
    file_id: &str,
    token_service: &TokenService,
    drive: &DriveClient,
) -> Result<AuthenticatedUser, HttpResponse> {
    let token = req.uri().query().and_then(|q| {
        q.split('&')
            .find(|kv| kv.starts_with("token="))
            .map(|kv| kv["token=".len()..].to_string())
    });

    let Some(token) = token else {
        return Err(HttpResponse::Unauthorized().json(serde_json::json!({
            "error": {"code": "UNAUTHORIZED", "message": "Token required"}
        })));
    };

    let claims = token_service.validate_access_token(&token).map_err(|_| {
        HttpResponse::Unauthorized().json(serde_json::json!({
            "error": {"code": "UNAUTHORIZED", "message": "Invalid token"}
        }))
    })?;

    let user = AuthenticatedUser {
        user_id: claims.sub,
        email: claims.email,
        token,
        is_admin: claims.is_admin,
    };

    let file = drive
        .get_file(&user, file_id, "File not found")
        .await
        .map_err(|e| e.error_response())?;
    if file.deleted_at.is_some() {
        return Err(HttpResponse::NotFound().json(serde_json::json!({
            "error": {"code": "NOT_FOUND", "message": "File not found"}
        })));
    }

    Ok(user)
}

/// Open the per-file event socket.
///
/// Relays presence and "this file changed" signals to everyone with the file open, whatever its
/// type, so a client can refresh without polling. Access is checked on connect and the token
/// comes from `?token=<jwt>`.
#[utoipa::path(
    get,
    path = "/api/v1/files/{id}/ws",
    params(
        ("id" = String, Path, description = "File ID"),
        ("token" = String, Query, description = "JWT access token"),
    ),
    responses(
        (status = 101, description = "WebSocket upgrade — awareness + file-updated signal relay"),
        (status = 401, description = "Unauthorized"),
        (status = 403, description = "Access denied"),
        (status = 404, description = "File not found"),
    ),
    tag = "file-events"
)]
#[get("/files/{id}/ws")]
pub async fn file_events_ws(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<String>,
    presence_state: web::Data<Arc<FileEventsState>>,
    token_service: web::Data<Arc<TokenService>>,
    drive: web::Data<Arc<DriveClient>>,
) -> Result<HttpResponse, actix_web::Error> {
    let file_id = path.into_inner();

    let _user = match authenticate(&req, &file_id, &token_service, &drive).await {
        Ok(user) => user,
        Err(resp) => return Ok(resp),
    };

    let room = presence_state.get_or_create_room(&file_id);
    room.session_count.fetch_add(1, Ordering::SeqCst);

    let (response, mut session, msg_stream) = actix_ws::handle(&req, stream)?;

    let room_clone = room.clone();

    actix_web::rt::spawn(async move {
        let mut rx = room_clone.tx.subscribe();
        let mut stream = msg_stream
            .max_frame_size(64 * 1024)
            .aggregate_continuations()
            .max_continuation_size(128 * 1024);

        loop {
            tokio::select! {
                msg = stream.next() => {
                    match msg {
                        None => break,
                        Some(Err(e)) => {
                            warn!("WS error for file events {}: {:?}", file_id, e);
                            break;
                        }
                        Some(Ok(AggregatedMessage::Binary(bytes))) => {
                            match parse_message(&bytes) {
                                ParsedMessage::Awareness(awareness_bytes) => {
                                    let mut msg = Vec::new();
                                    crate::shared::collab_protocol::write_varint(&mut msg, 1);
                                    msg.extend_from_slice(&awareness_bytes);
                                    let _ = room_clone.tx.send(msg);
                                }
                                ParsedMessage::FileUpdated(update_bytes) => {
                                    let mut msg = Vec::new();
                                    crate::shared::collab_protocol::write_varint(&mut msg, 2);
                                    msg.extend_from_slice(&update_bytes);
                                    let _ = room_clone.tx.send(msg);
                                }
                                ParsedMessage::Other => {}
                            }
                        }
                        Some(Ok(AggregatedMessage::Ping(msg))) => {
                            if session.pong(&msg).await.is_err() {
                                break;
                            }
                        }
                        Some(Ok(AggregatedMessage::Close(_))) => break,
                        _ => {}
                    }
                }
                Ok(broadcast) = rx.recv() => {
                    if session.binary(broadcast).await.is_err() {
                        break;
                    }
                }
            }
        }

        room_clone.session_count.fetch_sub(1, Ordering::SeqCst);
    });

    Ok(response)
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(file_events_ws);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(file_events_ws),
    tags((
        name = "file-events",
        description = "A per-file WebSocket that relays presence and \"this file changed\" signals to everyone who has the file open, whatever its type. It carries signals rather than content, so a client knows to refetch without polling; access is checked on connect and the token arrives as a query parameter."
    ))
)]
pub struct FileEventsApiDoc;

#[cfg(test)]
mod tests {
    use super::*;
    use crate::auth::{repository::AuthRepository, service::AuthService};
    use crate::drive::encryption::repository::EncryptionRepository;
    use crate::drive::filesystem::repository::FilesystemRepository;
    use crate::drive::feature_flags::gate::FeatureGate;
    use crate::drive::feature_flags::repository::FeatureFlagsRepository;
    use crate::drive::permissions::model::NewPermissionRecord;
    use crate::drive::permissions::repository::PermissionsRepository;
    use crate::drive::permissions::service::PermissionsService;
    use crate::drive::storage::model::NewFileRecord;
    use crate::drive::storage::repository::StorageRepository;
    use crate::drive::storage::service::StorageService;
    use crate::drive::storage::store::LocalFileStore;
    use crate::drive::workspace::{repository::WorkspaceRepository, service::WorkspaceService};
    use crate::shared::DbPool;
    use actix_web::test::TestRequest;
    use diesel::r2d2::{ConnectionManager, Pool};
    use diesel::SqliteConnection;
    use diesel_migrations::MigrationHarness;
    use std::path::PathBuf;

    const NOTE_MIME: &str = "application/x-neutrino-note";

    fn test_pool() -> DbPool {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool = Pool::builder().max_size(1).build(manager).expect("test pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");
        pool
    }

    struct Harness {
        drive: DriveClient,
        token_service: TokenService,
        storage_repo: StorageRepository,
        permissions_repo: PermissionsRepository,
        fs_repo: FilesystemRepository,
        base_dir: PathBuf,
    }

    fn build_harness() -> Harness {
        let pool = test_pool();
        let base = std::env::temp_dir()
            .join(format!("neutrino_file_events_test_{}", uuid::Uuid::new_v4()));
        let store = Arc::new(LocalFileStore::new(&base).expect("create store"));

        let workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
        let workspace_service = Arc::new(WorkspaceService::new(workspace_repo));
        let encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));
        let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
        let token_service = TokenService::new("test-secret".to_string());
        let auth_service = Arc::new(AuthService::new(
            auth_repo,
            Arc::new(TokenService::new("test-secret".to_string())),
            Arc::new(crate::auth::password_policy::PasswordPolicyRepository::new(pool.clone())),
        ));
        let permissions_repo_for_assertions = PermissionsRepository::new(pool.clone());
        let permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
        let feature_gate = FeatureGate::new(Arc::new(FeatureFlagsRepository::new(pool.clone())));
        let permissions_service = Arc::new(PermissionsService::new(
            permissions_repo,
            workspace_service,
            encryption_repo,
            auth_service,
            feature_gate,
        ));

        let storage_repo_for_assertions = StorageRepository::new(pool.clone());
        let storage_repo = Arc::new(StorageRepository::new(pool.clone()));
        let storage_service = Arc::new(StorageService::new(
            storage_repo,
            store,
            permissions_service.clone(),
        ));
        let fs_repo_for_assertions = FilesystemRepository::new(pool.clone());
        let fs_repo = Arc::new(FilesystemRepository::new(pool.clone()));
        let drive = DriveClient::new(storage_service, permissions_service, fs_repo);

        Harness {
            drive,
            token_service,
            storage_repo: storage_repo_for_assertions,
            permissions_repo: permissions_repo_for_assertions,
            fs_repo: fs_repo_for_assertions,
            base_dir: base,
        }
    }

    fn insert_file(repo: &StorageRepository, id: &str, owner_id: &str, name: &str) {
        repo.insert_file(NewFileRecord {
            id,
            user_id: owner_id,
            name,
            size_bytes: 0,
            mime_type: NOTE_MIME,
            storage_path: "",
            folder_id: None,
            encrypted_metadata: None,
        })
        .expect("insert file");
    }

    fn grant_role(repo: &PermissionsRepository, resource_id: &str, user_id: &str, role: &str) {
        repo.upsert_permission(&NewPermissionRecord {
            id: &uuid::Uuid::new_v4().to_string(),
            resource_type: "file",
            resource_id,
            user_id,
            role,
            granted_by: user_id,
            user_email: &format!("{user_id}@example.com"),
            user_name: user_id,
        })
        .expect("grant role");
    }

    fn req_with_token(file_id: &str, token: &str) -> HttpRequest {
        TestRequest::get()
            .uri(&format!("/files/{file_id}/ws?token={token}"))
            .to_http_request()
    }

    /// `AuthenticatedUser` doesn't derive `Debug`, so `Result::expect_err` (which
    /// requires `T: Debug`) can't be used directly on `authenticate`'s return type.
    fn assert_rejected(
        result: Result<AuthenticatedUser, HttpResponse>,
        expected: actix_web::http::StatusCode,
    ) {
        match result {
            Ok(_) => panic!("expected a rejection with status {expected}, got Ok"),
            Err(resp) => assert_eq!(resp.status(), expected),
        }
    }

    #[tokio::test]
    async fn authenticate_rejects_missing_token() {
        let h = build_harness();
        let req = TestRequest::get().uri("/files/f1/ws").to_http_request();

        let result = authenticate(&req, "f1", &h.token_service, &h.drive).await;
        assert_rejected(result, actix_web::http::StatusCode::UNAUTHORIZED);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn authenticate_rejects_invalid_token() {
        let h = build_harness();
        let req = req_with_token("f1", "not-a-real-token");

        let result = authenticate(&req, "f1", &h.token_service, &h.drive).await;
        assert_rejected(result, actix_web::http::StatusCode::UNAUTHORIZED);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn authenticate_rejects_a_user_with_no_access_to_the_file() {
        let h = build_harness();
        insert_file(&h.storage_repo, "f1", "owner-1", "Note");
        grant_role(&h.permissions_repo, "f1", "owner-1", "owner");
        let token = h
            .token_service
            .generate_access_token("stranger-1", "stranger-1@example.com")
            .expect("token");
        let req = req_with_token("f1", &token);

        let result = authenticate(&req, "f1", &h.token_service, &h.drive).await;
        assert_rejected(result, actix_web::http::StatusCode::FORBIDDEN);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn authenticate_rejects_a_deleted_file() {
        let h = build_harness();
        insert_file(&h.storage_repo, "f1", "owner-1", "Note");
        grant_role(&h.permissions_repo, "f1", "owner-1", "owner");
        h.fs_repo.trash_file("f1", "owner-1").expect("trash file");
        let token = h
            .token_service
            .generate_access_token("owner-1", "owner-1@example.com")
            .expect("token");
        let req = req_with_token("f1", &token);

        let result = authenticate(&req, "f1", &h.token_service, &h.drive).await;
        assert_rejected(result, actix_web::http::StatusCode::NOT_FOUND);

        let _ = std::fs::remove_dir_all(h.base_dir);
    }

    #[tokio::test]
    async fn authenticate_allows_a_user_with_read_access() {
        let h = build_harness();
        insert_file(&h.storage_repo, "f1", "owner-1", "Note");
        grant_role(&h.permissions_repo, "f1", "owner-1", "owner");
        grant_role(&h.permissions_repo, "f1", "viewer-1", "viewer");
        let token = h
            .token_service
            .generate_access_token("viewer-1", "viewer-1@example.com")
            .expect("token");
        let req = req_with_token("f1", &token);

        let user = authenticate(&req, "f1", &h.token_service, &h.drive)
            .await
            .expect("a viewer should be allowed to connect");
        assert_eq!(user.user_id, "viewer-1");

        let _ = std::fs::remove_dir_all(h.base_dir);
    }
}
