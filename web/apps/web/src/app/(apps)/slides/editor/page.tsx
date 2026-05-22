import { Suspense } from 'react';
import { Spinner } from '@neutrino/ui';
import { SlideEditor } from './SlideEditor';

export default function SlideEditorPage() {
  return (
    <Suspense fallback={<Spinner size="lg" overlay />}>
      <SlideEditor />
    </Suspense>
  );
}
