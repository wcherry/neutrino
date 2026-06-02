use crate::photos::faces::repository::FacesRepository;
use crate::photos::learning::repository::LearningRepository;
use crate::photos::persons::repository::PersonsRepository;
use crate::photos::suggestions::{
    dto::{ListSuggestionsResponse, SuggestionResponse},
    repository::SuggestionsRepository,
};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct SuggestionsService {
    pub repo: Arc<SuggestionsRepository>,
    pub faces_repo: Arc<FacesRepository>,
    pub persons_repo: Arc<PersonsRepository>,
    pub learning_repo: Arc<LearningRepository>,
}

impl SuggestionsService {
    pub fn new(
        repo: Arc<SuggestionsRepository>,
        faces_repo: Arc<FacesRepository>,
        persons_repo: Arc<PersonsRepository>,
        learning_repo: Arc<LearningRepository>,
    ) -> Self {
        SuggestionsService { repo, faces_repo, persons_repo, learning_repo }
    }

    pub fn list_suggestions(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListSuggestionsResponse, ApiError> {
        let records = self.repo.list_pending_for_user(&user.user_id)?;

        // Batch-load unique faces and persons for enrichment.
        let face_ids: Vec<String> = records.iter().map(|r| r.face_id.clone()).collect();
        let person_ids: Vec<String> = records.iter().map(|r| r.person_id.clone()).collect();

        let face_map: std::collections::HashMap<String, crate::photos::faces::model::FaceRecord> = {
            let faces = self.faces_repo.get_faces_by_ids(&face_ids)?;
            faces.into_iter().map(|f| (f.id.clone(), f)).collect()
        };
        let person_map: std::collections::HashMap<String, crate::photos::persons::model::PersonRecord> = {
            let persons = self.persons_repo.get_persons_by_ids(&person_ids)?;
            persons.into_iter().map(|p| (p.id.clone(), p)).collect()
        };

        let suggestions = records
            .into_iter()
            .filter_map(|r| {
                let face = face_map.get(&r.face_id)?;
                let person = person_map.get(&r.person_id)?;
                Some(SuggestionResponse {
                    id: r.id,
                    face_id: r.face_id,
                    face_thumbnail: face.thumbnail.clone(),
                    face_thumbnail_mime_type: face.thumbnail_mime_type.clone(),
                    person_id: r.person_id,
                    person_name: person.name.clone(),
                    person_thumbnail: person.cover_thumbnail.clone(),
                    person_thumbnail_mime_type: person.cover_thumbnail_mime_type.clone(),
                    confidence: r.confidence,
                    created_at: r.created_at.and_utc().to_rfc3339(),
                })
            })
            .collect::<Vec<_>>();

        let total = suggestions.len();
        Ok(ListSuggestionsResponse { suggestions, total })
    }

    /// Accept a suggestion: assign the face to the person and clear pending suggestions for it.
    pub fn accept_suggestion(
        &self,
        user: &AuthenticatedUser,
        suggestion_id: &str,
    ) -> Result<(), ApiError> {
        let suggestion = self.repo.get_suggestion(suggestion_id)?;

        // Verify ownership via the face → photo → user chain.
        let face = self.faces_repo.get_face(&suggestion.face_id)?;
        self.verify_face_ownership(&face.photo_id, &user.user_id)?;

        // Verify person belongs to user.
        let person = self.persons_repo.get_person(&suggestion.person_id)?;
        if person.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        let now = chrono::Utc::now().naive_utc();

        // Assign the face to the person (update person.face_count and face.person_id).
        self.persons_repo.assign_face_to_person(
            &suggestion.face_id,
            &suggestion.person_id,
            &user.user_id,
            now,
        )?;

        // Mark this suggestion as accepted.
        self.repo.update_status(suggestion_id, "accepted", now)?;

        // Clear other pending suggestions for this face (it's now assigned).
        self.repo.delete_pending_for_face(&suggestion.face_id)?;

        // Record training signal.
        let signal_id = Uuid::new_v4().to_string();
        let _ = self.learning_repo.insert_signal(
            &signal_id,
            &user.user_id,
            &suggestion.face_id,
            &suggestion.person_id,
            "accepted",
            now,
        );

        Ok(())
    }

    /// Reject a suggestion: mark it as rejected so it is never re-suggested.
    pub fn reject_suggestion(
        &self,
        user: &AuthenticatedUser,
        suggestion_id: &str,
    ) -> Result<(), ApiError> {
        let suggestion = self.repo.get_suggestion(suggestion_id)?;

        let face = self.faces_repo.get_face(&suggestion.face_id)?;
        self.verify_face_ownership(&face.photo_id, &user.user_id)?;

        let now = chrono::Utc::now().naive_utc();
        self.repo.update_status(suggestion_id, "rejected", now)?;

        // Record training signal.
        let signal_id = Uuid::new_v4().to_string();
        let _ = self.learning_repo.insert_signal(
            &signal_id,
            &user.user_id,
            &suggestion.face_id,
            &suggestion.person_id,
            "rejected",
            now,
        );

        Ok(())
    }

    fn verify_face_ownership(&self, photo_id: &str, user_id: &str) -> Result<(), ApiError> {
        let _ = self.faces_repo.get_photo_user_id(photo_id).and_then(|owner| {
            if owner == user_id {
                Ok(())
            } else {
                Err(ApiError::new(403, "FORBIDDEN", "Access denied"))
            }
        })?;
        Ok(())
    }
}
