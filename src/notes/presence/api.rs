use actix_web::{get, web, HttpRequest, HttpResponse};
use actix_ws::AggregatedMessage;
use futures_util::StreamExt;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use tracing::warn;

use crate::notes::presence::state::NotePresenceState;
use crate::shared::collab_protocol::{read_varint, write_varint};
use crate::shared::TokenService;

/// Messages are relayed verbatim to the other clients in the room; the server
/// never inspects the payloads.
///
/// * `1` — awareness (who is viewing the note).
/// * `2` — note-updated signal.  Only a signal: the payload carries no note
///   content, so peers re-read the note through the normal (E2EE) read path
///   instead of the server relaying plaintext it must not see.
enum ParsedMessage {
    Awareness(Vec<u8>),
    NoteUpdated(Vec<u8>),
    Other,
}

fn parse_message(data: &[u8]) -> ParsedMessage {
    let Some((msg_type, c1)) = read_varint(data) else {
        return ParsedMessage::Other;
    };
    match msg_type {
        1 => ParsedMessage::Awareness(data[c1..].to_vec()),
        2 => ParsedMessage::NoteUpdated(data[c1..].to_vec()),
        _ => ParsedMessage::Other,
    }
}

#[utoipa::path(
    get,
    path = "/api/v1/notes/{id}/ws",
    params(
        ("id" = String, Path, description = "Note ID"),
        ("token" = String, Query, description = "JWT access token"),
    ),
    responses(
        (status = 101, description = "WebSocket upgrade — awareness + note-updated signal relay"),
        (status = 401, description = "Unauthorized"),
    ),
    tag = "notes-presence"
)]
#[get("/notes/{id}/ws")]
pub async fn note_presence_ws(
    req: HttpRequest,
    stream: web::Payload,
    path: web::Path<String>,
    presence_state: web::Data<Arc<NotePresenceState>>,
    token_service: web::Data<Arc<TokenService>>,
) -> Result<HttpResponse, actix_web::Error> {
    let note_id = path.into_inner();

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

    let room = presence_state.get_or_create_room(&note_id);
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
                            warn!("WS error for note presence {}: {:?}", note_id, e);
                            break;
                        }
                        Some(Ok(AggregatedMessage::Binary(bytes))) => {
                            match parse_message(&bytes) {
                                ParsedMessage::Awareness(awareness_bytes) => {
                                    let mut msg = Vec::new();
                                    write_varint(&mut msg, 1);
                                    msg.extend_from_slice(&awareness_bytes);
                                    let _ = room_clone.tx.send(msg);
                                }
                                ParsedMessage::NoteUpdated(update_bytes) => {
                                    let mut msg = Vec::new();
                                    write_varint(&mut msg, 2);
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
    cfg.service(note_presence_ws);
}

#[derive(utoipa::OpenApi)]
#[openapi(
    paths(note_presence_ws),
    tags((name = "notes-presence", description = "Notes real-time update signalling"))
)]
pub struct NotesPresenceApiDoc;
