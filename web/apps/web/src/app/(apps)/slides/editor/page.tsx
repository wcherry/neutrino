import { Suspense } from 'react';
import { Spinner } from '@neutrino/ui';
import { EditorSession } from '../../editorSession';
import { SlideEditor } from './SlideEditor';

export default function SlideEditorPage() {
  return (
    <Suspense fallback={<Spinner size="lg" overlay />}>
      <EditorSession editor={SlideEditor} />
    </Suspense>
  );
}
