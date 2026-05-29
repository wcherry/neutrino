import { request, buildQuery, ApiClientError } from '@neutrino/api-core';
import type { FileItem } from '@neutrino/api-drive';

// ---------------------------------------------------------------------------
// Photos types
// ---------------------------------------------------------------------------

export interface PhotoExifData {
  make?: string;
  model?: string;
  exposureTime?: string;
  fNumber?: number;
  iso?: number;
  focalLength?: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  datetimeOriginal?: string;
}

export interface PhotoMetadata {
  width?: number;
  height?: number;
  format?: string;
  exif?: PhotoExifData;
}

export interface PhotoResponse {
  id: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** URL to read/stream the media via Drive API */
  contentUrl: string;
  /** Base64-encoded thumbnail bytes, null if not yet generated */
  thumbnail: string | null;
  thumbnailMimeType: string | null;
  isStarred: boolean;
  isArchived: boolean;
  captureDate: string | null;
  createdAt: string;
  updatedAt: string;
  /** Extracted image metadata; null until the worker has processed the photo */
  metadata: PhotoMetadata | null;
}

export interface ListPhotosResponse {
  photos: PhotoResponse[];
  total: number;
}

export interface RegisterPhotoRequest {
  fileId: string;
  captureDate?: string | null;
}

export interface UpdatePhotoRequest {
  isStarred?: boolean;
  isArchived?: boolean;
}

export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
  confidence: number;
  imageWidth: number;
  imageHeight: number;
}

export interface FaceResponse {
  id: string;
  photoId: string;
  boundingBox: FaceBoundingBox;
  thumbnail: string | null;
  thumbnailMimeType: string | null;
  personId: string | null;
  createdAt: string;
}

export interface ListFacesResponse {
  faces: FaceResponse[];
  total: number;
}

export interface PersonFaceThumbnail {
  id: string;
  thumbnail: string | null;
  thumbnailMimeType: string | null;
}

export interface PersonResponse {
  id: string;
  name: string | null;
  coverFaceId: string | null;
  coverThumbnail: string | null;
  coverThumbnailMimeType: string | null;
  faceCount: number;
  faces: PersonFaceThumbnail[];
  createdAt: string;
  updatedAt: string;
}

export interface ListPersonsResponse {
  persons: PersonResponse[];
  total: number;
}

