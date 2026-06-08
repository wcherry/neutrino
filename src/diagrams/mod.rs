pub mod collab;
pub mod diagrams;

pub fn configure(cfg: &mut actix_web::web::ServiceConfig) {
    let enabled = std::env::var("FEATURE_DIAGRAMS_APP").unwrap_or_default() == "true";
    if !enabled {
        return;
    }
    diagrams::api::configure(cfg);
    collab::api::configure(cfg);
}
