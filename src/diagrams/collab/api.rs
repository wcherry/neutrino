use actix_web::{get, web, HttpRequest, HttpResponse};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tracing::{error, warn};
use yrs::updates::decoder::Decode;
use yrs::{ReadTxn, StateVector, Transact, Update};

use crate::diagrams::collab::repository::DiagramCollabRepository;
use crate::diagrams::collab::state::{DiagramCollabState, DiagramRoom};
use crate::shared::collab_protocol::{read_var_bytes, read_varint, write_var_bytes, write_varint};
use crate::shared::TokenService;

fn encode_sync_step2(update: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_varint(&mut buf, 0); // messageSync
    write_varint(&mut buf, 1); // syncStep2
    write_var_bytes(&mut buf, update);
    buf
}

fn encode_update(update: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_varint(&mut buf, 0); // messageSync
    write_varint(&mut buf, 2); // update
    write_var_bytes(&mut buf, update);
    buf
}

static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

enum ParsedMessage {
    SyncStep1(Vec<u8>),
    Update(Vec<u8>),
    Awareness(Vec<u8>),
}

fn parse_message(data: &[u8]) -> Option<ParsedMessage> {
    let (msg_type, c1) = read_varint(data)?;
    let rest = &data[c1..];
    match msg_type {
        0 => {
            let (sync_type, c2) = read_varint(rest)?;
            let payload_data = &rest[c2..];
            let (payload, _) = read_var_bytes(payload_data)?;
            match sync_type {
                0 => Some(ParsedMessage::SyncStep1(payload.to_vec())),
                1 | 2 => Some(ParsedMessage::Update(payload.to_vec())),
                _ => None,
            }
        }
        1 => Some(ParsedMessage::Awareness(rest.to_vec())),
        _ => None,
    }
}

// ── WebSocket handler ─────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/diagrams/{id}/ws",
    params(
        ("id" = String, Path, description = "Diagram ID"),
        ("token" = String, Query, description = "JWT access token for authentication"),
    ),
    responses(
        (status = 101, description = "WebSocket upgrade — y-websocket protocol for real-time collaboration"),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "diagrams-collab"
)]
#[get("/diagrams/{id}/ws")]
pub async fn diagram_collab_ws(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<String>,
    collab_state: web::Data<Arc<DiagramCollabState>>,
    collab_repo: web::Data<Arc<DiagramCollabRepository>>,
    token_service: web::Data<Arc<TokenService>>,
) -> Result<HttpResponse, actix_web::Error> {
    let file_id = path.into_inner();

    let token = req.uri().query().and_then(|q| {
        q.split('&')
            .find(|kv| kv.starts_with("token="))
            .map(|kv| kv["token=".len()..].to_string())
    });

    let _claims = match token {
        Some(ref t) => match token_service.validate_access_token(t) {
            Ok(c) => c,
            Err(_) => {
                return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
                    "error": {"code": "UNAUTHORIZED", "message": "Invalid token"}
                })));
            }
        },
        None => {
            return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
                "error": {"code": "UNAUTHORIZED", "message": "Token required"}
            })));
        }
    };

    let room = collab_state.get_or_create_room(&file_id);

    if room.session_count.load(Ordering::SeqCst) == 0 {
        if let Some(saved_bytes) = collab_repo.load_state(&file_id) {
            if let Ok(update) = Update::decode_v1(&saved_bytes) {
                let mut txn = room.doc.transact_mut();
                let _ = txn.apply_update(update);
            }
        }
    }

    room.session_count.fetch_add(1, Ordering::SeqCst);
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::SeqCst);

    let (response, mut session, msg_stream) = actix_ws::handle(&req, stream)?;

    let room_clone = room.clone();
    let file_id_clone = file_id.clone();
    let repo_clone = collab_repo.get_ref().clone();

    actix_web::rt::spawn(async move {
        let mut rx = room_clone.tx.subscribe();
        let mut stream = msg_stream
            .max_frame_size(8 * 1024 * 1024)
            .aggregate_continuations()
            .max_continuation_size(16 * 1024 * 1024);

        let initial_state = {
            let txn = room_clone.doc.transact();
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        if session
            .binary(encode_sync_step2(&initial_state))
            .await
            .is_err()
        {
            decrement_and_save(&room_clone, &repo_clone, &file_id_clone).await;
            return;
        }

        loop {
            tokio::select! {
                msg = stream.next() => {
                    match msg {
                        None => break,
                        Some(Err(e)) => {
                            warn!("WS error for diagram {}: {:?}", file_id_clone, e);
                            break;
                        }
                        Some(Ok(AggregatedMessage::Binary(bytes))) => {
                            match parse_message(&bytes) {
                                Some(ParsedMessage::SyncStep1(sv_bytes)) => {
                                    let reply = {
                                        let client_sv = StateVector::decode_v1(&sv_bytes)
                                            .unwrap_or_default();
                                        let txn = room_clone.doc.transact();
                                        let update = txn.encode_state_as_update_v1(&client_sv);
                                        encode_sync_step2(&update)
                                    };
                                    if session.binary(reply).await.is_err() {
                                        break;
                                    }
                                }
                                Some(ParsedMessage::Update(update_bytes)) => {
                                    {
                                        let mut txn = room_clone.doc.transact_mut();
                                        match Update::decode_v1(&update_bytes) {
                                            Ok(update) => {
                                                if let Err(e) = txn.apply_update(update) {
                                                    warn!("Failed to apply update for diagram {}: {:?}", file_id_clone, e);
                                                }
                                            }
                                            Err(e) => {
                                                warn!("Failed to decode update for diagram {}: {:?}", file_id_clone, e);
                                            }
                                        }
                                    }
                                    let _ = room_clone.tx.send((session_id, encode_update(&update_bytes)));
                                }
                                Some(ParsedMessage::Awareness(awareness_bytes)) => {
                                    let mut msg = Vec::new();
                                    write_varint(&mut msg, 1);
                                    msg.extend_from_slice(&awareness_bytes);
                                    let _ = room_clone.tx.send((session_id, msg));
                                }
                                None => {
                                    warn!("Unknown WS message format for diagram {}", file_id_clone);
                                }
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
                Ok((origin_session_id, broadcast)) = rx.recv() => {
                    // Skip messages this same session produced — the server
                    // broadcasts to every subscriber in the room, including the
                    // sender, so without this the sender would see its own
                    // edits echoed back as if a remote peer had made them.
                    if origin_session_id != session_id
                        && session.binary(broadcast).await.is_err() {
                        break;
                    }
                }
            }
        }

        decrement_and_save(&room_clone, &repo_clone, &file_id_clone).await;
    });

    Ok(response)
}

async fn decrement_and_save(
    room: &Arc<DiagramRoom>,
    repo: &Arc<DiagramCollabRepository>,
    file_id: &str,
) {
    let prev = room.session_count.fetch_sub(1, Ordering::SeqCst);
    if prev == 1 {
        let state_bytes = {
            let txn = room.doc.transact();
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        if let Err(e) = repo.save_state(file_id, state_bytes) {
            error!("Failed to persist Yjs state for diagram {}: {}", file_id, e);
        }
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(diagram_collab_ws);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(diagram_collab_ws),
    tags((name = "diagrams-collab", description = "Diagrams real-time collaboration endpoints"))
)]
pub struct DiagramsCollabApiDoc;
