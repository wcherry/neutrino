use crate::shared::ApiError;
use crate::drive::security::{
    dto::*,
    model::{NewRansomwareEvent, NewSiemConfig},
    repository::SecurityRepository,
};
use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use std::sync::Arc;
use uuid::Uuid;

pub struct SecurityService {
    repo: Arc<SecurityRepository>,
    pool: Pool<ConnectionManager<SqliteConnection>>,
}

impl SecurityService {
    pub fn new(repo: Arc<SecurityRepository>, pool: Pool<ConnectionManager<SqliteConnection>>) -> Self {
        SecurityService { repo, pool }
    }

    pub fn list_ransomware_events(&self) -> Result<RansomwareEventListResponse, ApiError> {
        let events = self.repo.list_ransomware_events()?;
        let total = events.len() as i64;
        Ok(RansomwareEventListResponse {
            events: events.into_iter().map(event_to_response).collect(),
            total,
        })
    }

    pub fn resolve_ransomware_event(
        &self,
        id: &str,
        user_id: &str,
    ) -> Result<(), ApiError> {
        self.repo.resolve_ransomware_event(id, user_id)
    }

    /// Detect suspicious upload patterns for a user (called from storage service on upload).
    /// Returns a ransomware event ID if suspicious activity is detected.
    pub fn check_upload_pattern(
        &self,
        user_id: &str,
        _file_id: &str,
        file_name: &str,
        _mime_type: &str,
    ) -> Result<Option<String>, ApiError> {
        // Detect known ransomware extension patterns
        let suspicious_extensions = [
            ".encrypted", ".locked", ".crypto", ".locky", ".zepto",
            ".cerber", ".wncry", ".wnry", ".wcry", ".wncryt",
        ];

        let name_lower = file_name.to_lowercase();
        let is_suspicious = suspicious_extensions.iter().any(|ext| name_lower.ends_with(ext))
            || name_lower.contains("readme_decrypt")
            || name_lower.contains("how_to_decrypt")
            || name_lower.contains("recover_files");

        if is_suspicious {
            let now = Utc::now().naive_utc();
            let id = Uuid::new_v4().to_string();
            let event = self.repo.create_ransomware_event(NewRansomwareEvent {
                id: &id,
                user_id,
                triggered_at: now,
                event_count: 1,
                status: "open",
            })?;
            return Ok(Some(event.id));
        }

        Ok(None)
    }

    // SIEM config management
    pub fn create_siem_config(
        &self,
        req: CreateSiemConfigRequest,
    ) -> Result<SiemConfigResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let api_key = req.api_key.as_deref().unwrap_or("");
        let config = self.repo.create_siem_config(NewSiemConfig {
            id: &id,
            endpoint_url: &req.endpoint_url,
            api_key,
            format: &req.format,
            is_active: 1,
            created_at: now,
            updated_at: now,
        })?;
        Ok(siem_config_to_response(config))
    }

    pub fn list_siem_configs(&self) -> Result<SiemConfigListResponse, ApiError> {
        let configs = self.repo.list_siem_configs()?;
        Ok(SiemConfigListResponse {
            configs: configs.into_iter().map(siem_config_to_response).collect(),
        })
    }

    pub fn delete_siem_config(&self, id: &str) -> Result<(), ApiError> {
        self.repo.delete_siem_config(id)
    }

    /// Export recent audit events to SIEM endpoints (stub: logs to tracing).
    pub fn export_to_siem(&self) -> Result<usize, ApiError> {
        use crate::schema::file_activity_log;
        let mut conn = self.pool.get().map_err(|_| ApiError::internal("DB error"))?;

        let configs = self.repo.list_siem_configs()?;
        let active_configs: Vec<_> = configs.iter().filter(|c| c.is_active == 1).collect();

        if active_configs.is_empty() {
            return Ok(0);
        }

        // Get last 100 audit events
        let events: Vec<(String, String, String, String)> = file_activity_log::table
            .order(file_activity_log::created_at.desc())
            .limit(100)
            .select((
                file_activity_log::id,
                file_activity_log::user_id,
                file_activity_log::action,
                file_activity_log::resource_type,
            ))
            .load(&mut conn)
            .map_err(|_| ApiError::internal("DB error"))?;

        let count = events.len();
        for config in active_configs {
            tracing::info!(
                endpoint = %config.endpoint_url,
                format = %config.format,
                event_count = count,
                "SIEM export"
            );
        }

        Ok(count)
    }

    /// CMEK stub — returns configuration status
    pub fn configure_cmek(&self, req: CmekKeyRequest) -> Result<CmekKeyResponse, ApiError> {
        // Stub: in production this would register the KMS key ARN and re-encrypt DEKs
        tracing::info!(
            key_arn = %req.key_arn,
            provider = %req.provider,
            "CMEK key configured (stub)"
        );
        Ok(CmekKeyResponse {
            key_arn: req.key_arn,
            provider: req.provider,
            status: "configured".to_string(),
        })
    }
}

fn event_to_response(e: crate::drive::security::model::RansomwareEvent) -> RansomwareEventResponse {
    RansomwareEventResponse {
        id: e.id,
        user_id: e.user_id,
        triggered_at: e.triggered_at.to_string(),
        event_count: e.event_count,
        status: e.status,
        reviewed_by: e.reviewed_by,
        reviewed_at: e.reviewed_at.map(|d: chrono::NaiveDateTime| d.to_string()),
    }
}

fn siem_config_to_response(c: crate::drive::security::model::SiemConfig) -> SiemConfigResponse {
    SiemConfigResponse {
        id: c.id,
        endpoint_url: c.endpoint_url,
        format: c.format,
        is_active: c.is_active == 1,
        created_at: c.created_at.to_string(),
        updated_at: c.updated_at.to_string(),
    }
}
