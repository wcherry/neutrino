'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function CalendarSettingsRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/settings?tab=calendar');
  }, [router]);
  return null;
}
