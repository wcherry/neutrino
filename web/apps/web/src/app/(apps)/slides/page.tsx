'use client';

import React from 'react';
import { Presentation } from 'lucide-react';
import { slidesApi, storageApi } from '@/lib/api';
import { DocumentLibrary } from '../DocumentLibrary';

export default function SlidesPage() {
  return (
    <DocumentLibrary
      title="Presentations"
      noun="presentation"
      typeText="Slides"
      icon={Presentation}
      iconColor="var(--color-rose, #e11d48)"
      editorPath="/slides/editor"
      queryKey="slides"
      previewKind="slide"
      fetchItems={async () => (await slidesApi.listSlides()).slides}
      createItem={() => slidesApi.createSlide({ title: 'Untitled presentation' })}
      renameItem={(id, title) => slidesApi.saveSlide(id, { title })}
      deleteItem={(id) => storageApi.deleteFile(id)}
    />
  );
}
