/**
 * API client re-exports.
 *
 * This file re-exports everything from the split @neutrino/* packages so that
 * existing imports throughout the app continue to work without modification.
 *
 * For new code, prefer importing directly from the specific package:
 *   import { storageApi } from '@neutrino/api-drive';
 *   import { authApi } from '@neutrino/auth';
 */

export * from '@neutrino/api-core';
export * from '@neutrino/api-drive';
export * from '@neutrino/api-docs';
export * from '@neutrino/api-sheets';
export * from '@neutrino/api-slides';
export * from '@neutrino/api-photos';
export * from '@neutrino/api-notes';
export * from '@neutrino/api-calendar';
export * from '@neutrino/auth';
export * from '@neutrino/api-admin';
export * from '@neutrino/api-diagrams';
export * from '@neutrino/api-drawing';
// NOTE: @neutrino/api-themes is intentionally not re-exported here — its
// CreateThemeRequest/UpdateThemeRequest/ListThemesResponse type names collide
// with @neutrino/api-slides' slide-theme types of the same name. Import
// directly from '@neutrino/api-themes' instead (all new theme code does).
// NOTE: @neutrino/api-links is intentionally not re-exported here either —
// its BacklinksResponse/FileLinkItem type names collide with
// @neutrino/api-notes' equivalents of the same name (notes' own backlinks
// types are removed once notes migrates onto this package). Import directly
// from '@neutrino/api-links' instead.
