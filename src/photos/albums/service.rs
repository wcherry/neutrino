use crate::photos::albums::{
    dto::{
        AddPhotoToAlbumRequest, AlbumResponse, CreateAlbumRequest, ListAlbumsResponse,
        UpdateAlbumRequest,
    },
    model::{NewAlbumRecord, UpdateAlbumRecord},
    repository::AlbumsRepository,
};
use crate::photos::photos::repository::PhotosRepository;
use chrono::Utc;
use crate::shared::auth::AuthenticatedUser;
use crate::shared::ApiError;
use std::sync::Arc;
use uuid::Uuid;

pub struct AlbumsService {
    albums_repo: Arc<AlbumsRepository>,
    photos_repo: Arc<PhotosRepository>,
}

impl AlbumsService {
    pub fn new(albums_repo: Arc<AlbumsRepository>, photos_repo: Arc<PhotosRepository>) -> Self {
        AlbumsService {
            albums_repo,
            photos_repo,
        }
    }

    pub fn list_albums(&self, user: &AuthenticatedUser) -> Result<ListAlbumsResponse, ApiError> {
        let records = self.albums_repo.list_albums(&user.user_id)?;
        let albums = records
            .into_iter()
            .map(|r| {
                let count = self.albums_repo.count_album_photos(&r.id).unwrap_or(0);
                AlbumResponse {
                    id: r.id,
                    title: r.title,
                    description: r.description,
                    is_auto: r.is_auto,
                    person_id: r.person_id,
                    photo_count: count,
                    created_at: r.created_at.and_utc().to_rfc3339(),
                    updated_at: r.updated_at.and_utc().to_rfc3339(),
                }
            })
            .collect();
        Ok(ListAlbumsResponse { albums })
    }

    pub fn create_album(
        &self,
        user: &AuthenticatedUser,
        req: CreateAlbumRequest,
    ) -> Result<AlbumResponse, ApiError> {
        let title = req.title.trim().to_string();
        if title.is_empty() {
            return Err(ApiError::bad_request("Album title cannot be empty"));
        }
        let id = Uuid::new_v4().to_string();
        let new_album = NewAlbumRecord {
            id: &id,
            user_id: &user.user_id,
            title: &title,
            description: req.description.as_deref(),
            is_auto: false,
            person_id: None,
        };
        let album = self.albums_repo.insert_album(new_album)?;
        Ok(AlbumResponse {
            id: album.id,
            title: album.title,
            description: album.description,
            is_auto: album.is_auto,
            person_id: album.person_id,
            photo_count: 0,
            created_at: album.created_at.and_utc().to_rfc3339(),
            updated_at: album.updated_at.and_utc().to_rfc3339(),
        })
    }

    /// Create or refresh the smart album for a named person.
    /// Returns the album (creating it if it doesn't already exist) and syncs all photo IDs.
    pub fn upsert_person_smart_album(
        &self,
        user_id: &str,
        person_id: &str,
        person_name: &str,
        photo_ids: &[String],
    ) -> Result<AlbumResponse, ApiError> {
        let existing = self.albums_repo.find_auto_album_for_person(user_id, person_id)?;
        let album_id = if let Some(existing_album) = existing {
            existing_album.id
        } else {
            let id = Uuid::new_v4().to_string();
            let title = format!("Photos of {}", person_name);
            let new_album = NewAlbumRecord {
                id: &id,
                user_id,
                title: &title,
                description: None,
                is_auto: true,
                person_id: Some(person_id),
            };
            self.albums_repo.insert_album(new_album)?.id
        };

        self.albums_repo.sync_album_photos(&album_id, photo_ids)?;

        let album = self.albums_repo.get_album(&album_id)?;
        let count = self.albums_repo.count_album_photos(&album_id)?;
        Ok(AlbumResponse {
            id: album.id,
            title: album.title,
            description: album.description,
            is_auto: album.is_auto,
            person_id: album.person_id,
            photo_count: count,
            created_at: album.created_at.and_utc().to_rfc3339(),
            updated_at: album.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub fn get_album(
        &self,
        user: &AuthenticatedUser,
        album_id: &str,
    ) -> Result<AlbumResponse, ApiError> {
        let album = self.albums_repo.get_album(album_id)?;
        if album.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let count = self.albums_repo.count_album_photos(album_id)?;
        Ok(AlbumResponse {
            id: album.id,
            title: album.title,
            description: album.description,
            is_auto: album.is_auto,
            person_id: album.person_id,
            photo_count: count,
            created_at: album.created_at.and_utc().to_rfc3339(),
            updated_at: album.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub fn update_album(
        &self,
        user: &AuthenticatedUser,
        album_id: &str,
        req: UpdateAlbumRequest,
    ) -> Result<AlbumResponse, ApiError> {
        let album = self.albums_repo.get_album(album_id)?;
        if album.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        let changes = UpdateAlbumRecord {
            title: req
                .title
                .map(|t| t.trim().to_string())
                .filter(|t| !t.is_empty()),
            description: req.description.map(Some),
            updated_at: Utc::now().naive_utc(),
        };
        let updated = self.albums_repo.update_album(album_id, changes)?;
        let count = self.albums_repo.count_album_photos(album_id)?;
        Ok(AlbumResponse {
            id: updated.id,
            title: updated.title,
            description: updated.description,
            is_auto: updated.is_auto,
            person_id: updated.person_id,
            photo_count: count,
            created_at: updated.created_at.and_utc().to_rfc3339(),
            updated_at: updated.updated_at.and_utc().to_rfc3339(),
        })
    }

    pub fn delete_album(
        &self,
        user: &AuthenticatedUser,
        album_id: &str,
    ) -> Result<(), ApiError> {
        let album = self.albums_repo.get_album(album_id)?;
        if album.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        self.albums_repo.delete_album(album_id)
    }

    pub fn add_photo_to_album(
        &self,
        user: &AuthenticatedUser,
        album_id: &str,
        req: AddPhotoToAlbumRequest,
    ) -> Result<(), ApiError> {
        let album = self.albums_repo.get_album(album_id)?;
        if album.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        // Verify the photo belongs to the user
        let photo = self.photos_repo.get_photo(&req.photo_id)?;
        if photo.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        self.albums_repo.add_photo_to_album(album_id, &req.photo_id)
    }

    pub fn remove_photo_from_album(
        &self,
        user: &AuthenticatedUser,
        album_id: &str,
        photo_id: &str,
    ) -> Result<(), ApiError> {
        let album = self.albums_repo.get_album(album_id)?;
        if album.user_id != user.user_id {
            return Err(ApiError::new(403, "FORBIDDEN", "Access denied"));
        }
        self.albums_repo.remove_photo_from_album(album_id, photo_id)
    }
}
