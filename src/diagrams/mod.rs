pub mod collab;
pub mod diagrams;
pub mod private_library;

pub fn configure(cfg: &mut actix_web::web::ServiceConfig) {
    private_library::api::configure(cfg);
    diagrams::api::configure(cfg);
    collab::api::configure(cfg);
}
