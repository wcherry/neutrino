'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LayoutTemplate } from 'lucide-react';
import { Button } from '@neutrino/ui';
import { FileLibrary } from '../FileLibrary';
import { DocTemplatePickerModal } from './DocTemplatePickerModal';

export default function DocsPage() {
  const router = useRouter();
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <>
      <FileLibrary
        library="docs"
        headerActions={
          <Button variant="secondary" icon={<LayoutTemplate size={16} />} onClick={() => setShowTemplates(true)}>
            New from template
          </Button>
        }
      />
      {showTemplates && (
        <DocTemplatePickerModal
          onClose={() => setShowTemplates(false)}
          onCreated={(id) => router.push(`/docs/editor?id=${id}`)}
        />
      )}
    </>
  );
}
