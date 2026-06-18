pub mod attachments;
pub mod connections;
pub mod events;
pub mod reminder_engine;
pub mod reminders;
pub mod tasks;

use actix_web::web;

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/calendar")
            .configure(events::api::configure)
            .configure(reminders::api::configure)
            .configure(attachments::api::configure)
            .configure(connections::api::configure)
            .configure(tasks::api::configure),
    );
}
