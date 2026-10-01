'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { FileText, LayoutTemplate } from 'lucide-react';
import { Button } from '@neutrino/ui';
import { docsApi, storageApi } from '@/lib/api';
import { DocumentLibrary } from '../DocumentLibrary';
import { DocTemplatePickerModal } from './DocTemplatePickerModal';

export default function DocsPage() {
  const router = useRouter();
  const [showTemplates, setShowTemplates] = useState(false);

  return (
    <>
      <DocumentLibrary
        title="Documents"
        noun="document"
        typeText="Doc"
        icon={FileText}
        iconColor="var(--color-accent)"
        editorPath="/docs/editor"
        queryKey="docs"
        previewKind="doc"
        fetchItems={async () => (await docsApi.listDocs()).docs}
        createItem={() => docsApi.createDoc({ title: 'Untitled document' })}
        renameItem={(id, title) => docsApi.saveDoc(id, { title })}
        deleteItem={(id) => storageApi.deleteFile(id)}
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
