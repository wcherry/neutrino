import { Suspense } from 'react';
import { Spinner } from '@neutrino/ui';
import { DiagramEditor } from './DiagramEditor';

export default function DiagramEditorPage() {
  return (
    <Suspense fallback={<Spinner size="lg" overlay />}>
      <DiagramEditor />
    </Suspense>
  );
}
