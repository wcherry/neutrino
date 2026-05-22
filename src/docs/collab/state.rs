use std::sync::Arc;
use std::sync::atomic::AtomicUsize;
use dashmap::DashMap;
use tokio::sync::broadcast;
use yrs::Doc;

pub struct DocRoom {
    pub doc: Arc<Doc>,
    pub tx: broadcast::Sender<Vec<u8>>,
    pub session_count: AtomicUsize,
    pub file_id: String,
}

impl DocRoom {
    pub fn new(file_id: String) -> Self {
        let (tx, _) = broadcast::channel(256);
        DocRoom {
            doc: Arc::new(Doc::new()),
            tx,
            session_count: AtomicUsize::new(0),
            file_id,
        }
    }
}

pub struct CollabState {
    pub rooms: DashMap<String, Arc<DocRoom>>,
}

impl CollabState {
    pub fn new() -> Self {
        CollabState {
            rooms: DashMap::new(),
        }
    }

    pub fn get_or_create_room(&self, file_id: &str) -> Arc<DocRoom> {
        self.rooms
            .entry(file_id.to_string())
            .or_insert_with(|| Arc::new(DocRoom::new(file_id.to_string())))
            .clone()
    }
}
