// src/shared/presence_room.rs
//
// Generic broadcast-based presence room for WebSocket presence-only handlers.

use dashmap::DashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;

/// A single presence room backed by a broadcast channel.
pub struct PresenceRoom {
    pub tx: broadcast::Sender<Vec<u8>>,
    pub session_count: AtomicUsize,
}

impl PresenceRoom {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        PresenceRoom {
            tx,
            session_count: AtomicUsize::new(0),
        }
    }
}

/// Shared state that manages presence rooms keyed by a string identifier.
pub struct PresenceRoomState {
    pub rooms: DashMap<String, Arc<PresenceRoom>>,
}

impl PresenceRoomState {
    pub fn new() -> Self {
        PresenceRoomState {
            rooms: DashMap::new(),
        }
    }

    /// Return the existing room for `id`, or create and insert a new one.
    pub fn get_or_create_room(&self, id: &str) -> Arc<PresenceRoom> {
        self.rooms
            .entry(id.to_string())
            .or_insert_with(|| Arc::new(PresenceRoom::new()))
            .clone()
    }
}
