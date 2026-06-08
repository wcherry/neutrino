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
export * from '@neutrino/api-drawing';
export * from '@neutrino/api-drive';
export * from '@neutrino/api-docs';
export * from '@neutrino/api-sheets';
export * from '@neutrino/api-slides';
export * from '@neutrino/api-photos';
export * from '@neutrino/api-notes';
export * from '@neutrino/api-calendar';
export * from '@neutrino/auth';
export * from '@neutrino/api-admin';
