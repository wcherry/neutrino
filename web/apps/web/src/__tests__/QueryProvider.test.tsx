import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useQueryClient } from '@tanstack/react-query';
import { QueryProvider } from '../providers/QueryProvider';

// ---------------------------------------------------------------------------
// QueryProvider
// ---------------------------------------------------------------------------

describe('QueryProvider', () => {
  it('renders its children', () => {
    render(
      <QueryProvider>
        <div data-testid="child">Hello</div>
      </QueryProvider>
    );
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  it('provides a QueryClient to children via context', () => {
    let capturedClient: ReturnType<typeof useQueryClient> | null = null;

    function Consumer() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <QueryProvider>
        <Consumer />
      </QueryProvider>
    );

    expect(capturedClient).not.toBeNull();
  });

  it('configures staleTime to 1 minute', () => {
    let capturedClient: ReturnType<typeof useQueryClient> | null = null;

    function Consumer() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <QueryProvider>
        <Consumer />
      </QueryProvider>
    );

    const defaults = capturedClient!.getDefaultOptions();
    expect(defaults.queries?.staleTime).toBe(1000 * 60);
  });

  it('disables mutation retries', () => {
    let capturedClient: ReturnType<typeof useQueryClient> | null = null;

    function Consumer() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <QueryProvider>
        <Consumer />
      </QueryProvider>
    );

    const defaults = capturedClient!.getDefaultOptions();
    expect(defaults.mutations?.retry).toBe(false);
  });

  it('does not retry on 4xx errors', () => {
    let capturedClient: ReturnType<typeof useQueryClient> | null = null;

    function Consumer() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <QueryProvider>
        <Consumer />
      </QueryProvider>
    );

    const retryFn = capturedClient!.getDefaultOptions().queries?.retry;
    if (typeof retryFn === 'function') {
      const clientError = Object.assign(new Error('Not Found'), { status: 404 });
      expect(retryFn(0, clientError)).toBe(false);
    } else {
      // If retry is not a function the test is not applicable
      expect(typeof retryFn).toBe('function');
    }
  });

  it('retries up to 2 times on 5xx errors', () => {
    let capturedClient: ReturnType<typeof useQueryClient> | null = null;

    function Consumer() {
      capturedClient = useQueryClient();
      return null;
    }

    render(
      <QueryProvider>
        <Consumer />
      </QueryProvider>
    );

    const retryFn = capturedClient!.getDefaultOptions().queries?.retry;
    if (typeof retryFn === 'function') {
      const serverError = new Error('Internal Server Error');
      expect(retryFn(0, serverError)).toBe(true);
      expect(retryFn(1, serverError)).toBe(true);
      expect(retryFn(2, serverError)).toBe(false);
    } else {
      expect(typeof retryFn).toBe('function');
    }
  });
});
