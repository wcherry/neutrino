pub mod api_error;
pub mod auth;
pub mod drive_client;
pub mod errors;
pub mod logger;
pub mod helper;
pub mod pagination;
pub mod admin_extractor;

pub use api_error::ApiError;
pub use logger::init_logging;
pub use helper::get_env_or_secret;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

pub use auth::extractor::AuthenticatedUser;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

pub use auth::tokens::TokenService;
pub use auth::fetch_auth_profile;
pub use pagination::*;
pub use admin_extractor::AdminUser;

