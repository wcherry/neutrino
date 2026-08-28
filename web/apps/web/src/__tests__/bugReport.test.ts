import { describe, it, expect } from 'vitest';
import { BUG_REPORT_URL } from '@/lib/bugReport';

describe('BUG_REPORT_URL', () => {
  it('opens the issue-type chooser', () => {
    const url = new URL(BUG_REPORT_URL);

    expect(url.origin + url.pathname).toBe('https://github.com/wcherry/neutrino/issues/new/choose');
  });

  it('carries no prefill, which would skip the chooser and the issue forms', () => {
    expect(new URL(BUG_REPORT_URL).search).toBe('');
  });
});
