//! CalDAV: Neutrino as a calendar and reminders account in Apple Calendar and Reminders,
//! macOS, Thunderbird, DAVx⁵ and any other CalDAV client. Design: `agent_docs/caldav.md`.
//!
//! Local calendars are served as VEVENT collections and task lists as VTODO collections, under
//! `/dav`, to clients signed in with an app password (`auth::app_passwords`). Every write goes
//! through the events, tasks and calendars services, so CalDAV obeys the same rules as the API.

pub mod handlers;
pub mod ical;
pub mod store;
pub mod vevent;
pub mod vtodo;
pub mod xml;

use std::sync::Arc;

use actix_web::web;

use crate::auth::app_passwords::service::AppPasswordsService;
use crate::auth::signup_guard::client_ip::ClientIpSource;
use crate::calendar::calendars::service::CalendarsService;
use crate::calendar::events::service::EventsService;
use crate::calendar::tasks::service::TasksService;
use crate::shared::DbPool;

pub struct DavState {
    pub pool: DbPool,
    pub events: Arc<EventsService>,
    pub tasks: Arc<TasksService>,
    pub calendars: Arc<CalendarsService>,
    pub app_passwords: Arc<AppPasswordsService>,
    /// Where the caller's address is read from, for the per-IP sign-in failure count. Behind a
    /// proxy the socket's address is the proxy's, and counting that would let one person's
    /// typos lock everyone out.
    pub client_ip: ClientIpSource,
}

/// Registered on the app itself, ahead of the static web app, whose catch-all would otherwise
/// answer these paths with `index.html`.
pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.route("/.well-known/caldav", web::route().to(handlers::well_known))
        .service(web::scope("/dav").default_service(web::route().to(handlers::dispatch)));
}

#[cfg(test)]
mod tests;
