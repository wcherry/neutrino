import React from 'react';

export const ENCRYPTION_WARNING_MESSAGE: React.ReactNode = (
  <>
    Changes not saved — encryption key unavailable.{' '}
    <a href="/settings?tab=advanced">Set up encryption</a>
  </>
);
