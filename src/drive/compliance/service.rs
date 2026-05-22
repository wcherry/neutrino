use crate::shared::ApiError;
use crate::drive::compliance::{
    dto::*,
    model::{NewFileLegalHold, NewLegalHold, NewRetentionPolicy},
    repository::ComplianceRepository,
};
use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use std::sync::Arc;
use uuid::Uuid;

pub struct ComplianceService {
    repo: Arc<ComplianceRepository>,
    pool: Pool<ConnectionManager<SqliteConnection>>,
}

impl ComplianceService {
    pub fn new(repo: Arc<ComplianceRepository>, pool: Pool<ConnectionManager<SqliteConnection>>) -> Self {
        ComplianceService { repo, pool }
    }

    pub fn create_hold(
        &self,
        user_id: &str,
        req: CreateLegalHoldRequest,
    ) -> Result<LegalHoldResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let custodian_ids_str = req.custodian_ids.join(",");
        let hold = self.repo.create_hold(NewLegalHold {
            id: &id,
            name: &req.name,
            description: req.description.as_deref(),
            created_by: user_id,
            custodian_ids: &custodian_ids_str,
            is_active: 1,
            created_at: now,
            updated_at: now,
        })?;
        Ok(hold_to_response(hold))
    }

    pub fn list_holds(&self) -> Result<LegalHoldListResponse, ApiError> {
        let holds = self.repo.list_holds()?;
        let total = holds.len() as i64;
        Ok(LegalHoldListResponse {
            holds: holds.into_iter().map(hold_to_response).collect(),
            total,
        })
    }

    pub fn get_hold(&self, id: &str) -> Result<LegalHoldResponse, ApiError> {
        let hold = self.repo.find_hold_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Legal hold not found"))?;
        Ok(hold_to_response(hold))
    }

    pub fn update_hold(
        &self,
        id: &str,
        req: UpdateLegalHoldRequest,
    ) -> Result<LegalHoldResponse, ApiError> {
        self.repo.find_hold_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Legal hold not found"))?;

        let custodian_str: Option<String> = req.custodian_ids.map(|v| v.join(","));
        let hold = self.repo.update_hold(
            id,
            req.name.as_deref(),
            None,
            custodian_str.as_deref(),
            req.is_active.map(|b| b as i32),
        )?;
        Ok(hold_to_response(hold))
    }

    pub fn delete_hold(&self, id: &str) -> Result<(), ApiError> {
        self.repo.find_hold_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Legal hold not found"))?;
        self.repo.delete_hold(id)
    }

    pub fn apply_hold_to_file(&self, hold_id: &str, file_id: &str) -> Result<(), ApiError> {
        self.repo.find_hold_by_id(hold_id)?
            .ok_or_else(|| ApiError::not_found("Legal hold not found"))?;
        let now = Utc::now().naive_utc();
        self.repo.apply_hold_to_file(NewFileLegalHold {
            file_id,
            hold_id,
            applied_at: now,
        })
    }

    pub fn remove_hold_from_file(&self, hold_id: &str, file_id: &str) -> Result<(), ApiError> {
        self.repo.remove_hold_from_file(file_id, hold_id)
    }

    pub fn create_policy(
        &self,
        req: CreateRetentionPolicyRequest,
    ) -> Result<RetentionPolicyResponse, ApiError> {
        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let policy = self.repo.create_policy(NewRetentionPolicy {
            id: &id,
            name: &req.name,
            retain_for_days: req.retain_for_days,
            applies_to_mime_type: req.applies_to_mime_type.as_deref(),
            applies_to_user_id: req.applies_to_user_id.as_deref(),
            is_active: 1,
            created_at: now,
            updated_at: now,
        })?;
        Ok(policy_to_response(policy))
    }

    pub fn list_policies(&self) -> Result<RetentionPolicyListResponse, ApiError> {
        let policies = self.repo.list_policies()?;
        let total = policies.len() as i64;
        Ok(RetentionPolicyListResponse {
            policies: policies.into_iter().map(policy_to_response).collect(),
            total,
        })
    }

    pub fn get_policy(&self, id: &str) -> Result<RetentionPolicyResponse, ApiError> {
        let policy = self.repo.find_policy_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Retention policy not found"))?;
        Ok(policy_to_response(policy))
    }

    pub fn delete_policy(&self, id: &str) -> Result<(), ApiError> {
        self.repo.find_policy_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Retention policy not found"))?;
        self.repo.delete_policy(id)
    }

    pub fn ediscovery_search(
        &self,
        req: EDiscoverySearchRequest,
    ) -> Result<EDiscoverySearchResponse, ApiError> {
        use crate::schema::{file_content_index, files};

        let page = req.page.unwrap_or(1).max(1);
        let page_size = req.page_size.unwrap_or(20).min(100).max(1);
        let offset = (page - 1) * page_size;

        let mut conn = self.pool.get().map_err(|_| ApiError::internal("DB error"))?;

        // Search file_content_index for query term
        let query_lower = req.query.to_lowercase();

        let mut db_query = files::table
            .inner_join(file_content_index::table.on(file_content_index::file_id.eq(files::id)))
            .filter(file_content_index::text_content.like(format!("%{}%", query_lower)))
            .into_boxed();

        if let Some(mime) = &req.mime_type {
            db_query = db_query.filter(files::mime_type.eq(mime));
        }

        if let Some(custodians) = &req.custodian_ids {
            if !custodians.is_empty() {
                db_query = db_query.filter(files::user_id.eq_any(custodians));
            }
        }

        let matched: Vec<(crate::drive::storage::model::FileRecord, String)> = db_query
            .select((files::all_columns, file_content_index::text_content))
            .offset(offset)
            .limit(page_size)
            .load::<(crate::drive::storage::model::FileRecord, String)>(&mut conn)
            .map_err(|_| ApiError::internal("DB error"))?;

        let total = matched.len() as i64 + offset;

        let results = matched
            .into_iter()
            .map(|(f, content)| {
                let snippet = extract_snippet(&content, &req.query);
                EDiscoveryResult {
                    file_id: f.id,
                    file_name: f.name,
                    owner_id: f.user_id,
                    mime_type: f.mime_type,
                    size_bytes: f.size_bytes,
                    created_at: f.created_at.to_string(),
                    updated_at: f.updated_at.to_string(),
                    snippet,
                }
            })
            .collect();

        Ok(EDiscoverySearchResponse {
            results,
            total,
            page,
            page_size,
        })
    }
}

