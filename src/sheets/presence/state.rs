use dashmap::DashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct SheetRoom {
    pub tx: broadcast::Sender<Vec<u8>>,
    pub session_count: AtomicUsize,
}

impl SheetRoom {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        SheetRoom {
            tx,
            session_count: AtomicUsize::new(0),
        }
    }
}

pub struct SheetPresenceState {
    pub rooms: DashMap<String, Arc<SheetRoom>>,
}

impl SheetPresenceState {
    pub fn new() -> Self {
        SheetPresenceState {
            rooms: DashMap::new(),
        }
    }

    pub fn get_or_create_room(&self, sheet_id: &str) -> Arc<SheetRoom> {
        self.rooms
            .entry(sheet_id.to_string())
            .or_insert_with(|| Arc::new(SheetRoom::new()))
            .clone()
    }
}
