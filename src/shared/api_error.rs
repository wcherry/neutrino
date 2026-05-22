use actix_web::{HttpResponse, ResponseError};
use serde_json::json;
use std::fmt;

use super::errors::AppError;

#[derive(Debug)]
pub struct ApiError {
    pub code: String,
    pub message: String,
    pub status: u16,
}

impl ApiError {
    pub fn new(status: u16, code: impl Into<String>, message: impl Into<String>) -> Self {
        ApiError {
            code: code.into(),
            message: message.into(),
            status,
        }
    }

    pub fn unauthorized(message: impl Into<String>) -> Self {
        ApiError::new(401, "UNAUTHORIZED", message)
    }

    pub fn bad_request(message: impl Into<String>) -> Self {
        ApiError::new(400, "BAD_REQUEST", message)
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        ApiError::new(404, "NOT_FOUND", message)
    }

    pub fn conflict(message: impl Into<String>) -> Self {
        ApiError::new(409, "CONFLICT", message)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        ApiError::new(500, "INTERNAL_ERROR", message)
    }

    pub fn forbidden(message: impl Into<String>) -> Self {
        ApiError::new(403, "FORBIDDEN", message)
    }
}

impl fmt::Display for ApiError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "[{}] {}", self.code, self.message)
    }
}

impl ResponseError for ApiError {
    fn error_response(&self) -> HttpResponse {
        let body = json!({
            "error": {
                "code": self.code,
                "message": self.message
            }
        });

        HttpResponse::build(
            actix_web::http::StatusCode::from_u16(self.status)
                .unwrap_or(actix_web::http::StatusCode::INTERNAL_SERVER_ERROR),
        )
        .json(body)
    }
}

impl From<AppError> for ApiError {
    fn from(e: AppError) -> Self {
        match e {
            AppError::NotFound(msg) => ApiError::not_found(msg),
            AppError::Unauthorized(msg) => ApiError::unauthorized(msg),
            AppError::BadRequest(msg) => ApiError::bad_request(msg),
            AppError::Internal(msg) => ApiError::internal(msg),
            AppError::Conflict(msg) => ApiError::conflict(msg),
        }
    }
}

impl From<diesel::result::Error> for ApiError {
    fn from(e: diesel::result::Error) -> Self {
        match e {
            diesel::result::Error::NotFound => ApiError::not_found("Resource not found"),
            _ => {
                tracing::error!("Database error: {:?}", e);
                ApiError::internal("Database error")
            }
        }
    }
}
