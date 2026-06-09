pub mod ai;
pub mod collab;
pub mod docs;
pub mod permissions;
pub mod templates;

use actix_web::web;

pub fn configure(conf: &mut web::ServiceConfig) {
    conf.service(
        web::scope("/docs")
            .configure(docs::api::configure)
            .configure(collab::api::configure)
            .configure(ai::api::configure)
            .configure(templates::api::configure),
    );
}
