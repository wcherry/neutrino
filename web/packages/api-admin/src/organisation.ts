/**
 * The organisation's layer, as an administrator sets it (customization roadmap §6): preference
 * defaults and locks, which apps the instance offers (`apps.enabled` is one of those defaults), and
 * the instance's brand. Every route here takes an administrator's token.
 */

import { request } from '@neutrino/api-core';

export interface OrgLayer {
  values: Record<string, unknown>;
  locked: string[];
}

/** One key's change: a default (optionally locked), or `null` to remove it. */
export type OrgPreferenceChange = { value: unknown; locked?: boolean } | null;

export interface Branding {
  name: string | null;
  accent: string | null;
  signInMessage: string | null;
  logoLightUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  version: string | null;
}

export type BrandingAsset = 'logo-light' | 'logo-dark' | 'favicon';

export interface BrandingInput {
  name?: string | null;
  accent?: string | null;
  signInMessage?: string | null;
}

export const organisationApi = {
  getPreferences(): Promise<OrgLayer> {
    return request<OrgLayer>('/api/v1/admin/preferences');
  },

  patchPreferences(values: Record<string, OrgPreferenceChange>): Promise<OrgLayer> {
    return request<OrgLayer>('/api/v1/admin/preferences', { method: 'PATCH', body: JSON.stringify({ values }) });
  },

  /** Public: what every page already carries, for a screen that wants it fresh. */
  getBranding(): Promise<Branding> {
    return request<Branding>('/api/v1/branding', {}, { auth: 'none' });
  },

  putBranding(input: BrandingInput): Promise<Branding> {
    return request<Branding>('/api/v1/admin/branding', { method: 'PUT', body: JSON.stringify(input) });
  },

  /** The image as the raw body; the server checks what it really is from its bytes. */
  putAsset(kind: BrandingAsset, file: Blob): Promise<Branding> {
    return request<Branding>(`/api/v1/admin/branding/assets/${kind}`, {
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'application/octet-stream' },
    });
  },

  deleteAsset(kind: BrandingAsset): Promise<Branding> {
    return request<Branding>(`/api/v1/admin/branding/assets/${kind}`, { method: 'DELETE' });
  },
};
