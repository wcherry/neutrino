use crate::shared::{ApiError, TokenService};
use actix_web::{web, FromRequest, HttpRequest};
use std::future::{ready, Ready};
use std::sync::Arc;

#[allow(dead_code)]
pub struct AdminUser {
    pub user_id: String,
    pub email: String,
}

impl FromRequest for AdminUser {
    type Error = ApiError;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut actix_web::dev::Payload) -> Self::Future {
        ready(extract_admin(req))
    }
}

fn extract_admin(req: &HttpRequest) -> Result<AdminUser, ApiError> {
    let token_service = req
        .app_data::<web::Data<Arc<TokenService>>>()
        .ok_or_else(|| ApiError::internal("Token service unavailable"))?;

    let auth_header = req
        .headers()
        .get("Authorization")
        .ok_or_else(|| ApiError::unauthorized("Missing Authorization header"))?
        .to_str()
        .map_err(|_| ApiError::unauthorized("Invalid Authorization header"))?;

    let token = auth_header
        .strip_prefix("Bearer ")
        .ok_or_else(|| ApiError::unauthorized("Authorization header must use Bearer scheme"))?;

    let claims = token_service
        .validate_access_token(token)
        .map_err(|_| ApiError::unauthorized("Invalid or expired token"))?;

    if !claims.is_admin {
        return Err(ApiError::forbidden("Admin access required"));
    }

    Ok(AdminUser {
        user_id: claims.sub,
        email: claims.email,
    })
}
