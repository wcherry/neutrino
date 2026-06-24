import { Suspense } from 'react';
import { PhotoEditor } from './PhotoEditor';

export default function PhotoEditorPage() {
  return (
    <Suspense>
      <PhotoEditor />
    </Suspense>
  );
}
