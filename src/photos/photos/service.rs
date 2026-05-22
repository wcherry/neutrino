use crate::photos::photos::{
    dto::{
        BackedUpPhotoItem, BackedUpPhotosResponse, ListPhotosResponse, MapPhotoItem,
        MemoriesResponse, MemoryPhotoItem, MemoryYear, PhotoEditParams, PhotoEditResponse,
        PhotoMapResponse, PhotoResponse, RegisterPhotoRequest, ShareSettingsRequest,
        UnlockTokenResponse, UpdatePhotoRequest, YearInReviewResponse,
    },
    model::{NewLockedFolderSettings, NewPhotoEdit, NewPhotoRecord, PhotoRecord, UpdatePhotoRecord},
    repository::PhotosRepository,
};
use chrono::{Datelike, Utc};
use sha2::{Digest, Sha256};
use crate::shared::auth::AuthenticatedUser;
use crate::shared::drive_client::{DriveClient, DriveFileRecord};
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct PhotosService {
    repo: Arc<PhotosRepository>,
    drive: Arc<DriveClient>,
    drive_base_url: String,
    worker_secret: String,
    http: reqwest::Client,
}

impl PhotosService {
    pub fn new(
        repo: Arc<PhotosRepository>,
        drive: Arc<DriveClient>,
        drive_base_url: String,
        worker_secret: String,
    ) -> Self {
        PhotosService {
            repo,
            drive,
            drive_base_url,
            worker_secret,
            http: reqwest::Client::new(),
        }
    }

