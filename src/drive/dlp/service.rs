use crate::shared::ApiError;
use crate::drive::dlp::{
    dto::*,
    model::{NewDlpRule, NewDlpViolation},
    repository::DlpRepository,
};
use chrono::Utc;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use regex::Regex;
use std::sync::Arc;
use uuid::Uuid;

pub struct DlpService {
    repo: Arc<DlpRepository>,
    pool: Pool<ConnectionManager<SqliteConnection>>,
}

impl DlpService {
    pub fn new(repo: Arc<DlpRepository>, pool: Pool<ConnectionManager<SqliteConnection>>) -> Self {
        DlpService { repo, pool }
    }

    pub fn create_rule(
        &self,
        user_id: &str,
        req: CreateDlpRuleRequest,
    ) -> Result<DlpRuleResponse, ApiError> {
        // Validate regex
        Regex::new(&req.pattern).map_err(|e| {
            ApiError::bad_request(&format!("Invalid regex pattern: {e}"))
        })?;

        let now = Utc::now().naive_utc();
        let id = Uuid::new_v4().to_string();
        let rule = self.repo.create_rule(NewDlpRule {
            id: &id,
            name: &req.name,
            description: req.description.as_deref(),
            pattern: &req.pattern,
            pattern_type: &req.pattern_type,
            action: &req.action,
            severity: &req.severity,
            is_active: req.is_active.unwrap_or(true) as i32,
            created_by: user_id,
            created_at: now,
            updated_at: now,
        })?;

        Ok(rule_to_response(rule))
    }

    pub fn list_rules(&self) -> Result<DlpRuleListResponse, ApiError> {
        let rules = self.repo.list_rules()?;
        let total = rules.len() as i64;
        Ok(DlpRuleListResponse {
            rules: rules.into_iter().map(rule_to_response).collect(),
            total,
        })
    }

    pub fn get_rule(&self, id: &str) -> Result<DlpRuleResponse, ApiError> {
        let rule = self.repo.find_rule_by_id(id)?
            .ok_or_else(|| ApiError::not_found("DLP rule not found"))?;
        Ok(rule_to_response(rule))
    }

    pub fn delete_rule(&self, id: &str) -> Result<(), ApiError> {
        self.repo.find_rule_by_id(id)?
            .ok_or_else(|| ApiError::not_found("DLP rule not found"))?;
        self.repo.delete_rule(id)
    }

    pub fn list_violations(
        &self,
        query: &DlpViolationQuery,
    ) -> Result<DlpViolationListResponse, ApiError> {
        let page = query.page.unwrap_or(1).max(1);
        let page_size = query.page_size.unwrap_or(20).min(100).max(1);
        let (violations, total) = self.repo.list_violations(
            query.file_id.as_deref(),
            page,
            page_size,
        )?;

        let mut items = Vec::new();
        for v in violations {
            let rule_name = self.repo
                .find_rule_by_id(&v.rule_id)?
                .map(|r| r.name)
                .unwrap_or_else(|| v.rule_id.clone());
            items.push(DlpViolationResponse {
                id: v.id,
                file_id: v.file_id,
                rule_id: v.rule_id,
                rule_name,
                matched_at: v.matched_at.to_string(),
                action_taken: v.action_taken,
                dismissed_at: v.dismissed_at.map(|d| d.to_string()),
                dismissed_by: v.dismissed_by,
            });
        }

        Ok(DlpViolationListResponse { violations: items, total })
    }

    pub fn dismiss_violation(&self, id: &str, user_id: &str) -> Result<(), ApiError> {
        self.repo.dismiss_violation(id, user_id)
    }

    /// Scan a file's indexed text content against all active DLP rules.
    pub fn scan_file(&self, file_id: &str) -> Result<usize, ApiError> {
        use crate::schema::file_content_index;

        // Fetch text content from the FTS index
        let mut conn = self.pool.get().map_err(|_| ApiError::internal("DB error"))?;
        let text: Option<String> = file_content_index::table
            .filter(file_content_index::file_id.eq(file_id))
            .select(file_content_index::text_content)
            .first(&mut conn)
            .optional()
            .map_err(|_| ApiError::internal("DB error"))?;

        let text = match text {
            Some(t) => t,
            None => return Ok(0), // no indexed content
        };

        let active_rules = self.repo.list_active_rules()?;
        let mut violation_count = 0;

        for rule in active_rules {
            let re = match Regex::new(&rule.pattern) {
                Ok(r) => r,
                Err(_) => continue,
            };

            if re.is_match(&text) {
                let now = Utc::now().naive_utc();
                let vid = Uuid::new_v4().to_string();
                let _ = self.repo.create_violation(NewDlpViolation {
                    id: &vid,
                    file_id,
                    rule_id: &rule.id,
                    matched_at: now,
                    action_taken: Some(&rule.action),
                });
                violation_count += 1;
            }
        }

        Ok(violation_count)
    }
}

fn rule_to_response(rule: crate::drive::dlp::model::DlpRule) -> DlpRuleResponse {
    DlpRuleResponse {
        id: rule.id,
        name: rule.name,
        description: rule.description,
        pattern: rule.pattern,
        pattern_type: rule.pattern_type,
        action: rule.action,
        severity: rule.severity,
        is_active: rule.is_active == 1,
        created_by: rule.created_by,
        created_at: rule.created_at.to_string(),
        updated_at: rule.updated_at.to_string(),
    }
}
