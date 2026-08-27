export {
  BASE_URL,
  ApiClientError,
  getAuthHeader,
  getCurrentUserId,
  shouldSkipRefresh,
  clearAuthAndRedirect,
  refreshTokens,
  refreshTokensOnce,
  request,
  buildQuery,
  contentVersionQuery,
  isContentVersionConflict,
  CONTENT_VERSION_CONFLICT,
} from './client';

export type {
  ApiError,
  PaginatedResponse,
  ListQuery,
  RequestConfig,
  ContentVersionCheck,
} from './client';

export {
  AI_SETTINGS_STORAGE_KEY,
  DEFAULT_AI_SETTINGS,
  readAiSettings,
  writeAiSettings,
  aiCredentials,
  aiApi,
} from './ai';

export type { AiProvider, AiSettings, AiCompleteOptions } from './ai';

export {
  OOXML_MIME,
  OOXML_EXTENSION,
  ooxmlMimeFor,
  ooxmlAppForMime,
  isOoxmlMime,
  withOoxmlExtension,
  stripOoxmlExtension,
} from './ooxml';

export type { OoxmlApp } from './ooxml';
