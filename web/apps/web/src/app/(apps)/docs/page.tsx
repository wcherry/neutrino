'use client';

import React from 'react';
import { FileText } from 'lucide-react';
import { docsApi, storageApi } from '@/lib/api';
import { DocumentLibrary } from '../DocumentLibrary';

export default function DocsPage() {
  return (
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
    />
  );
}
