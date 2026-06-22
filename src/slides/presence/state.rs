use dashmap::DashMap;
use std::sync::atomic::AtomicUsize;
use std::sync::Arc;
use tokio::sync::broadcast;

pub struct SlideRoom {
    pub tx: broadcast::Sender<Vec<u8>>,
    pub session_count: AtomicUsize,
}

impl SlideRoom {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(256);
        SlideRoom {
            tx,
            session_count: AtomicUsize::new(0),
        }
    }
}

pub struct SlidePresenceState {
    pub rooms: DashMap<String, Arc<SlideRoom>>,
}

impl SlidePresenceState {
    pub fn new() -> Self {
        SlidePresenceState {
            rooms: DashMap::new(),
        }
    }

    pub fn get_or_create_room(&self, slide_id: &str) -> Arc<SlideRoom> {
        self.rooms
            .entry(slide_id.to_string())
            .or_insert_with(|| Arc::new(SlideRoom::new()))
            .clone()
    }
}
