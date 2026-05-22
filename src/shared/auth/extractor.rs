use actix_web::{web, FromRequest, HttpRequest};
use std::future::{ready, Ready};
use std::sync::Arc;

use crate::shared::ApiError;
use crate::shared::auth::tokens::TokenService;

#[allow(dead_code)]
pub struct AuthenticatedUser {
    pub user_id: String,
    pub email: String,
    pub token: String,
    pub is_admin: bool,
}

impl FromRequest for AuthenticatedUser {
    type Error = ApiError;
    type Future = Ready<Result<Self, Self::Error>>;

    fn from_request(req: &HttpRequest, _payload: &mut actix_web::dev::Payload) -> Self::Future {
        let result = extract_user(req);
        ready(result)
    }
}

fn extract_user(req: &HttpRequest) -> Result<AuthenticatedUser, ApiError> {
    let token_service = req
        .app_data::<web::Data<Arc<TokenService>>>()
        .ok_or_else(|| ApiError::internal("Token service unavailable"))?;

    // Accept token from Authorization header or ?token= query param (used for direct download URLs)
    let token = if let Some(auth_header) = req.headers().get("Authorization") {
        let header_str = auth_header
            .to_str()
            .map_err(|_| ApiError::unauthorized("Invalid Authorization header"))?;
        header_str
            .strip_prefix("Bearer ")
            .ok_or_else(|| ApiError::unauthorized("Authorization header must use Bearer scheme"))?
            .to_string()
    } else {
        let query = req.query_string();
        query
            .split('&')
            .find_map(|pair| {
                let mut parts = pair.splitn(2, '=');
                let key = parts.next()?;
                let val = parts.next()?;
                if key == "token" { Some(val.to_string()) } else { None }
            })
            .ok_or_else(|| ApiError::unauthorized("Missing Authorization header"))?
    };
    let token = token.as_str();

    let claims = token_service.validate_access_token(token)?;

    Ok(AuthenticatedUser {
        user_id: claims.sub,
        email: claims.email,
        token: token.to_string(),
        is_admin: claims.is_admin,
    })
}
