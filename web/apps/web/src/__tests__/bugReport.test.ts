import { describe, it, expect } from 'vitest';
import { bugReportHref } from '@/lib/bugReport';

describe('bugReportHref', () => {
  it('prefills the issue with the report template and the page in question', () => {
    const url = new URL(bugReportHref('/docs/editor?id=doc-1'));

    expect(url.origin + url.pathname).toBe('https://github.com/wcherry/neutrino/issues/new');
    expect(url.searchParams.get('body')).toBe(
      [
        'Description:',
        '',
        'Steps:',
        '',
        'Expected Outcome:',
        '',
        'Actual Outcome:',
        '',
        'Page: /docs/editor?id=doc-1',
      ].join('\n')
    );
  });
});
