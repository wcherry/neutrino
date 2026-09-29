import { Suspense } from 'react';
import { EditorSession } from '../../editorSession';
import { DrawingEditor } from './DrawingEditor';

export default function DrawingEditorPage() {
  return (
    <Suspense>
      <EditorSession editor={DrawingEditor} />
    </Suspense>
  );
}
