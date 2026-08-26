import {
  request,
  ApiClientError,
  ooxmlMimeFor,
  isOoxmlMime,
  withOoxmlExtension,
  stripOoxmlExtension,
} from '@neutrino/api-core';

/**
 * What a presentation created today is: a real PowerPoint deck (issue #127),
 * so every other office suite can open one and import/export are file copies.
 */
export const PPTX_MIME_TYPE = ooxmlMimeFor('slides');

/**
 * The bespoke JSON presentations were written in before OOXML. Still read and
 * still written — a deck created in it stays in it, there is no migration —
 * which is why the library asks for both types.
 *
 * Mirrors `src/drive/storage/native_types.rs` on the backend.
 */
export const SLIDE_MIME_TYPE = 'application/x-neutrino-slide';

/** Both formats a file may be a native Neutrino presentation in. */
export const SLIDE_MIME_TYPES = [PPTX_MIME_TYPE, SLIDE_MIME_TYPE] as const;

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
    title: stripOoxmlExtension(file.name),
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
    const params = new URLSearchParams({ mimeType: SLIDE_MIME_TYPES.join(','), limit: '200' });
    const raw = await request<{ files: DriveFileDto[] }>(`/api/v1/drive/files?${params}`);
    return { slides: (raw.files ?? []).map(toSlideMeta) };
  },

  async createSlide(body: CreateSlideRequest): Promise<SlideResponse> {
    const title = body.title.trim();
    if (!title) throw new ApiClientError(400, 'BAD_REQUEST', 'Presentation title cannot be empty');
    // Created with no body. A `.pptx` is a zip, which the server has no
    // business building and could only write in the clear anyway; the editor
    // opens the empty file as the default one-slide deck and its first save
    // writes a real, sealed package.
    const file = await request<DriveFileDto>('/api/v1/drive/files', {
      method: 'POST',
      body: JSON.stringify({
        id: crypto.randomUUID(),
        name: withOoxmlExtension(title, 'slides'),
        mimeType: PPTX_MIME_TYPE,
        folderId: body.folderId ?? null,
      }),
    });
    return toSlide(file);
  },

  /**
   * Fetch a file as a presentation in the *bespoke JSON* format.
   *
   * Throws 404 for anything else, `.pptx` included. That is load-bearing and
   * not an oversight: the two formats are read and written by different code
   * paths in the editor, and this 404 is how it learns to take the OOXML one —
   * download the package, prefer the model inside it, fall back to parsing the
   * deck.
   */
  async getSlide(slideId: string): Promise<SlideResponse> {
    const file = await request<DriveFileDto>(`/api/v1/drive/files/${slideId}/info`);
    if (file.mimeType !== SLIDE_MIME_TYPE) {
      throw new ApiClientError(404, 'NOT_FOUND', 'Presentation not found');
    }
    return toSlide(file);
  },

  /**
   * Rename.
   *
   * Reads the file first, because the extension is not the caller's business:
   * it passes the title the user typed, and whether that has to land on disk
   * as `Kickoff` or `Kickoff.pptx` depends on the format the file is already
   * in. Renaming a `.pptx` to a bare name would leave a deck the operating
   * system no longer recognises.
   */
  async saveSlide(slideId: string, body: SaveSlideRequest): Promise<SlideMetaResponse> {
    const current = await request<DriveFileDto>(`/api/v1/drive/files/${slideId}/info`);
    if (body.title === undefined) return toSlideMeta(current);
    const name = isOoxmlMime(current.mimeType ?? '')
      ? withOoxmlExtension(body.title, 'slides')
      : body.title;
    if (name === current.name) return toSlideMeta(current);

    const file = await request<DriveFileDto>(`/api/v1/drive/files/${slideId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });
    return toSlideMeta(file);
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