export interface AlbumResponse {
  id: string;
  title: string;
  description: string | null;
  isAuto: boolean;
  personId: string | null;
  photoCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListAlbumsResponse {
  albums: AlbumResponse[];
}

export interface CreateAlbumRequest {
  title: string;
  description?: string | null;
}

export interface UpdateAlbumRequest {
  title?: string;
  description?: string | null;
}

// ---------------------------------------------------------------------------
// Phase 7 types: Timeline & Relationships
// ---------------------------------------------------------------------------

export interface TimelineGroup {
  label: string;
  month: string;
  photos: PhotoResponse[];
}

export interface PersonTimelineResponse {
  groups: TimelineGroup[];
}

export interface PersonRelationship {
  personAId: string;
  personAName: string | null;
  personAThumbnail: string | null;
  personAThumbnailMimeType: string | null;
  personBId: string;
  personBName: string | null;
  personBThumbnail: string | null;
  personBThumbnailMimeType: string | null;
  photoCount: number;
}

export interface PersonRelationshipsResponse {
  relationships: PersonRelationship[];
}

export interface MapPhotoItem {
  id: string;
  thumbnailUrl: string;
  latitude: number;
  longitude: number;
  captureDate: string | null;
}

export interface PhotoMapResponse {
  items: MapPhotoItem[];
}

export interface CropParams {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PhotoEditParams {
  brightness?: number;
  contrast?: number;
  saturation?: number;
  warmth?: number;
  highlights?: number;
  shadows?: number;
  crop?: CropParams;
  rotate?: number;
  filter?: string;
}

export interface PhotoEditResponse {
  photoId: string;
  edits: PhotoEditParams;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryPhotoItem {
  id: string;
  thumbnailUrl: string;
  captureDate: string | null;
}

export interface MemoryYear {
  year: number;
  photos: MemoryPhotoItem[];
}

export interface MemoriesResponse {
  memories: MemoryYear[];
}

export interface YearInReviewResponse {
  year: number;
  photos: MemoryPhotoItem[];
}

export interface UnlockTokenResponse {
  unlockToken: string;
  expiresAt: string;
}

export interface BackedUpPhotoItem {
  id: string;
  name: string;
  sizeBytes: number;
  captureDate: string | null;
}

export interface BackedUpPhotosResponse {
  photos: BackedUpPhotoItem[];
}

export interface SuggestionResponse {
  id: string;
  faceId: string;
  faceThumbnail: string | null;
  faceThumbnailMimeType: string | null;
  personId: string;
  personName: string | null;
  personThumbnail: string | null;
  personThumbnailMimeType: string | null;
  /** Similarity score 0–1; higher = better match */
  confidence: number;
  createdAt: string;
}

export interface ListSuggestionsResponse {
  suggestions: SuggestionResponse[];
  total: number;
}

// ---------------------------------------------------------------------------
// Thumbnail generation
// ---------------------------------------------------------------------------

/**
 * Generate a JPEG thumbnail for an image file using the browser Canvas API.
 * Returns the raw base64 string (no data-URL prefix), or null on failure.
 */
export function generateThumbnail(file: File, maxSize = 512): Promise<string | null> {
  return new Promise((resolve) => {
    console.log('[thumbnail] generating for', file.name, file.type, file.size, 'bytes');
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      console.log('[thumbnail] image loaded, dimensions:', img.width, 'x', img.height);
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      console.log('[thumbnail] canvas size:', canvas.width, 'x', canvas.height, 'scale:', scale);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.warn('[thumbnail] failed: could not get 2d context');
        resolve(null);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
      const b64 = dataUrl.split(',')[1] ?? null;
      console.log('[thumbnail] generated, base64 length:', b64?.length ?? 0);
      resolve(b64);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      console.warn('[thumbnail] image load failed:', e);
      resolve(null);
    };
    img.src = url;
  });
}

// ---------------------------------------------------------------------------
// Photos API
// ---------------------------------------------------------------------------

export const photosApi = {
  async listPhotos(opts?: {
    archivedOnly?: boolean;
    starredOnly?: boolean;
    personIds?: string[];
    excludePersonIds?: string[];
  }): Promise<ListPhotosResponse> {
    const qs = buildQuery({
      archivedOnly: opts?.archivedOnly,
      starredOnly: opts?.starredOnly,
      personIds: opts?.personIds?.length ? opts.personIds.join(',') : undefined,
      excludePersonIds: opts?.excludePersonIds?.length ? opts.excludePersonIds.join(',') : undefined,
    });
    return request<ListPhotosResponse>(`/api/v1/photos${qs}`);
  },

  async registerPhoto(body: RegisterPhotoRequest): Promise<PhotoResponse> {
    return request<PhotoResponse>('/api/v1/photos', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getPhoto(photoId: string): Promise<PhotoResponse> {
    return request<PhotoResponse>(`/api/v1/photos/${photoId}`);
  },

  async updatePhoto(photoId: string, body: UpdatePhotoRequest): Promise<PhotoResponse> {
    return request<PhotoResponse>(`/api/v1/photos/${photoId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async trashPhoto(photoId: string): Promise<void> {
    return request<void>(`/api/v1/photos/${photoId}`, { method: 'DELETE' });
  },

  async restorePhoto(photoId: string): Promise<PhotoResponse> {
    return request<PhotoResponse>(`/api/v1/photos/${photoId}/restore`, { method: 'POST' });
  },

  async listTrash(): Promise<ListPhotosResponse> {
    return request<ListPhotosResponse>('/api/v1/photos/trash');
  },

  async emptyTrash(): Promise<void> {
    return request<void>('/api/v1/photos/trash', { method: 'DELETE' });
  },

  /** Upload a media file to Drive then register it in Photos. Returns the photo record. */
  async uploadPhoto(
    file: File,
    onProgress?: (percent: number) => void,
  ): Promise<PhotoResponse> {
    const formData = new FormData();
    if (file.type.startsWith('image/')) {
      const thumbnailB64 = await generateThumbnail(file);
      if (thumbnailB64) formData.append('thumbnail_b64', thumbnailB64);
    }
    formData.append('file', file);
    const fileItem = await request<FileItem>('/api/v1/drive/files/upload', {
      method: 'POST',
      body: formData,
    }, { onUploadProgress: onProgress });
    return request<PhotoResponse>('/api/v1/photos', {
      method: 'POST',
      body: JSON.stringify({ fileId: fileItem.id } satisfies RegisterPhotoRequest),
    });
  },

  async getMap(bbox?: string): Promise<PhotoMapResponse> {
    const qs = buildQuery({ bbox, limit: 500 });
    return request<PhotoMapResponse>(`/api/v1/photos/map${qs}`);
  },

  async getEdits(photoId: string): Promise<PhotoEditResponse | null> {
    try {
      return await request<PhotoEditResponse>(`/api/v1/photos/${photoId}/edits`);
    } catch (e) {
      if (e instanceof ApiClientError && e.statusCode === 404) return null;
      throw e;
    }
  },

  async saveEdits(photoId: string, params: PhotoEditParams): Promise<PhotoEditResponse> {
    return request<PhotoEditResponse>(`/api/v1/photos/${photoId}/edits`, {
      method: 'PUT',
      body: JSON.stringify(params),
    });
  },

  async deleteEdits(photoId: string): Promise<void> {
    return request<void>(`/api/v1/photos/${photoId}/edits`, { method: 'DELETE' });
  },

  async getMemories(): Promise<MemoriesResponse> {
    return request<MemoriesResponse>('/api/v1/photos/memories');
  },

  async getYearInReview(year?: number): Promise<YearInReviewResponse> {
    const qs = buildQuery({ year });
    return request<YearInReviewResponse>(`/api/v1/photos/year-in-review${qs}`);
  },

  async setupLockedFolder(pin: string): Promise<void> {
    return request<void>('/api/v1/photos/locked-folder/setup', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  async unlockFolder(pin: string): Promise<UnlockTokenResponse> {
    return request<UnlockTokenResponse>('/api/v1/photos/locked-folder/unlock', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    });
  },

  async lockPhoto(photoId: string): Promise<void> {
    return request<void>(`/api/v1/photos/${photoId}/lock`, { method: 'PUT' });
  },

  async unlockPhoto(photoId: string): Promise<void> {
    return request<void>(`/api/v1/photos/${photoId}/unlock-photo`, { method: 'PUT' });
  },

  async updateShareSettings(photoId: string, stripGps: boolean): Promise<void> {
    return request<void>(`/api/v1/photos/${photoId}/share-settings`, {
      method: 'PUT',
      body: JSON.stringify({ stripGps }),
    });
  },

  async getBackedUp(): Promise<BackedUpPhotosResponse> {
    return request<BackedUpPhotosResponse>('/api/v1/photos/backed-up');
  },
};

export const facesApi = {
  async listFaces(photoId: string): Promise<ListFacesResponse> {
    return request<ListFacesResponse>(`/api/v1/photos/${photoId}/faces`);
  },
};

export const suggestionsApi = {
  async listSuggestions(): Promise<ListSuggestionsResponse> {
    return request<ListSuggestionsResponse>('/api/v1/photos/suggestions');
  },
  async acceptSuggestion(id: string): Promise<void> {
    return request<void>(`/api/v1/photos/suggestions/${id}/accept`, { method: 'POST' });
  },
  async rejectSuggestion(id: string): Promise<void> {
    return request<void>(`/api/v1/photos/suggestions/${id}/reject`, { method: 'POST' });
  },
};

export const personsApi = {
  async listPersons(): Promise<ListPersonsResponse> {
    return request<ListPersonsResponse>('/api/v1/photos/persons/list');
  },
  async listPersonPhotos(personId: string): Promise<ListPhotosResponse> {
    return request<ListPhotosResponse>(`/api/v1/photos/persons/${personId}/photos`);
  },
  async getPersonTimeline(personId: string): Promise<PersonTimelineResponse> {
    return request<PersonTimelineResponse>(`/api/v1/photos/persons/${personId}/timeline`);
  },
  async getRelationships(): Promise<PersonRelationshipsResponse> {
    return request<PersonRelationshipsResponse>('/api/v1/photos/persons/relationships');
  },
  async createSmartAlbum(personId: string): Promise<AlbumResponse> {
    return request<AlbumResponse>(`/api/v1/photos/persons/${personId}/smart-album`, {
      method: 'POST',
    });
  },
  async renamePerson(personId: string, name: string): Promise<PersonResponse> {
    return request<PersonResponse>(`/api/v1/photos/persons/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
  },
  async mergePersons(targetId: string, sourceId: string): Promise<PersonResponse> {
    return request<PersonResponse>(`/api/v1/photos/persons/${targetId}/merge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId }),
    });
  },
  async reassignFace(personId: string, faceId: string, targetPersonId: string): Promise<void> {
    return request<void>(`/api/v1/photos/persons/${personId}/faces/${faceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetPersonId }),
    });
  },
  async removeFace(personId: string, faceId: string): Promise<void> {
    return request<void>(`/api/v1/photos/persons/${personId}/faces/${faceId}`, {
      method: 'DELETE',
    });
  },
};

export const albumsApi = {
  async listAlbums(): Promise<ListAlbumsResponse> {
    return request<ListAlbumsResponse>('/api/v1/albums');
  },

  async createAlbum(body: CreateAlbumRequest): Promise<AlbumResponse> {
    return request<AlbumResponse>('/api/v1/albums', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getAlbum(albumId: string): Promise<AlbumResponse> {
    return request<AlbumResponse>(`/api/v1/albums/${albumId}`);
  },

  async updateAlbum(albumId: string, body: UpdateAlbumRequest): Promise<AlbumResponse> {
    return request<AlbumResponse>(`/api/v1/albums/${albumId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteAlbum(albumId: string): Promise<void> {
    return request<void>(`/api/v1/albums/${albumId}`, { method: 'DELETE' });
  },

  async addPhoto(albumId: string, photoId: string): Promise<void> {
    return request<void>(`/api/v1/albums/${albumId}/items`, {
      method: 'POST',
      body: JSON.stringify({ photoId }),
    });
  },

  async removePhoto(albumId: string, photoId: string): Promise<void> {
    return request<void>(`/api/v1/albums/${albumId}/items/${photoId}`, { method: 'DELETE' });
  },
};
