use crate::calendar::attachments::{
    dto::{AttachmentResponse, CreateAttachmentRequest, ListAttachmentsResponse},
    model::NewAttachmentRecord,
    repository::AttachmentsRepository,
};
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct AttachmentsService {
    repo: Arc<AttachmentsRepository>,
}

impl AttachmentsService {
    pub fn new(repo: Arc<AttachmentsRepository>) -> Self {
        AttachmentsService { repo }
    }

    pub fn list_attachments(&self, event_id: &str) -> Result<ListAttachmentsResponse, ApiError> {
        let records = self.repo.find_by_event(event_id)?;
        let attachments = records.into_iter().map(attachment_to_response).collect();
        Ok(ListAttachmentsResponse { attachments })
    }

    pub fn create_attachment(
        &self,
        event_id: &str,
        req: CreateAttachmentRequest,
    ) -> Result<AttachmentResponse, ApiError> {
        if req.file_id.is_none() && req.note.is_none() {
            return Err(ApiError::bad_request("Provide either file_id or note"));
        }
        let record = NewAttachmentRecord {
            id: Uuid::new_v4().to_string(),
            event_id: event_id.to_string(),
            file_id: req.file_id,
            name: req.name,
            note: req.note,
        };
        let saved = self.repo.insert(record)?;
        Ok(attachment_to_response(saved))
    }

    pub fn delete_attachment(&self, event_id: &str, attachment_id: &str) -> Result<(), ApiError> {
        self.repo.delete(attachment_id, event_id)
    }
}

fn attachment_to_response(
    r: crate::calendar::attachments::model::AttachmentRecord,
) -> AttachmentResponse {
    AttachmentResponse {
        id: r.id,
        event_id: r.event_id,
        file_id: r.file_id,
        name: r.name,
        note: r.note,
    }
}
