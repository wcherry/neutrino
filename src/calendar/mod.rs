pub mod attachments;
pub mod calendars;
pub mod connections;
pub mod events;
pub mod recurrence;
pub mod reminder_engine;
pub mod reminders;
pub mod task_places;
pub mod tasks;

use actix_web::web;

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/calendar")
            .configure(calendars::api::configure)
            .configure(events::api::configure)
            .configure(reminders::api::configure)
            .configure(attachments::api::configure)
            .configure(connections::api::configure)
            .configure(tasks::api::configure)
            .configure(task_places::api::configure),
    );
}
