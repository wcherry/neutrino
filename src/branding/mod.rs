// ── branding ──────────────────────────────────────────────────────────────────
//
// Instance branding (agent_docs/ui-customization-roadmap.md §6.1): a self-hoster's name, brand
// accent, sign-in message, logos and favicon.
//
// The part that matters is delivery. Production is a static export served by this binary, so there
// is no server render to put the brand into, and fetching it after load would paint Neutrino's
// brand first and then swap — on the sign-in page of all places. `inject` writes the brand, and the
// organisation's preference defaults, into every HTML page as it is served, so both are there at
// first paint with no extra request.

pub mod api;
pub mod color;
pub mod dto;
pub mod inject;
pub mod model;
pub mod repository;
pub mod service;
