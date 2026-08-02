'use client';

import React from 'react';
import { Paintbrush } from 'lucide-react';
import { drawingApi, storageApi } from '@/lib/api';
import { DocumentLibrary } from '../DocumentLibrary';

export default function DrawingsPage() {
  return (
    <DocumentLibrary
      title="Drawings"
      noun="drawing"
      typeText="Drawing"
      icon={Paintbrush}
      iconColor="var(--color-cyan, #0891b2)"
      editorPath="/drawing/editor"
      queryKey="drawings"
      // The preview modal has no drawing renderer, so the menu omits Preview.
      fetchItems={async () => (await drawingApi.listDrawings()).drawings}
      createItem={() => drawingApi.createDrawing({ title: 'Untitled drawing' })}
      renameItem={(id, title) => drawingApi.saveDrawing(id, { title })}
      deleteItem={(id) => storageApi.deleteFile(id)}
    />
  );
}
