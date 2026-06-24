use actix_web::{get, web, HttpRequest, HttpResponse};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tracing::warn;

use crate::shared::collab_protocol::{read_varint, write_varint};
use crate::shared::TokenService;
use crate::sheets::presence::state::SheetPresenceState;

/// Encodes an empty SyncStep2 so the client sets syncReady=true.
fn encode_empty_sync_step2() -> Vec<u8> {
    let mut buf = Vec::new();
    write_varint(&mut buf, 0); // messageSync
    write_varint(&mut buf, 1); // syncStep2
    write_varint(&mut buf, 0); // 0-length update payload
    buf
}

enum ParsedMessage {
    SyncStep1,
    Awareness(Vec<u8>),
    CellUpdate(Vec<u8>),
    Other,
}

fn parse_message(data: &[u8]) -> ParsedMessage {
    let Some((msg_type, c1)) = read_varint(data) else {
        return ParsedMessage::Other;
    };
    match msg_type {
        0 => ParsedMessage::SyncStep1,
        1 => ParsedMessage::Awareness(data[c1..].to_vec()),
        2 => ParsedMessage::CellUpdate(data[c1..].to_vec()),
        _ => ParsedMessage::Other,
    }
}

// ── WebSocket handler ──────────────────────────────────────────────────────────

#[utoipa::path(
    get,
    path = "/api/v1/sheets/{id}/ws",
    params(
        ("id" = String, Path, description = "Sheet ID"),
        ("token" = String, Query, description = "JWT access token"),
    ),
    responses(
        (status = 101, description = "WebSocket upgrade — awareness-only presence protocol"),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "sheets-presence"
)]
#[get("/sheets/{id}/ws")]
pub async fn sheet_presence_ws(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<String>,
    presence_state: web::Data<Arc<SheetPresenceState>>,
    token_service: web::Data<Arc<TokenService>>,
) -> Result<HttpResponse, actix_web::Error> {
    let sheet_id = path.into_inner();

    let token = req.uri().query().and_then(|q| {
        q.split('&')
            .find(|kv| kv.starts_with("token="))
            .map(|kv| kv["token=".len()..].to_string())
    });

    match token {
        Some(ref t) => {
            if token_service.validate_access_token(t).is_err() {
                return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
                    "error": {"code": "UNAUTHORIZED", "message": "Invalid token"}
                })));
            }
        }
        None => {
            return Ok(HttpResponse::Unauthorized().json(serde_json::json!({
                "error": {"code": "UNAUTHORIZED", "message": "Token required"}
            })));
        }
    }

    let room = presence_state.get_or_create_room(&sheet_id);
    room.session_count.fetch_add(1, Ordering::SeqCst);

    let (response, mut session, msg_stream) = actix_ws::handle(&req, stream)?;

    let room_clone = room.clone();

    actix_web::rt::spawn(async move {
        let mut rx = room_clone.tx.subscribe();
        let mut stream = msg_stream
            .max_frame_size(1 * 1024 * 1024)
            .aggregate_continuations()
            .max_continuation_size(2 * 1024 * 1024);

        // Send an empty SyncStep2 so the client's syncReady fires immediately.
        if session.binary(encode_empty_sync_step2()).await.is_err() {
            room_clone.session_count.fetch_sub(1, Ordering::SeqCst);
            return;
        }

        loop {
            tokio::select! {
                msg = stream.next() => {
                    match msg {
                        None => break,
                        Some(Err(e)) => {
                            warn!("WS error for sheet presence {}: {:?}", sheet_id, e);
                            break;
                        }
                        Some(Ok(AggregatedMessage::Binary(bytes))) => {
                            match parse_message(&bytes) {
                                ParsedMessage::SyncStep1 => {
                                    // Reply with empty SyncStep2 in case client reconnects.
                                    if session.binary(encode_empty_sync_step2()).await.is_err() {
                                        break;
                                    }
                                }
                                ParsedMessage::Awareness(awareness_bytes) => {
                                    let mut msg = Vec::new();
                                    write_varint(&mut msg, 1);
                                    msg.extend_from_slice(&awareness_bytes);
                                    let _ = room_clone.tx.send(msg);
                                }
                                ParsedMessage::CellUpdate(cell_bytes) => {
                                    let mut msg = Vec::new();
                                    write_varint(&mut msg, 2);
                                    msg.extend_from_slice(&cell_bytes);
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
    cfg.service(sheet_presence_ws);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(sheet_presence_ws),
    tags((name = "sheets-presence", description = "Sheets real-time presence endpoints"))
)]
pub struct SheetsPresenceApiDoc;
