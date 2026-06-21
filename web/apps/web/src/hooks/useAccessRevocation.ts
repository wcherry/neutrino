'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@neutrino/ui';

interface RevokedDetail {
  resourceId: string;
  resourceType: string;
  resourceName?: string;
}

/**
 * Listens for access-revocation events emitted by useNotifications and
 * redirects the user to /drive with a toast if the current file's access
 * was revoked while they were viewing or editing it.
 */
export function useAccessRevocation(fileId: string) {
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    if (!fileId) return;

    const handler = (e: Event) => {
      const { resourceId, resourceName } = (e as CustomEvent<RevokedDetail>).detail;
      if (resourceId !== fileId) return;
      const label = resourceName ? `"${resourceName}"` : 'this file';
      toast.error(`Your access to ${label} has been revoked`);
      router.push('/drive');
    };

    window.addEventListener('neutrino:access-revoked', handler);
    return () => window.removeEventListener('neutrino:access-revoked', handler);
  }, [fileId, router, toast]);
}
