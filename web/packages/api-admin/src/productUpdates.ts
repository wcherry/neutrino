import { request } from '@neutrino/api-core';

/** An announcement an administrator writes for the weekly email. */
export interface ProductUpdate {
  id: string;
  title: string;
  /** Plain text. Blank lines separate paragraphs. */
  body: string;
  createdAt: string;
  updatedAt: string;
  /** `null` while it is a draft. */
  publishedAt: string | null;
}

/** The weekly email the caller would get for the last seven days. */
export interface WeeklyEmailPreview {
  subject: string;
  text: string;
  html: string;
}

export const productUpdatesApi = {
  /** Every update, drafts first. GET /api/v1/admin/product-updates */
  async list(): Promise<ProductUpdate[]> {
    const res = await request<{ updates: ProductUpdate[] }>('/api/v1/admin/product-updates');
    return res.updates;
  },

  /** A new draft. */
  async create(body: { title: string; body: string }): Promise<ProductUpdate> {
    return request<ProductUpdate>('/api/v1/admin/product-updates', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  async edit(id: string, body: { title: string; body: string }): Promise<ProductUpdate> {
    return request<ProductUpdate>(`/api/v1/admin/product-updates/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  /** Publish, so the next weekly email carries it, or take it back to a draft. */
  async setPublished(id: string, published: boolean): Promise<ProductUpdate> {
    return request<ProductUpdate>(`/api/v1/admin/product-updates/${encodeURIComponent(id)}/publish`, {
      method: 'POST',
      body: JSON.stringify({ published }),
    });
  },

  async remove(id: string): Promise<void> {
    return request<void>(
      `/api/v1/admin/product-updates/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
      { responseType: 'none' },
    );
  },

  /**
   * The weekly email the caller would get now, or `null` when the week held
   * nothing to tell (the server answers 204).
   */
  async previewWeeklyEmail(): Promise<WeeklyEmailPreview | null> {
    const res = await request<WeeklyEmailPreview | undefined>(
      '/api/v1/weekly-email/preview',
      {},
      { responseType: 'json' },
    );
    return res ?? null;
  },
};
