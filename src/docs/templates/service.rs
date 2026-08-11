use std::sync::Arc;

use chrono::Utc;
use uuid::Uuid;

use crate::shared::drive_client::DriveClient;
use crate::shared::ContentVersionCheck;
use crate::docs::templates::{
    dto::{
        CreateTemplateRequest, ListTemplatesResponse, TemplateResponse, UpdateTemplateRequest,
        UseTemplateResponse,
    },
    model::{DocTemplate, NewDocTemplate, UpdateDocTemplate},
    repository::TemplatesRepository,
};
use crate::shared::{ApiError, AuthenticatedUser};

/// The native mime type a template instantiates into. Mirrors
/// `drive::storage::native_types::DOC`.
const DOC_MIME_TYPE: &str = "application/x-neutrino-doc";

pub struct TemplatesService {
    repo: Arc<TemplatesRepository>,
    drive: Arc<DriveClient>,
}

impl TemplatesService {
    pub fn new(repo: Arc<TemplatesRepository>, drive: Arc<DriveClient>) -> Self {
        TemplatesService { repo, drive }
    }

    /// Seeds built-in system templates if they do not exist yet.
    pub fn seed_system_templates(&self) -> Result<(), ApiError> {
        let system_templates: &[(&str, &str, Option<&str>, Option<&str>, &str)] = &[
            (
                "system-blank",
                "Blank Document",
                None,
                Some("general"),
                r#"{"type":"doc","content":[]}"#,
            ),
            (
                "system-resume",
                "Resume",
                Some("A professional resume template with sections for experience, education, and skills"),
                Some("professional"),
                r#"{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Your Name"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Professional Summary"}]},{"type":"paragraph","content":[{"type":"text","text":"Write a brief professional summary here."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Experience"}]},{"type":"paragraph","content":[{"type":"text","text":"Job Title — Company Name (Year – Year)"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Key responsibility or achievement"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Education"}]},{"type":"paragraph","content":[{"type":"text","text":"Degree — University Name (Year)"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Skills"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Skill 1, Skill 2, Skill 3"}]}]}]}]}"#,
            ),
            (
                "system-meeting-notes",
                "Meeting Notes",
                Some("A structured template for capturing meeting notes, action items and decisions"),
                Some("productivity"),
                r#"{"type":"doc","content":[{"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Meeting Notes"}]},{"type":"paragraph","content":[{"type":"text","text":"Date: "},{"type":"text","marks":[{"type":"bold"}],"text":"[Date]"}]},{"type":"paragraph","content":[{"type":"text","text":"Attendees: [Names]"}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Agenda"}]},{"type":"orderedList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Topic 1"}]}]},{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Topic 2"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Discussion"}]},{"type":"paragraph","content":[{"type":"text","text":"Notes from discussion..."}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Action Items"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"[ ] Owner: Task description (Due: Date)"}]}]}]},{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Decisions"}]},{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Decision made"}]}]}]}]}"#,
            ),
        ];

        let now = Utc::now().naive_utc();

        for (id, name, description, category, content_json) in system_templates {
            if self.repo.count_by_name(name)? == 0 {
                let new_template = NewDocTemplate {
                    id: id.to_string(),
                    name: name.to_string(),
                    description: description.map(|s| s.to_string()),
                    is_system: 1,
                    is_default: if *id == "system-blank" { 1 } else { 0 },
                    category: category.map(|s| s.to_string()),
                    content_json: content_json.to_string(),
                    created_at: now,
                    updated_at: now,
                };
                self.repo.insert(new_template)?;
            }
        }

        Ok(())
    }

    pub fn list_templates(&self) -> Result<ListTemplatesResponse, ApiError> {
        let templates = self.repo.list_all()?;
        Ok(ListTemplatesResponse {
            templates: templates.into_iter().map(to_response).collect(),
        })
    }

    pub fn create_template(
        &self,
        req: CreateTemplateRequest,
    ) -> Result<TemplateResponse, ApiError> {
        let name = req.name.trim().to_string();
        if name.is_empty() {
            return Err(ApiError::bad_request("Template name cannot be empty"));
        }

        let now = Utc::now().naive_utc();
        let new_template = NewDocTemplate {
            id: Uuid::new_v4().to_string(),
            name,
            description: req.description,
            is_system: 0,
            is_default: 0,
            category: req.category,
            content_json: req
                .content_json
                .unwrap_or_else(|| r#"{"type":"doc","content":[]}"#.to_string()),
            created_at: now,
            updated_at: now,
        };
        let template = self.repo.insert(new_template)?;
        Ok(to_response(template))
    }

    pub fn get_template(&self, id: &str) -> Result<TemplateResponse, ApiError> {
        let template = self
            .repo
            .find_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Template not found"))?;
        Ok(to_response(template))
    }

    pub fn update_template(
        &self,
        id: &str,
        req: UpdateTemplateRequest,
    ) -> Result<TemplateResponse, ApiError> {
        let existing = self
            .repo
            .find_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Template not found"))?;

        // System templates cannot have name/description/category changed
        if existing.is_system == 1
            && (req.name.is_some() || req.description.is_some() || req.category.is_some())
        {
            return Err(ApiError::bad_request("System templates cannot be modified"));
        }

        // If setting this template as default, clear others first
        if req.is_default == Some(true) {
            self.repo.clear_all_defaults()?;
        }

        let now = Utc::now().naive_utc();
        let changes = UpdateDocTemplate {
            name: req.name,
            description: req.description.map(Some),
            is_default: req.is_default.map(|b| if b { 1 } else { 0 }),
            category: req.category.map(Some),
            updated_at: Some(now),
        };
        let updated = self.repo.update(id, changes)?;
        Ok(to_response(updated))
    }

    pub fn delete_template(&self, id: &str) -> Result<(), ApiError> {
        let existing = self
            .repo
            .find_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Template not found"))?;

        if existing.is_system == 1 {
            return Err(ApiError::bad_request("System templates cannot be deleted"));
        }

        self.repo.delete(id)?;
        Ok(())
    }

    pub async fn use_template(
        &self,
        id: &str,
        user: &AuthenticatedUser,
        title: Option<String>,
    ) -> Result<UseTemplateResponse, ApiError> {
        let template = self
            .repo
            .find_by_id(id)?
            .ok_or_else(|| ApiError::not_found("Template not found"))?;

        let doc_title = title.unwrap_or_else(|| format!("New {}", template.name));

        // A document is a Drive file with the native doc mime type — there is
        // no docs-specific create path any more.
        let doc_id = Uuid::new_v4().to_string();
        let doc = self
            .drive
            .create_file(user, &doc_id, &doc_title, DOC_MIME_TYPE, None)
            .await?;

        // Drive seeds an empty document body from the mime type, so only a
        // template with real content needs a write of its own.
        if template.content_json != r#"{"type":"doc","content":[]}"#
            && !template.content_json.is_empty()
        {
            self.drive
                .upload_content(
                    &doc.id,
                    &template.content_json,
                    "write_template_content",
                    ContentVersionCheck::UNCHECKED,
                )
                .await?;
        }

        Ok(UseTemplateResponse { doc_id: doc.id })
    }
}

fn to_response(t: DocTemplate) -> TemplateResponse {
    TemplateResponse {
        id: t.id,
        name: t.name,
        description: t.description,
        is_system: t.is_system == 1,
        is_default: t.is_default == 1,
        category: t.category,
        content_json: t.content_json,
        created_at: t.created_at.and_utc().to_rfc3339(),
        updated_at: t.updated_at.and_utc().to_rfc3339(),
    }
}
