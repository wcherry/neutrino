'use client';

import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

/**
 * The HTTP status behind a rejection, whichever name it goes by.
 * `ApiClientError` calls it `statusCode`; a plain `Response`-shaped error calls
 * it `status`. Anything else (a network failure, an abort) has no status at all.
 */
function httpStatusOf(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const { statusCode, status } = error as { statusCode?: unknown; status?: unknown };
  if (typeof statusCode === 'number') return statusCode;
  if (typeof status === 'number') return status;
  return undefined;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 1000 * 60, // 1 minute
            gcTime: 1000 * 60 * 5, // 5 minutes
            retry: (failureCount, error: unknown) => {
              // Don't retry on 4xx errors. The status is read off `statusCode`
              // first: that is what `ApiClientError` — the error every
              // `@neutrino/api-*` client throws — carries, and looking only for
              // `status` matched none of them. So every 4xx was retried twice
              // with backoff, including the 404 the docs editor probes with to
              // recognise a `.docx` (issue #141), which made opening one wait on
              // three round trips for an answer the first already gave.
              const status = httpStatusOf(error);
              if (status !== undefined && status < 500) return false;
              return failureCount < 2;
            },
          },
          mutations: {
            retry: false,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
