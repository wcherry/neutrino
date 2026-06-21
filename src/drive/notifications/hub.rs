use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicU64, Ordering},
    Mutex,
};
use tokio::sync::mpsc;

static NEXT_SLOT: AtomicU64 = AtomicU64::new(0);

/// Broadcasts real-time notification JSON strings to connected WebSocket clients.
/// Each user may have multiple concurrent connections (tabs/devices).
pub struct NotificationHub {
    senders: Mutex<HashMap<String, HashMap<u64, mpsc::UnboundedSender<String>>>>,
}

impl NotificationHub {
    pub fn new() -> Self {
        NotificationHub {
            senders: Mutex::new(HashMap::new()),
        }
    }

    /// Register a new WebSocket connection for `user_id`.
    /// Returns (receiver, slot_id). Call `unsubscribe` with slot_id on disconnect.
    pub fn subscribe(&self, user_id: &str) -> (mpsc::UnboundedReceiver<String>, u64) {
        let (tx, rx) = mpsc::unbounded_channel();
        let slot_id = NEXT_SLOT.fetch_add(1, Ordering::Relaxed);
        let mut map = self.senders.lock().unwrap();
        map.entry(user_id.to_string())
            .or_default()
            .insert(slot_id, tx);
        (rx, slot_id)
    }

    /// Remove a specific WebSocket connection on disconnect.
    pub fn unsubscribe(&self, user_id: &str, slot_id: u64) {
        let mut map = self.senders.lock().unwrap();
        if let Some(slots) = map.get_mut(user_id) {
            slots.remove(&slot_id);
            if slots.is_empty() {
                map.remove(user_id);
            }
        }
    }

    /// Push a JSON string to all active connections for `user_id`.
    /// Dead senders are cleaned up automatically.
    pub fn push(&self, user_id: &str, json: String) {
        let mut map = self.senders.lock().unwrap();
        if let Some(slots) = map.get_mut(user_id) {
            slots.retain(|_, tx| tx.send(json.clone()).is_ok());
            if slots.is_empty() {
                map.remove(user_id);
            }
        }
    }
}