fn extract_snippet(content: &str, query: &str) -> Option<String> {
    let lower = content.to_lowercase();
    let query_lower = query.to_lowercase();
    if let Some(pos) = lower.find(&query_lower) {
        let start = pos.saturating_sub(100);
        let end = (pos + query.len() + 100).min(content.len());
        Some(content[start..end].to_string())
    } else {
        None
    }
}

fn hold_to_response(hold: crate::drive::compliance::model::LegalHold) -> LegalHoldResponse {
    let custodian_ids: Vec<String> = if hold.custodian_ids.is_empty() {
        vec![]
    } else {
        hold.custodian_ids.split(',').map(|s| s.to_string()).collect()
    };
    LegalHoldResponse {
        id: hold.id,
        name: hold.name,
        description: hold.description,
        created_by: hold.created_by,
        custodian_ids,
        is_active: hold.is_active == 1,
        created_at: hold.created_at.to_string(),
        updated_at: hold.updated_at.to_string(),
    }
}

fn policy_to_response(policy: crate::drive::compliance::model::RetentionPolicy) -> RetentionPolicyResponse {
    RetentionPolicyResponse {
        id: policy.id,
        name: policy.name,
        retain_for_days: policy.retain_for_days,
        applies_to_mime_type: policy.applies_to_mime_type,
        applies_to_user_id: policy.applies_to_user_id,
        is_active: policy.is_active == 1,
        created_at: policy.created_at.to_string(),
        updated_at: policy.updated_at.to_string(),
    }
}
