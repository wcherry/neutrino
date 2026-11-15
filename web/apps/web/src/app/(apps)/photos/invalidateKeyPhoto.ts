import type { QueryClient } from '@tanstack/react-query';

/**
 * Everything that shows a Live Photo's still or clip, after its key photo
 * changed (issue #317): the library and its motion candidates, faces, the
 * eligibility check (whose `keyPhoto` decides whether Revert is offered), and
 * the Drive listings, which show the still's new name, type and thumbnail.
 */
export function invalidateAfterKeyPhoto(queryClient: QueryClient): void {
  for (const key of ['photos', 'photo-motion', 'faces', 'photos-key-photo-target', 'contents', 'files', 'drive-live-photo-records']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
