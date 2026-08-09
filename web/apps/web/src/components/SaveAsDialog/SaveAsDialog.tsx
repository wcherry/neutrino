'use client';

import React, { useState, useEffect } from 'react';
import { SaveAsDialog as SaveAsDialogUI, type SaveAsOptions, type SaveAsBreadcrumb, type SaveAsDriveFolder } from '@neutrino/ui';
import { filesystemApi, useUser } from '@/lib/api';

export type { SaveAsOptions };

interface SaveAsDialogProps {
  defaultFilename: string;
  format: string;
  onSave: (opts: SaveAsOptions) => Promise<void>;
  onClose: () => void;
}

export function SaveAsDialog({ defaultFilename, format, onSave, onClose }: SaveAsDialogProps) {
  const currentUser = useUser();
  const [breadcrumbs, setBreadcrumbs] = useState<SaveAsBreadcrumb[]>([{ id: null, name: 'My Drive' }]);
  const [folders, setFolders] = useState<SaveAsDriveFolder[]>([]);
  const [loading, setLoading] = useState(false);
  const [fetchError, setFetchError] = useState(false);

  const currentFolderId = breadcrumbs[breadcrumbs.length - 1]?.id ?? null;

  // Fetch whenever the browsed folder changes. The dialog is only mounted when open,
  // so this also covers the initial load for the Drive tab.
  useEffect(() => {
    if (!currentFolderId && !currentUser) return;
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    filesystemApi.getFolderContents(currentFolderId ?? currentUser!.id)
      .then(data => { if (!cancelled) { setFolders(data.folders); setLoading(false); } })
      .catch(() => { if (!cancelled) { setFetchError(true); setLoading(false); } });
    return () => { cancelled = true; };
  }, [currentFolderId, currentUser]);

  function handleFolderClick(folder: SaveAsDriveFolder) {
    setBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }]);
  }

  function handleBreadcrumbClick(entry: SaveAsBreadcrumb, index: number) {
    if (index === breadcrumbs.length - 1) return;
    setBreadcrumbs(prev => prev.slice(0, index + 1));
  }

  return (
    <SaveAsDialogUI
      defaultFilename={defaultFilename}
      format={format}
      onSave={onSave}
      onClose={onClose}
      driveBreadcrumbs={breadcrumbs}
      driveFolders={folders}
      driveFolderLoading={loading}
      driveFolderError={fetchError}
      onDriveFolderClick={handleFolderClick}
      onDriveBreadcrumbClick={handleBreadcrumbClick}
    />
  );
}
