#![allow(dead_code)]

use dashmap::DashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;
use yrs::Doc;

/// Broadcast payload tagged with the id of the session that produced it, so
/// each session can skip re-delivering a message to its own connection (which
/// would otherwise echo every local edit back to its author as if it were a
/// remote change).
pub type RoomBroadcast = (u64, Vec<u8>);

pub struct DiagramRoom {
    pub doc: Arc<Doc>,
    pub tx: broadcast::Sender<RoomBroadcast>,
    pub session_count: AtomicUsize,
    pub file_id: String,
}

impl DiagramRoom {
    pub fn new(file_id: String) -> Self {
        let (tx, _) = broadcast::channel(256);
        DiagramRoom {
            doc: Arc::new(Doc::new()),
            tx,
            session_count: AtomicUsize::new(0),
            file_id,
        }
    }
}

pub struct DiagramCollabState {
    pub rooms: DashMap<String, Arc<DiagramRoom>>,
}

impl DiagramCollabState {
    pub fn new() -> Self {
        DiagramCollabState {
            rooms: DashMap::new(),
        }
    }

    pub fn get_or_create_room(&self, file_id: &str) -> Arc<DiagramRoom> {
        self.rooms
            .entry(file_id.to_string())
            .or_insert_with(|| Arc::new(DiagramRoom::new(file_id.to_string())))
            .clone()
    }
}
