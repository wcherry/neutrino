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
  OOXML_MIME,
  OOXML_EXTENSION,
  ooxmlMimeFor,
  ooxmlAppForMime,
  isOoxmlMime,
  withOoxmlExtension,
  stripOoxmlExtension,
} from './ooxml';

export type { OoxmlApp } from './ooxml';
