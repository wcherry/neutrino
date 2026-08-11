import { request, ApiClientError } from '@neutrino/api-core';

/**
 * A file is a native Neutrino presentation because it carries this mime type.
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const SLIDE_MIME_TYPE = 'application/x-neutrino-slide';

// ---------------------------------------------------------------------------
// Slide text extraction helpers
// ---------------------------------------------------------------------------

type SlideEl = { type: string; content?: string };
type SlideItem = { elements?: SlideEl[]; notes?: string };
type SlidePresentationContent = { slides?: SlideItem[] };

/**
 * Flatten a stored presentation body into searchable plain text — every text
 * element plus each slide's speaker notes.
 *
 * Takes the already-decrypted body rather than fetching it: slide content is
 * E2EE, so only the caller holds the DEK needed to read it (see
 * `readDocumentText` in the web app).
 */
export function extractSlideText(raw: string): string {
  if (!raw) return '';
  try {
    const parsed = JSON.parse(raw) as SlidePresentationContent;
    const parts: string[] = [];
    for (const s of parsed.slides ?? []) {
      for (const el of s.elements ?? []) {
        if (el.type === 'text' && el.content) parts.push(el.content);
      }
      if (s.notes) parts.push(s.notes);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

// ---------------------------------------------------------------------------
// Slides types
// ---------------------------------------------------------------------------

export interface SlideResponse {
  id: string;
  title: string;
  /** Path to read presentation content directly from the drive API (GET). */
  contentUrl: string;
  /** Path to write presentation content directly to the drive API (multipart POST). */
  contentWriteUrl: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Server-side content revision at load time. The editor sends it back as
   * `expectedContentVersion` on its first save, so a document changed by
   * another device since it was opened is caught immediately.
   */
  contentVersion: number;
}

export interface SlideMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * Server-side content revision, bumped on every content write. Pass it back as
   * `expectedContentVersion` on the next save so a stale write is rejected
   * rather than silently overwriting a newer revision.
   */
  contentVersion: number;
}

export interface CreateSlideRequest {
  title: string;
  folderId?: string | null;
}

export interface SaveSlideRequest {
  title?: string;
}

export interface ListSlidesResponse {
  slides: SlideMetaResponse[];
}

// ---------------------------------------------------------------------------
// Theme types
// ---------------------------------------------------------------------------

export interface SlideTheme {
  id: string;
  name: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily: string;
  backgroundImage: string | null;
  gradientBackground: string | null;
  defaultTransition: string;
  isSystem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateThemeRequest {
  name: string;
  primaryColor: string;
  backgroundColor: string;
  textColor: string;
  accentColor: string;
  fontFamily?: string;
  backgroundImage?: string | null;
  gradientBackground?: string | null;
  defaultTransition?: string;
}

export interface UpdateThemeRequest {
  name?: string;
  primaryColor?: string;
  backgroundColor?: string;
  textColor?: string;
  accentColor?: string;
  fontFamily?: string;
  backgroundImage?: string | null;
  gradientBackground?: string | null;
  defaultTransition?: string;
}

export interface ListThemesResponse {
  themes: SlideTheme[];
}

// ---------------------------------------------------------------------------
// Slides API — drive adapters
// ---------------------------------------------------------------------------
//
// Presentation CRUD is served by the generic drive file endpoints; a
// presentation is a Drive file whose mime type is
// `application/x-neutrino-slide`. These functions keep the slide-shaped
// contract their callers were written against and translate it to and from
// drive's file DTOs. Themes below are user-owned records rather than files, so
// they keep their own endpoints.

/** The subset of drive's file DTOs these adapters read. */
interface DriveFileDto {
  id: string;
  name: string;
  folderId: string | null;
  mimeType?: string | null;
  createdAt: string;
  updatedAt: string;
  contentVersion: number;
}

/**
 * Drive serialises timestamps as naive datetimes (`2026-08-10T12:00:00`) — no
 * offset — which `new Date()` would read as local time and shift by the
 * viewer's UTC offset. The values are UTC, so say so.
 */
function toIsoUtc(timestamp: string): string {
  if (!timestamp) return timestamp;
  return /(?:Z|[+-]\d{2}:?\d{2})$/.test(timestamp) ? timestamp : `${timestamp}Z`;
}

function toSlideMeta(file: DriveFileDto): SlideMetaResponse {
  return {
    id: file.id,
    title: file.name,
    folderId: file.folderId ?? null,
    createdAt: toIsoUtc(file.createdAt),
    updatedAt: toIsoUtc(file.updatedAt),
    contentVersion: file.contentVersion,
  };
}

function toSlide(file: DriveFileDto): SlideResponse {
  return {
    ...toSlideMeta(file),
    contentUrl: `/api/v1/drive/files/${file.id}`,
    contentWriteUrl: `/api/v1/drive/files/${file.id}/versions`,
  };
}

export const slidesApi = {
  async listSlides(): Promise<ListSlidesResponse> {
    const params = new URLSearchParams({ mimeType: SLIDE_MIME_TYPE, limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { slides: (raw.files ?? []).map(toSlideMeta) };
  },

  async createSlide(body: CreateSlideRequest): Promise<SlideResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Presentation title cannot be empty');
    // Drive takes a client-supplied id and seeds the empty-deck body from the
    // mime type, so create and first content write are one request.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: title,
        mimeType: SLIDE_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    return toSlide(file);
  },

  /**
   * Fetch a file as a native presentation.
   *
   * Throws 404 for a file that exists but isn't one — a raw .pptx, say. That
   * is load-bearing: the editor's office-mode fallback keys off this 404 to
   * decide it must download and parse the file as pptx instead.
   */
  async getSlide(slideId: string): Promise<SlideResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${slideId}/info`);
    if (file.mimeType !== SLIDE_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Presentation not found');
    }
    return toSlide(file);
  },

  async saveSlide(slideId: string, body: SaveSlideRequest): Promise<SlideMetaResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${slideId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: body.title }),
    });
    return toSlideMeta(file);
  },

  /**
   * Promote a raw Office (.pptx) Drive file in-place into a native Neutrino
   * slide deck: uploads `content` (the same JSON shape a normal save would
   * produce) and flips the file's mime type server-side. Same file id
   * afterwards.
   */
  async promoteSlide(slideId: string, content: string): Promise<SlideResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${slideId}/convert`, {
      method: 'POST',
      body: JSON.stringify({ targetMimeType: SLIDE_MIME_TYPE, content }),
    });
    return toSlide(file);
  },

  // ── Themes ────────────────────────────────────────────────────────────────

  async listThemes(): Promise<ListThemesResponse> {
    return request<ListThemesResponse>('/api/v1/slides/themes');
  },

  async createTheme(body: CreateThemeRequest): Promise<SlideTheme> {
    return request<SlideTheme>('/api/v1/slides/themes', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async updateTheme(themeId: string, body: UpdateThemeRequest): Promise<SlideTheme> {
    return request<SlideTheme>(`/api/v1/slides/themes/${themeId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  async deleteTheme(themeId: string): Promise<void> {
    await request<void>(`/api/v1/slides/themes/${themeId}`, { method: 'DELETE' });
  },
};

// ---------------------------------------------------------------------------
// Slides AI types & API
// ---------------------------------------------------------------------------

export interface ImageResult {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  url: string;
}

export interface ImageSearchResponse {
  images: ImageResult[];
}

export const slidesAI = {
  async complete(slideId: string, slideText: string): Promise<{ text: string }> {
    return request<{ text: string }>(`/api/v1/slides/${slideId}/ai/complete`, {
      method: 'POST',
      body: JSON.stringify({ slideText }),
    });
  },

  async imageSearch(slideId: string, query: string): Promise<ImageSearchResponse> {
    return request<ImageSearchResponse>(`/api/v1/slides/${slideId}/ai/image-search`, {
      method: 'POST',
      body: JSON.stringify({ query }),
    });
  },

  async design(slideId: string, slideContent: string): Promise<unknown> {
    return request<unknown>(`/api/v1/slides/${slideId}/ai/design`, {
      method: 'POST',
      body: JSON.stringify({ slideContent }),
    });
  },

  async autoformat(slideId: string, slideJson: string): Promise<unknown> {
    return request<unknown>(`/api/v1/slides/${slideId}/ai/autoformat`, {
      method: 'POST',
      body: JSON.stringify({ slideJson }),
    });
  },
};
