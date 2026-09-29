import { Suspense } from 'react';
import { EditorSession } from '../../editorSession';
import { SheetEditor } from './SheetEditor';

export default function SheetEditorPage() {
  return (
    <Suspense fallback={<div style={{ padding: '2rem' }}>Loading spreadsheet…</div>}>
      <EditorSession editor={SheetEditor} />
    </Suspense>
  );
}
