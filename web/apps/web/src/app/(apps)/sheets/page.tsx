'use client';

import React from 'react';
import { Table2 } from 'lucide-react';
import { sheetsApi, storageApi } from '@/lib/api';
import { DocumentLibrary } from '../DocumentLibrary';

export default function SheetsPage() {
  return (
    <DocumentLibrary
      title="Spreadsheets"
      noun="spreadsheet"
      typeText="Sheet"
      icon={Table2}
      iconColor="var(--color-green, #16a34a)"
      editorPath="/sheets/editor"
      queryKey="sheets"
      previewKind="sheet"
      fetchItems={async () => (await sheetsApi.listSheets()).sheets}
      createItem={() => sheetsApi.createSheet({ title: 'Untitled spreadsheet' })}
      renameItem={(id, title) => sheetsApi.saveSheet(id, { title })}
      deleteItem={(id) => storageApi.deleteFile(id)}
    />
  );
}
