import React from 'react';

export const ENCRYPTION_WARNING_MESSAGE: React.ReactNode = (
  <>
    Changes not saved — encryption key unavailable.{' '}
    {/* Account, not Advanced: the Encryption key panel — and the buttons that
        unlock or provision the key — live there. */}
    <a href="/settings?tab=security">Set up encryption</a>
  </>
);
