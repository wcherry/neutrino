pub mod collab;
pub mod permissions;
pub mod templates;

use actix_web::web;

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/docs")
            .configure(collab::api::configure)
            .configure(templates::api::configure),
    );
}
