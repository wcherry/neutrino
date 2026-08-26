pub mod access_requests;
pub mod activity;
pub mod admin;
pub mod comments;
pub mod encryption;
pub mod feature_flags;
pub mod filesystem;
pub mod fonts;
pub mod key_files;
pub mod notifications;
pub mod permissions;
pub mod private_store;
pub mod security;
pub mod service_registry;
pub mod shared_drives;
pub mod sharing;
pub mod storage;
pub mod tags;
pub mod workspace;

use actix_web::web;

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/drive")
            .configure(storage::api::configure)
            .configure(filesystem::api::configure)
            .configure(permissions::api::configure)
            .configure(sharing::api::configure_drive)
            .configure(access_requests::api::configure)
            .configure(comments::api::configure)
            .configure(notifications::api::configure)
            .configure(tags::api::configure)
            .configure(encryption::api::configure)
            .configure(key_files::api::configure)
            .configure(shared_drives::api::configure),
    );
}
