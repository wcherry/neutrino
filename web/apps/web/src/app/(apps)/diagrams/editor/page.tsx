import { Suspense } from 'react';
import { Spinner } from '@neutrino/ui';
import { EditorSession } from '../../editorSession';
import { DiagramEditor } from './DiagramEditor';

export default function DiagramEditorPage() {
  return (
    <Suspense fallback={<Spinner size="lg" overlay />}>
      <EditorSession editor={DiagramEditor} />
    </Suspense>
  );
}
