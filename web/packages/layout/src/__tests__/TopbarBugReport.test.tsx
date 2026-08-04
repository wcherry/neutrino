import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Topbar } from '../Topbar';

describe('Topbar bug report', () => {
  it('opens the issue tracker in a new tab', () => {
    render(<Topbar bugReportHref="https://example.test/issues/new?body=Page%3A%20%2Fdrive" />);

    const link = screen.getByRole('link', { name: 'Report a bug' });
    expect(link).toHaveAttribute('href', 'https://example.test/issues/new?body=Page%3A%20%2Fdrive');
    expect(link).toHaveAttribute('target', '_blank');
    // Without this the opened tab could reach back through window.opener.
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('stays out of the way when no tracker is configured', () => {
    render(<Topbar />);

    expect(screen.queryByRole('link', { name: 'Report a bug' })).not.toBeInTheDocument();
  });
});
