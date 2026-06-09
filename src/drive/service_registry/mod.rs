pub mod api;
pub mod model;
pub mod repository;

use chrono::DateTime;
use chrono::Utc;
use serde::Serialize;
use std::sync::Arc;

use crate::shared::ApiError;
use model::ServiceRegistrationRecord;
use repository::ServiceRegistrationRepository;

#[derive(Debug, Clone, Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServiceInfo {
    pub name: String,
    pub endpoint: String,
    pub version: String,
    pub health_check_url: String,
    pub registered_at: DateTime<Utc>,
    pub enabled: bool,
    pub auto_update: bool,
}

impl From<ServiceRegistrationRecord> for ServiceInfo {
    fn from(r: ServiceRegistrationRecord) -> Self {
        ServiceInfo {
            name: r.name,
            endpoint: r.endpoint,
            version: r.version,
            health_check_url: r.health_check_url,
            registered_at: DateTime::from_naive_utc_and_offset(r.registered_at, Utc),
            enabled: r.enabled != 0,
            auto_update: r.auto_update != 0,
        }
    }
}

pub struct ServiceRegistry {
    repo: Arc<ServiceRegistrationRepository>,
}

impl ServiceRegistry {
    pub fn new(repo: Arc<ServiceRegistrationRepository>) -> Arc<Self> {
        Arc::new(Self { repo })
    }

    pub fn register(
        &self,
        name: &str,
        endpoint: &str,
        version: &str,
        health_check_url: &str,
    ) -> Result<ServiceInfo, ApiError> {
        self.repo
            .upsert(name, endpoint, version, health_check_url)
            .map(ServiceInfo::from)
    }

    pub fn list(&self) -> Result<Vec<ServiceInfo>, ApiError> {
        self.repo
            .list()
            .map(|v| v.into_iter().map(ServiceInfo::from).collect())
    }

    pub fn update_flags(
        &self,
        name: &str,
        enabled: Option<bool>,
        auto_update: Option<bool>,
    ) -> Result<ServiceInfo, ApiError> {
        self.repo
            .update_flags(name, enabled, auto_update)
            .map(ServiceInfo::from)
    }
}
