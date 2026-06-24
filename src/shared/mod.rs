pub mod admin_extractor;
pub mod api_error;
pub mod auth;
pub mod collab_protocol;
pub mod drive_client;
pub mod errors;
pub mod helper;
pub mod logger;
pub mod pagination;
pub mod presence_room;

pub use api_error::ApiError;
pub use helper::get_env_or_secret;
pub use logger::init_logging;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub use auth::extractor::AuthenticatedUser;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub use admin_extractor::AdminUser;
pub use auth::fetch_auth_profile;
pub use auth::tokens::TokenService;
pub use pagination::*;
