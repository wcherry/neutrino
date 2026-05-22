'use client';

import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { storageApi } from '@/lib/api';
import { VersionHistoryPanel as VersionHistoryPanelUI } from '@neutrino/ui';

interface VersionHistoryPanelProps {
  fileId: string;
  onRestore?: () => void;
  onClose: () => void;
}

export function VersionHistoryPanel({ fileId, onRestore, onClose }: VersionHistoryPanelProps) {
  const queryClient = useQueryClient();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['versions', fileId],
    queryFn: () => storageApi.listVersions(fileId),
    staleTime: 10_000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['versions', fileId] });

  return (
    <VersionHistoryPanelUI
      versions={data?.versions ?? []}
      isLoading={isLoading}
      isError={isError}
      onClose={onClose}
      onLabelVersion={async (versionId, label) => {
        await storageApi.labelVersion(fileId, versionId, label);
        invalidate();
      }}
      onRestoreVersion={async (versionId) => {
        await storageApi.restoreVersion(fileId, versionId);
        invalidate();
        onRestore?.();
      }}
    />
  );
}
