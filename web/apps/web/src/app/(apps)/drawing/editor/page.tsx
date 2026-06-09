import { Suspense } from 'react';
import { DrawingEditor } from './DrawingEditor';

export default function DrawingEditorPage() {
  return (
    <Suspense>
      <DrawingEditor />
    </Suspense>
  );
}
