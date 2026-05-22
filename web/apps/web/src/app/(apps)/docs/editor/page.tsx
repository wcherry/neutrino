import { Suspense } from 'react';
import { DocEditor } from './DocEditor';

export default function DocEditorPage() {
  return (
    <Suspense>
      <DocEditor />
    </Suspense>
  );
}