    pub async fn register_photo(
        &self,
        user: &AuthenticatedUser,
        req: RegisterPhotoRequest,
    ) -> Result<PhotoResponse, ApiError> {
        let file = self
            .drive
            .get_file(&user.token, &req.file_id, "File not found")
            .await?;

        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("File is in trash"));
        }

        let capture_date = req
            .capture_date
            .as_deref()
            .and_then(|s| chrono::NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok());

        let id = Uuid::new_v4().to_string();
        let new_photo = NewPhotoRecord {
            id: &id,
            user_id: &user.user_id,
            file_id: &req.file_id,
            is_starred: false,
            is_archived: false,
            deleted_at: None,
            capture_date,
            metadata: None,
        };
        let photo = self.repo.insert_photo(new_photo)?;

        // Enqueue thumbnail + face detection jobs via drive API — failures are non-fatal.
        if let Err(e) = self.enqueue_thumbnail_job(&req.file_id).await {
            tracing::warn!("Failed to enqueue thumbnail job for file {}: {}", req.file_id, e);
        }
        if let Err(e) = self.enqueue_face_detect_job(&id, &req.file_id, &user.user_id).await {
            tracing::warn!("Failed to enqueue face_detect job for photo {}: {}", id, e);
        }

        Ok(self.to_response(photo, Some(&file)))
    }

    async fn enqueue_face_detect_job(&self, photo_id: &str, file_id: &str, user_id: &str) -> Result<(), String> {
        let url = format!("{}/api/v1/jobs", self.drive_base_url);
        let body = serde_json::json!({
            "jobType": "face_detect",
            "payload": { "photoId": photo_id, "fileId": file_id, "userId": user_id },
            "timeoutSecs": 120
        });
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.worker_secret))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("Drive jobs API returned {}", resp.status()))
        }
    }

    async fn enqueue_thumbnail_job(&self, file_id: &str) -> Result<(), String> {
        let url = format!("{}/api/v1/jobs", self.drive_base_url);
        let body = serde_json::json!({
            "jobType": "thumbnail",
            "payload": { "fileId": file_id },
            "timeoutSecs": 30
        });
        let resp = self
            .http
            .post(&url)
            .header("Authorization", format!("Bearer {}", self.worker_secret))
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("HTTP error: {}", e))?;
        if resp.status().is_success() {
            Ok(())
        } else {
            Err(format!("Drive jobs API returned {}", resp.status()))
        }
    }

    pub async fn list_photos_by_person_filter(
        &self,
        user: &AuthenticatedUser,
        person_ids: &[String],
        exclude_person_ids: &[String],
    ) -> Result<ListPhotosResponse, ApiError> {
        if person_ids.is_empty() && exclude_person_ids.is_empty() {
            return self.list_photos(user, false, false).await;
        }

        // Compute the inclusion intersection: photos containing faces from ALL included persons.
        let included: std::collections::HashSet<String> = if person_ids.is_empty() {
            // No inclusion filter — start with all photos for this user.
            self.repo
                .list_photos(&user.user_id, false, false)?
                .into_iter()
                .map(|p| p.id)
                .collect()
        } else {
            let mut sets: Vec<std::collections::HashSet<String>> =
                Vec::with_capacity(person_ids.len());
            for pid in person_ids {
                let ids = self.repo.get_photo_ids_for_person(&user.user_id, pid)?;
                sets.push(ids.into_iter().collect());
            }
            sets[0]
                .iter()
                .filter(|id| sets[1..].iter().all(|s| s.contains(*id)))
                .cloned()
                .collect()
        };

        // Compute exclusion: remove photos that contain any excluded person.
        let excluded: std::collections::HashSet<String> = if exclude_person_ids.is_empty() {
            std::collections::HashSet::new()
        } else {
            let mut excluded_set = std::collections::HashSet::new();
            for pid in exclude_person_ids {
                let ids = self.repo.get_photo_ids_for_person(&user.user_id, pid)?;
                excluded_set.extend(ids);
            }
            excluded_set
        };

        let result_ids: Vec<String> = included
            .into_iter()
            .filter(|id| !excluded.contains(id))
            .collect();

        self.list_photos_by_ids(user, &result_ids).await
    }

    pub async fn list_photos(
        &self,
        user: &AuthenticatedUser,
        include_archived: bool,
        starred_only: bool,
    ) -> Result<ListPhotosResponse, ApiError> {
        let records = self
            .repo
            .list_photos(&user.user_id, include_archived, starred_only)?;
        let mut responses = Vec::with_capacity(records.len());
        for r in &records {
            let file = self
                .drive
                .get_file(&user.token, &r.file_id, "File not found")
                .await
                .ok();
            responses.push(self.to_response(r.clone(), file.as_ref()));
        }
        let total = responses.len();
        Ok(ListPhotosResponse {
            photos: responses,
            total,
        })
    }

    pub async fn get_photo(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
    ) -> Result<PhotoResponse, ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let file = self
            .drive
            .get_file(&user.token, &photo.file_id, "File not found")
            .await?;
        Ok(self.to_response(photo, Some(&file)))
    }

    pub async fn update_photo(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
        req: UpdatePhotoRequest,
    ) -> Result<PhotoResponse, ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }

        let changes = UpdatePhotoRecord {
            is_starred: req.is_starred,
            is_archived: req.is_archived,
            deleted_at: None,
            updated_at: Utc::now().naive_utc(),
        };
        let updated = self.repo.update_photo(photo_id, changes)?;
        let file = self
            .drive
            .get_file(&user.token, &updated.file_id, "File not found")
            .await?;
        Ok(self.to_response(
            updated,
            Some(&file),
        ))
    }

    pub async fn trash_photo(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
    ) -> Result<(), ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let changes = UpdatePhotoRecord {
            is_starred: None,
            is_archived: None,
            deleted_at: Some(Some(Utc::now().naive_utc())),
            updated_at: Utc::now().naive_utc(),
        };
        self.repo.update_photo(photo_id, changes)?;
        Ok(())
    }

    pub async fn restore_photo(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
    ) -> Result<PhotoResponse, ApiError> {
        let photo = self.repo.get_photo_including_deleted(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        if photo.deleted_at.is_none() {
            return Err(ApiError::bad_request("Photo is not in trash"));
        }
        let changes = UpdatePhotoRecord {
            is_starred: None,
            is_archived: None,
            deleted_at: Some(None),
            updated_at: Utc::now().naive_utc(),
        };
        let updated = self.repo.update_photo(photo_id, changes)?;
        let file = self
            .drive
            .get_file(&user.token, &updated.file_id, "File not found")
            .await?;
        Ok(self.to_response(
            updated,
            Some(&file),
        ))
    }

    pub async fn list_trash(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<ListPhotosResponse, ApiError> {
        let records = self.repo.list_trash(&user.user_id)?;
        let mut responses = Vec::with_capacity(records.len());
        for r in &records {
            let file = self
                .drive
                .get_file(&user.token, &r.file_id, "File not found")
                .await
                .ok();
            responses.push(self.to_response(r.clone(), file.as_ref()));
        }
        let total = responses.len();
        Ok(ListPhotosResponse {
            photos: responses,
            total,
        })
    }

    pub fn empty_trash(&self, user: &AuthenticatedUser) -> Result<(), ApiError> {
        self.repo.empty_trash(&user.user_id)?;
        Ok(())
    }

    pub fn save_metadata(&self, photo_id: &str, metadata: String) -> Result<(), ApiError> {
        let _: serde_json::Value = serde_json::from_str(&metadata)
            .map_err(|_| ApiError::bad_request("Invalid JSON metadata"))?;
        self.repo.get_photo_including_deleted(photo_id)?;
        self.repo.set_metadata(photo_id, metadata)
    }

    pub async fn list_photos_by_ids(
        &self,
        user: &AuthenticatedUser,
        photo_ids: &[String],
    ) -> Result<ListPhotosResponse, ApiError> {
        let mut responses = Vec::with_capacity(photo_ids.len());
        for photo_id in photo_ids {
            let photo = match self.repo.get_photo(photo_id) {
                Ok(p) => p,
                Err(_) => continue,
            };
            if photo.user_id != user.user_id {
                continue;
            }
            let file = self
                .drive
                .get_file(&user.token, &photo.file_id, "File not found")
                .await
                .ok();
            responses.push(self.to_response(photo, file.as_ref()));
        }
        let total = responses.len();
        Ok(ListPhotosResponse {
            photos: responses,
            total,
        })
    }

    fn to_response(&self, photo: PhotoRecord, file: Option<&DriveFileRecord>) -> PhotoResponse {
        let name = file.map(|f| f.name.as_str()).unwrap_or("Unknown");
        let mime_type = file
            .and_then(|f| f.mime_type.as_deref())
            .unwrap_or("application/octet-stream");
        let thumbnail = file.and_then(|f| f.cover_thumbnail.clone());
        let thumbnail_mime_type = file.and_then(|f| f.cover_thumbnail_mime_type.clone());
        let metadata = photo
            .metadata
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok());
        PhotoResponse {
            id: photo.id.clone(),
            file_id: photo.file_id.clone(),
            file_name: name.to_string(),
            mime_type: mime_type.to_string(),
            size_bytes: file.map(|f| f.size_bytes).unwrap_or(0),
            content_url: format!("/api/v1/drive/files/{}", photo.file_id),
            thumbnail,
            thumbnail_mime_type,
            is_starred: photo.is_starred,
            is_archived: photo.is_archived,
            capture_date: photo.capture_date.map(|d| d.and_utc().to_rfc3339()),
            created_at: photo.created_at.and_utc().to_rfc3339(),
            updated_at: photo.updated_at.and_utc().to_rfc3339(),
            metadata,
        }
    }

    // ---- 6.7.1 Photo Map ----

    pub fn get_photo_map(
        &self,
        user: &AuthenticatedUser,
        bbox: Option<&str>,
        limit: i64,
    ) -> Result<PhotoMapResponse, ApiError> {
        let records = self.repo.list_photos_with_gps(&user.user_id, limit)?;

        // Parse optional bbox: "minLat,minLon,maxLat,maxLon"
        let bbox_coords = bbox.and_then(|b| {
            let parts: Vec<f64> = b.split(',').filter_map(|s| s.trim().parse().ok()).collect();
            if parts.len() == 4 {
                Some((parts[0], parts[1], parts[2], parts[3]))
            } else {
                None
            }
        });

        let mut items = Vec::new();
        for record in records {
            if let Some(meta_str) = &record.metadata {
                if let Ok(meta) = serde_json::from_str::<serde_json::Value>(meta_str) {
                    let lat = meta.get("latitude").and_then(|v| v.as_f64());
                    let lon = meta.get("longitude").and_then(|v| v.as_f64());
                    if let (Some(lat), Some(lon)) = (lat, lon) {
                        // Apply bbox filter if provided
                        if let Some((min_lat, min_lon, max_lat, max_lon)) = bbox_coords {
                            if lat < min_lat || lat > max_lat || lon < min_lon || lon > max_lon {
                                continue;
                            }
                        }
                        items.push(MapPhotoItem {
                            id: record.id.clone(),
                            thumbnail_url: format!("/api/v1/photos/{}/thumbnail", record.id),
                            latitude: lat,
                            longitude: lon,
                            capture_date: record.capture_date.map(|d| d.and_utc().to_rfc3339()),
                        });
                    }
                }
            }
        }

        Ok(PhotoMapResponse { items })
    }

    // ---- 6.7.2 Photo Edits ----

    pub fn save_photo_edits(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
        params: PhotoEditParams,
    ) -> Result<PhotoEditResponse, ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let edits_json =
            serde_json::to_string(&params).map_err(|_| ApiError::internal("Serialization error"))?;
        let now = Utc::now().naive_utc();
        let new_edit = NewPhotoEdit {
            photo_id: photo_id.to_string(),
            edits_json,
            preview_storage_path: None,
            created_at: now,
            updated_at: now,
        };
        let edit = self.repo.upsert_photo_edit(new_edit)?;
        let edits: PhotoEditParams = serde_json::from_str(&edit.edits_json)
            .map_err(|_| ApiError::internal("Deserialization error"))?;
        Ok(PhotoEditResponse {
            photo_id: edit.photo_id,
            edits,
            created_at: edit.created_at.and_utc().to_rfc3339(),
            updated_at: edit.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub fn get_photo_edits(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
    ) -> Result<Option<PhotoEditResponse>, ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let edit = self.repo.get_photo_edit(photo_id)?;
        match edit {
            None => Ok(None),
            Some(e) => {
                let edits: PhotoEditParams = serde_json::from_str(&e.edits_json)
                    .map_err(|_| ApiError::internal("Deserialization error"))?;
                Ok(Some(PhotoEditResponse {
                    photo_id: e.photo_id,
                    edits,
                    created_at: e.created_at.and_utc().to_rfc3339(),
                    updated_at: e.updated_at.and_utc().to_rfc3339(),
                }))
            }
        }
    }

    pub fn delete_photo_edits(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
    ) -> Result<(), ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        self.repo.delete_photo_edit(photo_id)?;
        Ok(())
    }

    // ---- 6.7.3 Memories ----

    pub fn get_memories(&self, user: &AuthenticatedUser) -> Result<MemoriesResponse, ApiError> {
        let today = Utc::now().naive_utc().date();
        let month = today.month();
        let day = today.day();

        let records = self.repo.list_photos_by_month_day(&user.user_id, month, day)?;

        // Group by year
        let mut by_year: std::collections::BTreeMap<i32, Vec<MemoryPhotoItem>> =
            std::collections::BTreeMap::new();
        for r in records {
            let year = r
                .capture_date
                .map(|d| d.year())
                .unwrap_or(r.created_at.year());
            let current_year = today.year();
            if year == current_year {
                continue; // Skip this year (not a memory)
            }
            by_year.entry(year).or_default().push(MemoryPhotoItem {
                id: r.id.clone(),
                thumbnail_url: format!("/api/v1/photos/{}/thumbnail", r.id),
                capture_date: r.capture_date.map(|d| d.and_utc().to_rfc3339()),
            });
        }

        let memories: Vec<MemoryYear> = by_year
            .into_iter()
            .rev()
            .map(|(year, mut photos)| {
                photos.truncate(10);
                MemoryYear { year, photos }
            })
            .collect();

        Ok(MemoriesResponse { memories })
    }

    pub fn get_year_in_review(
        &self,
        user: &AuthenticatedUser,
        year: Option<i32>,
    ) -> Result<YearInReviewResponse, ApiError> {
        let target_year = year.unwrap_or_else(|| Utc::now().naive_utc().year());
        let records = self.repo.list_photos_by_year(&user.user_id, target_year, 20)?;
        let photos = records
            .into_iter()
            .map(|r| MemoryPhotoItem {
                id: r.id.clone(),
                thumbnail_url: format!("/api/v1/photos/{}/thumbnail", r.id),
                capture_date: r.capture_date.map(|d| d.and_utc().to_rfc3339()),
            })
            .collect();
        Ok(YearInReviewResponse {
            year: target_year,
            photos,
        })
    }

    // ---- 6.7.4 Locked Folder ----

    fn hash_pin(pin: &str) -> String {
        let mut hasher = Sha256::new();
        hasher.update(pin.as_bytes());
        format!("{:x}", hasher.finalize())
    }

    pub fn setup_locked_folder(
        &self,
        user: &AuthenticatedUser,
        pin: &str,
    ) -> Result<(), ApiError> {
        if pin.is_empty() {
            return Err(ApiError::bad_request("PIN must not be empty"));
        }
        let pin_hash = Self::hash_pin(pin);
        let now = Utc::now().naive_utc();
        let settings = NewLockedFolderSettings {
            user_id: user.user_id.clone(),
            is_enabled: 1,
            pin_hash: Some(pin_hash),
            created_at: now,
            updated_at: now,
        };
        self.repo.upsert_locked_folder_settings(settings)?;
        Ok(())
    }

    pub fn unlock_locked_folder(
        &self,
        user: &AuthenticatedUser,
        pin: &str,
    ) -> Result<UnlockTokenResponse, ApiError> {
        let settings = self
            .repo
            .get_locked_folder_settings(&user.user_id)?
            .ok_or_else(|| ApiError::not_found("Locked folder not set up"))?;

        let stored_hash = settings
            .pin_hash
            .ok_or_else(|| ApiError::bad_request("No PIN configured"))?;

        let provided_hash = Self::hash_pin(pin);
        if provided_hash != stored_hash {
            return Err(ApiError::new(403, "INVALID_PIN", "Incorrect PIN"));
        }

        // Issue a simple UUID-based unlock token with a 1-hour expiry
        let token = Uuid::new_v4().to_string();
        let expires_at = (Utc::now() + chrono::Duration::hours(1)).to_rfc3339();
        Ok(UnlockTokenResponse {
            unlock_token: token,
            expires_at,
        })
    }

    pub fn lock_photo(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
        locked: bool,
    ) -> Result<(), ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        self.repo.set_locked(photo_id, locked)
    }

    // ---- 6.7.5 Location Privacy ----

    pub fn update_share_settings(
        &self,
        user: &AuthenticatedUser,
        photo_id: &str,
        req: ShareSettingsRequest,
    ) -> Result<(), ApiError> {
        let photo = self.repo.get_photo(photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        self.repo.set_strip_gps(photo_id, req.strip_gps)
    }

    // ---- 6.7.6 Free Up Space ----

    pub async fn get_backed_up_photos(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<BackedUpPhotosResponse, ApiError> {
        let records = self.repo.list_backed_up_photos(&user.user_id)?;
        let mut photos = Vec::with_capacity(records.len());
        for r in records {
            let file = self
                .drive
                .get_file(&user.token, &r.file_id, "File not found")
                .await
                .ok();
            let name = file.map(|f| f.name).unwrap_or_else(|| "Unknown".to_string());
            photos.push(BackedUpPhotoItem {
                id: r.id.clone(),
                name,
                size_bytes: 0,
                capture_date: r.capture_date.map(|d| d.and_utc().to_rfc3339()),
            });
        }
        Ok(BackedUpPhotosResponse { photos })
    }
}
