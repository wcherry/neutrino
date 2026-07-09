use crate::jobs::dto::CreateJobRequest;
use crate::jobs::service::JobsService;
use crate::photos::faces::{
    dto::{
        DetectFacesResponse, FaceBoundingBox, FaceResponse, ListFacesResponse, SaveFaceRequest,
        UpdateFaceRequest,
    },
    model::{FaceChanges, FaceRecord, NewFaceRecord},
    repository::FacesRepository,
};
use crate::photos::photos::repository::PhotosRepository;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

/// Job type the background worker handles for face detection.
const FACE_SCAN_JOB_TYPE: &str = "face_scan";

pub struct FacesService {
    repo: Arc<FacesRepository>,
    photos_repo: Arc<PhotosRepository>,
    jobs_service: Arc<JobsService>,
}

impl FacesService {
    pub fn new(
        repo: Arc<FacesRepository>,
        photos_repo: Arc<PhotosRepository>,
        jobs_service: Arc<JobsService>,
    ) -> Self {
        FacesService {
            repo,
            photos_repo,
            jobs_service,
        }
    }

    /// Enqueue a background job to detect faces in a photo. Caller must own it.
    pub fn request_detection(
        &self,
        photo_id: &str,
        user_id: &str,
    ) -> Result<DetectFacesResponse, ApiError> {
        let photo = self.photos_repo.get_photo(photo_id)?;
        if photo.user_id != user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let path = self.jobs_service.file_abs_path(&photo.file_id)?;
        let req = CreateJobRequest {
            job_type: FACE_SCAN_JOB_TYPE.to_string(),
            payload: serde_json::json!({ "photoId": photo_id, "path": path }),
            timeout_secs: 120,
            file: None,
            user_id: None,
        };
        let job = self.jobs_service.create_job(req)?;
        Ok(DetectFacesResponse { job_id: job.id })
    }

    /// Update a face's person assignment or bounding box. Caller must own it.
    pub fn update_face(
        &self,
        photo_id: &str,
        face_id: &str,
        user_id: &str,
        req: UpdateFaceRequest,
    ) -> Result<FaceResponse, ApiError> {
        self.ensure_face_owner(face_id, photo_id, user_id)?;

        let bounding_box_json = req
            .bounding_box
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(|_| ApiError::internal("Failed to serialize bounding box"))?;

        // Nothing to change — return the face as-is.
        if req.person_id.is_none() && bounding_box_json.is_none() {
            return Ok(self.to_response(self.repo.get_face(face_id)?));
        }

        let changes = FaceChanges {
            person_id: req.person_id.as_deref(),
            bounding_box: bounding_box_json.as_deref(),
        };
        Ok(self.to_response(self.repo.update_face(face_id, changes)?))
    }

    /// Delete a face. Caller must own the photo it belongs to.
    pub fn delete_face(&self, photo_id: &str, face_id: &str, user_id: &str) -> Result<(), ApiError> {
        self.ensure_face_owner(face_id, photo_id, user_id)?;
        self.repo.delete_face(face_id)
    }

    /// List every face across the user's photos.
    pub fn list_all_faces(&self, user_id: &str) -> Result<ListFacesResponse, ApiError> {
        let records = self.repo.list_faces_by_user(user_id)?;
        let faces: Vec<FaceResponse> = records.into_iter().map(|f| self.to_response(f)).collect();
        let total = faces.len();
        Ok(ListFacesResponse { faces, total })
    }

    /// Verifies the face belongs to `photo_id` and that `user_id` owns the photo.
    fn ensure_face_owner(
        &self,
        face_id: &str,
        photo_id: &str,
        user_id: &str,
    ) -> Result<(), ApiError> {
        let face = self.repo.get_face(face_id)?;
        if face.photo_id != photo_id {
            return Err(ApiError::not_found("Face not found"));
        }
        if self.repo.get_photo_user_id(&face.photo_id)? != user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        Ok(())
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
