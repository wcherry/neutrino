use crate::photos::faces::{
    dto::{FaceBoundingBox, FaceResponse, ListFacesResponse, SaveFaceRequest},
    model::{FaceRecord, NewFaceRecord},
    repository::FacesRepository,
};
use crate::photos::photos::repository::PhotosRepository;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct FacesService {
    repo: Arc<FacesRepository>,
    photos_repo: Arc<PhotosRepository>,
}

impl FacesService {
    pub fn new(repo: Arc<FacesRepository>, photos_repo: Arc<PhotosRepository>) -> Self {
        FacesService { repo, photos_repo }
    }

    /// Called by the worker to persist a detected face.
    pub fn save_face(
        &self,
        photo_id: &str,
        req: SaveFaceRequest,
    ) -> Result<FaceResponse, ApiError> {
        // Verify the photo exists (including deleted, so worker can still write to trashed photos).
        self.photos_repo.get_photo_including_deleted(photo_id)?;

        let bounding_box_json = serde_json::to_string(&req.bounding_box)
            .map_err(|_| ApiError::internal("Failed to serialize bounding box"))?;

        let embedding_json = req
            .embedding
            .as_ref()
            .map(|e| serde_json::to_string(e))
            .transpose()
            .map_err(|_| ApiError::internal("Failed to serialize embedding"))?;

        let id = Uuid::new_v4().to_string();
        let now = chrono::Utc::now().naive_utc();

        let new_face = NewFaceRecord {
            id: &id,
            photo_id,
            bounding_box: &bounding_box_json,
            thumbnail: req.thumbnail.as_deref(),
            thumbnail_mime_type: req.thumbnail_mime_type.as_deref(),
            person_id: None,
            embedding: embedding_json.as_deref(),
            created_at: now,
        };

        let face = self.repo.insert_face(new_face)?;
        Ok(self.to_response(face))
    }

    /// List faces detected in a photo. Caller must own the photo.
    pub fn list_faces(&self, photo_id: &str, user_id: &str) -> Result<ListFacesResponse, ApiError> {
        let photo = self.photos_repo.get_photo(photo_id)?;
        if photo.user_id != user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let records = self.repo.list_faces_by_photo(photo_id)?;
        let faces: Vec<FaceResponse> = records.into_iter().map(|f| self.to_response(f)).collect();
        let total = faces.len();
        Ok(ListFacesResponse { faces, total })
    }

    fn to_response(&self, face: FaceRecord) -> FaceResponse {
        let bounding_box: FaceBoundingBox =
            serde_json::from_str(&face.bounding_box).unwrap_or(FaceBoundingBox {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
                confidence: 0.0,
                image_width: 0,
                image_height: 0,
            });
        FaceResponse {
            id: face.id,
            photo_id: face.photo_id,
            bounding_box,
            thumbnail: face.thumbnail,
            thumbnail_mime_type: face.thumbnail_mime_type,
            person_id: face.person_id,
            created_at: face.created_at.and_utc().to_rfc3339(),
        }
    }
}
