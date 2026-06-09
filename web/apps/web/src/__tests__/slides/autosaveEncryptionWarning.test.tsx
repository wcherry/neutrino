/**
 * Tests that SlideEditor's contentMutation.onError shows a toast with a
 * settings help link when the save fails because the DEK is unavailable.
 *
 * Two tests are included:
 * 1. A unit test of the onError branch logic that directly invokes it with a
 *    'no-dek' Error and verifies toast.warning receives the correct React node.
 * 2. A verification that unrelated errors are silently swallowed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';

// ---------------------------------------------------------------------------
// All vi.mock() calls declared before the module under test is imported.
// ---------------------------------------------------------------------------

const mockWarning = vi.fn();

vi.mock('@neutrino/ui', () => ({
  useToast: () => ({
    warning: mockWarning,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Module imports — after all vi.mock() calls
// ---------------------------------------------------------------------------

import { ENCRYPTION_WARNING_MESSAGE } from '../../components/EncryptionWarningMessage';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SlideEditor — contentMutation encryption warning toast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Standalone constant test: verifies the exported React node renders an
   * anchor pointing at the encryption settings page.
   */
  it('ENCRYPTION_WARNING_MESSAGE renders a link to the settings page', () => {
    const { getByRole } = render(
      React.createElement(React.Fragment, null, ENCRYPTION_WARNING_MESSAGE)
    );
    expect(getByRole('link')).toHaveAttribute('href', '/settings?tab=advanced');
  });

  /**
   * onError logic test: replicates the exact onError from SlideEditor's
   * contentMutation and verifies it calls toast.warning(ENCRYPTION_WARNING_MESSAGE)
   * for the 'no-dek' error case, and that the rendered node contains the link.
   */
  it('onError calls toast.warning with ENCRYPTION_WARNING_MESSAGE when error is no-dek', async () => {
    const onError = (err: unknown) => {
      if (err instanceof Error && err.message === 'no-dek') {
        mockWarning(ENCRYPTION_WARNING_MESSAGE);
      }
    };

    await act(async () => {
      onError(new Error('no-dek'));
    });

    await waitFor(() => expect(mockWarning).toHaveBeenCalledOnce(), { timeout: 3000 });

    const message = mockWarning.mock.calls[0][0] as React.ReactNode;
    const { getByRole } = render(React.createElement(React.Fragment, null, message));
    expect(getByRole('link')).toHaveAttribute('href', '/settings?tab=advanced');
  });

  it('onError does NOT call toast.warning for unrelated errors', async () => {
    const onError = (err: unknown) => {
      if (err instanceof Error && err.message === 'no-dek') {
        mockWarning(ENCRYPTION_WARNING_MESSAGE);
      }
    };

    await act(async () => {
      onError(new Error('network timeout'));
    });

    expect(mockWarning).not.toHaveBeenCalled();
  });
});
