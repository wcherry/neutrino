// One shared room map for "this file changed" signals, keyed by file id.
// Notes, Sheets and Slides each used to run their own copy of this exact
// primitive (`src/{notes,sheets,slides}/presence/state.rs`) — this is that
// primitive, collapsed to one instance. Sheets/Slides migrating onto it is a
// follow-up (out of scope here); notes is the only caller for now.
pub use crate::shared::presence_room::PresenceRoomState as FileEventsState;
