import { request } from '@neutrino/api-core';

// ---------------------------------------------------------------------------
// Slide text extraction helpers
// ---------------------------------------------------------------------------

type SlideEl = { type: string; content?: string };
type SlideItem = { elements?: SlideEl[]; notes?: string };
type SlidePresentationContent = { slides?: SlideItem[] };

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
}

export interface SlideMetaResponse {
  id: string;
  title: string;
  folderId: string | null;
  createdAt: string;
  updatedAt: string;
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
// Slides API
// ---------------------------------------------------------------------------

export const slidesApi = {
  async listSlides(): Promise<ListSlidesResponse> {
    return request<ListSlidesResponse>('/api/v1/slides');
  },

  async createSlide(body: CreateSlideRequest): Promise<SlideResponse> {
    return request<SlideResponse>('/api/v1/slides', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async getSlide(slideId: string): Promise<SlideResponse> {
    return request<SlideResponse>(`/api/v1/slides/${slideId}`);
  },

  async saveSlide(slideId: string, body: SaveSlideRequest): Promise<SlideMetaResponse> {
    return request<SlideMetaResponse>(`/api/v1/slides/${slideId}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  /**
   * Promote a raw Office (.pptx) Drive file in-place into a native Neutrino
   * slide deck: uploads `content` (the same JSON shape a normal save would
   * produce) and flips the file's mime type server-side. Same file id
   * afterwards.
   */
  async promoteSlide(slideId: string, content: string): Promise<SlideResponse> {
    return request<SlideResponse>(`/api/v1/slides/${slideId}/promote`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    });
  },

  async autosaveContent(
    slideId: string,
    content: string,
    filename: string,
    metadata?: { title?: string },
  ): Promise<SlideMetaResponse> {
    const formData = new FormData();
    formData.append('file', new Blob([content], { type: 'application/json' }), filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<SlideMetaResponse>(`/api/v1/slides/${slideId}/autosave`, { method: 'PUT', body: formData });
  },

  async autosaveEncryptedContent(
    slideId: string,
    content: string,
    filename: string,
    dek: Uint8Array,
    metadata?: { title?: string },
  ): Promise<SlideMetaResponse> {
    const { initSodium, encryptFile } = await import('@neutrino/e2e-crypto');
    await initSodium();
    const plainBytes = new TextEncoder().encode(content);
    const cipherBytes = encryptFile(plainBytes, dek);
    const blob = new Blob([cipherBytes.buffer as ArrayBuffer], { type: 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, filename);
    if (metadata) formData.append('metadata', JSON.stringify(metadata));
    return request<SlideMetaResponse>(`/api/v1/slides/${slideId}/autosave`, { method: 'PUT', body: formData });
  },


  async retrieveText(slideId: string): Promise<string> {
    const slide = await request<SlideResponse>(`/api/v1/slides/${slideId}`);
    const raw = await request<string>(slide.contentUrl, {}, { responseType: 'text' }).catch(() => '');
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
