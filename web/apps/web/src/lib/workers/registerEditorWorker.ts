'use client';

import { setBytesSealer } from '@neutrino/api-drive';
import { callEditorWorker, hasEditorWorker } from './editorWorkerClient';

/**
 * Seals uploads and autosaves in the editor worker. Imported once by the signed-in providers; the
 * worker itself starts on the first seal, not here. The plaintext is copied rather than
 * transferred: a caller that retries a failed upload seals the same bytes again.
 */
setBytesSealer((bytes, key) =>
  hasEditorWorker() ? callEditorWorker('encrypt', { bytes, key }) : Promise.reject(new Error('no editor worker')),
);
