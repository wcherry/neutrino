//! Live "your drive changed" signals.
//!
//! A Drive listing in the web app is a cached query over `GET /folders/{id}` (and its siblings:
//! Recent, Starred, Trash, the tag pages). Nothing in that read path can tell an already-open tab
//! that a *different* client — the iOS Drive app uploading a photo, the macOS sync agent, another
//! browser — has added, renamed, trashed or restored something in the folder it is showing. The
//! tab therefore sat on a stale listing until it was refocused or reloaded.
//!
//! This module is the missing half: a per-user signal pushed over the notification socket the web
//! client already holds open, saying only "something in your drive changed". It deliberately
//! carries no file, folder or change description — the client re-reads whichever listing it has on
//! screen through the normal (E2EE-aware) read path, exactly as [`crate::shared::file_events`] has
//! a note re-read itself on a peer's signal. A signal cannot be wrong about *what* changed, and a
//! listing the server described would have to be described again for every view that renders one.
//!
//! The calendar rides the same socket with its own `calendar.changed` signal (see
//! [`broadcaster::SignalKind`]): any successful write under `/api/v1/calendar` tells the user's
//! other clients — the Calendar iOS app, another tab — to pull `GET /calendar/events/changes`.
//!
//! [`broadcast_drive_changes`] is the whole emit path, so a route added later is covered without
//! anybody remembering to call anything.

mod broadcaster;
mod middleware;

pub use broadcaster::DriveEventBroadcaster;
pub use middleware::broadcast_drive_changes;
