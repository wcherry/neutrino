pub mod access_requests;
pub mod feature_flags;
pub mod activity;
pub mod admin;
pub mod ai;
pub mod comments;
pub mod compliance;
pub mod encryption;
pub mod filesystem;
pub mod irm;
pub mod jobs;
pub mod notifications;
pub mod permissions;
pub mod priority;
pub mod search;
pub mod security;
pub mod service_registry;
pub mod shared_drives;
pub mod sharing;
pub mod storage;
pub mod suggestions;
pub mod tags;
pub mod workspace;

use actix_web::web;

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(web::scope("/drive")
        .configure(storage::api::configure)
        .configure(filesystem::api::configure)
        .configure(permissions::api::configure)
        .configure(sharing::api::configure_drive)
        .configure(access_requests::api::configure)
        .configure(irm::api::configure)
        .configure(comments::api::configure)
        .configure(suggestions::api::configure)
        .configure(activity::api::configure)
        .configure(notifications::api::configure)
        .configure(search::api::configure)
        .configure(priority::api::configure)
        .configure(ai::api::configure)
        .configure(tags::api::configure)
        .configure(encryption::api::configure)
        .configure(shared_drives::api::configure)
        );
}
