import { Suspense } from 'react';
import { EditorSession } from '../../editorSession';
import { DocEditor } from './DocEditor';

export default function DocEditorPage() {
  return (
    <Suspense>
      <EditorSession editor={DocEditor} />
    </Suspense>
  );
}
