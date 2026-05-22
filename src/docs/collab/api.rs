use actix_web::{get, web, HttpRequest, HttpResponse};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use std::sync::Arc;
use std::sync::atomic::Ordering;
use tracing::{error, warn};
use yrs::{ReadTxn, StateVector, Transact, Update};
use yrs::updates::decoder::Decode;

use crate::docs::collab::repository::CollabRepository;
use crate::docs::collab::state::{CollabState, DocRoom};
use crate::shared::TokenService;

// --- y-websocket protocol helpers ---

fn write_varint(buf: &mut Vec<u8>, mut n: u64) {
    loop {
        let byte = (n & 0x7F) as u8;
        n >>= 7;
        if n == 0 {
            buf.push(byte);
            break;
        } else {
            buf.push(byte | 0x80);
        }
    }
}

fn read_varint(data: &[u8]) -> Option<(u64, usize)> {
    let mut result = 0u64;
    let mut shift = 0u32;
    let mut consumed = 0usize;
    for &byte in data {
        consumed += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            return Some((result, consumed));
        }
        shift += 7;
        if shift >= 64 {
            return None;
        }
    }
    None
}

fn write_var_bytes(buf: &mut Vec<u8>, bytes: &[u8]) {
    write_varint(buf, bytes.len() as u64);
    buf.extend_from_slice(bytes);
}

fn read_var_bytes(data: &[u8]) -> Option<(&[u8], usize)> {
    let (len, header_len) = read_varint(data)?;
    let end = header_len + len as usize;
    if end > data.len() {
        return None;
    }
    Some((&data[header_len..end], end))
}

/// Encode a y-websocket SyncStep2 message (full state sent to new client).
fn encode_sync_step2(update: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_varint(&mut buf, 0); // messageSync
    write_varint(&mut buf, 1); // syncStep2
    write_var_bytes(&mut buf, update);
    buf
}

/// Encode a y-websocket Update message (incremental, broadcast to peers).
fn encode_update(update: &[u8]) -> Vec<u8> {
    let mut buf = Vec::new();
    write_varint(&mut buf, 0); // messageSync
    write_varint(&mut buf, 2); // update
    write_var_bytes(&mut buf, update);
    buf
}

enum ParsedMessage {
    SyncStep1(Vec<u8>), // client's state vector bytes
    Update(Vec<u8>),    // Yjs update bytes (syncStep2 or update)
    Awareness(Vec<u8>), // raw awareness payload bytes (pass-through)
}

fn parse_message(data: &[u8]) -> Option<ParsedMessage> {
    let (msg_type, c1) = read_varint(data)?;
    let rest = &data[c1..];
    match msg_type {
        0 => {
            // sync message
            let (sync_type, c2) = read_varint(rest)?;
            let payload_data = &rest[c2..];
            let (payload, _) = read_var_bytes(payload_data)?;
            match sync_type {
                0 => Some(ParsedMessage::SyncStep1(payload.to_vec())),
                1 | 2 => Some(ParsedMessage::Update(payload.to_vec())),
                _ => None,
            }
        }
        1 => {
            // awareness message — forward raw bytes after the type byte
            Some(ParsedMessage::Awareness(rest.to_vec()))
        }
        _ => None,
    }
}

// --- WebSocket handler ---

#[utoipa::path(
    get,
    path = "/api/v1/docs/{id}/ws",
    params(
        ("id" = String, Path, description = "Document ID"),
        ("token" = String, Query, description = "JWT access token for authentication"),
    ),
    responses(
        (status = 101, description = "WebSocket upgrade — y-websocket protocol for real-time collaboration"),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "docs-collab"
)]
#[get("/docs/{id}/ws")]
pub async fn collab_ws(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<String>,
    collab_state: web::Data<Arc<CollabState>>,
    collab_repo: web::Data<Arc<CollabRepository>>,
    token_service: web::Data<Arc<TokenService>>,
) -> Result<HttpResponse, actix_web::Error> {
    let file_id = path.into_inner();

    // Authenticate via ?token=<jwt> query param (standard for WebSocket auth)
    let token = req
        .uri()
        .query()
        .and_then(|q| {
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

    // Load persisted Yjs state into the doc on first connection
    if room.session_count.load(Ordering::SeqCst) == 0 {
        if let Some(saved_bytes) = collab_repo.load_state(&file_id) {
            if let Ok(update) = Update::decode_v1(&saved_bytes) {
                let mut txn = room.doc.transact_mut();
                let _ = txn.apply_update(update);
            }
        }
    }

    room.session_count.fetch_add(1, Ordering::SeqCst);

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

        // Send full document state to the newly connected client (SyncStep2)
        let initial_state = {
            let txn = room_clone.doc.transact();
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        if session.binary(encode_sync_step2(&initial_state)).await.is_err() {
            decrement_and_save(&room_clone, &repo_clone, &file_id_clone).await;
            return;
        }

        loop {
            tokio::select! {
                msg = stream.next() => {
                    match msg {
                        None => break,
                        Some(Err(e)) => {
                            warn!("WS error for doc {}: {:?}", file_id_clone, e);
                            break;
                        }
                        Some(Ok(AggregatedMessage::Binary(bytes))) => {
                            match parse_message(&bytes) {
                                Some(ParsedMessage::SyncStep1(sv_bytes)) => {
                                    // Client sent their state vector; reply with updates they're missing
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
                                    // Apply update to the shared doc, then broadcast to peers
                                    {
                                        let mut txn = room_clone.doc.transact_mut();
                                        match Update::decode_v1(&update_bytes) {
                                            Ok(update) => {
                                                if let Err(e) = txn.apply_update(update) {
                                                    warn!("Failed to apply update for doc {}: {:?}", file_id_clone, e);
                                                }
                                            }
                                            Err(e) => {
                                                warn!("Failed to decode update for doc {}: {:?}", file_id_clone, e);
                                            }
                                        }
                                    }
                                    let _ = room_clone.tx.send(encode_update(&update_bytes));
                                }
                                Some(ParsedMessage::Awareness(awareness_bytes)) => {
                                    // Broadcast awareness (cursors, presence) to all peers
                                    let mut msg = Vec::new();
                                    write_varint(&mut msg, 1); // messageAwareness
                                    msg.extend_from_slice(&awareness_bytes);
                                    let _ = room_clone.tx.send(msg);
                                }
                                None => {
                                    warn!("Unknown WS message format for doc {}", file_id_clone);
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
                Ok(broadcast) = rx.recv() => {
                    if session.binary(broadcast).await.is_err() {
                        break;
                    }
                }
            }
        }

        decrement_and_save(&room_clone, &repo_clone, &file_id_clone).await;
    });

    Ok(response)
}

async fn decrement_and_save(room: &Arc<DocRoom>, repo: &Arc<CollabRepository>, file_id: &str) {
    let prev = room.session_count.fetch_sub(1, Ordering::SeqCst);
    if prev == 1 {
        // Last session left — persist the doc state
        let state_bytes = {
            let txn = room.doc.transact();
            txn.encode_state_as_update_v1(&StateVector::default())
        };
        if let Err(e) = repo.save_state(file_id, state_bytes) {
            error!("Failed to persist Yjs state for doc {}: {}", file_id, e);
        }
    }
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(collab_ws);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(collab_ws),
    tags((name = "docs-collab", description = "Docs real-time collaboration endpoints"))
)]
pub struct CollabApiDoc;
