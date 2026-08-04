/**
 * "Report a bug" link for the topbar.
 *
 * GitHub prefills a new issue from query parameters, so the whole template can
 * be baked into the href — no issue-form YAML in the repo and nothing to keep
 * in sync. The page the reporter was on is the one detail they can't be
 * expected to remember accurately, so it is filled in for them.
 */
const ISSUES_NEW_URL = 'https://github.com/wcherry/neutrino/issues/new';

function issueBody(page: string): string {
  return [
    'Description:',
    '',
    'Steps:',
    '',
    'Expected Outcome:',
    '',
    'Actual Outcome:',
    '',
    `Page: ${page}`,
  ].join('\n');
}

/**
 * @param page Where the bug was seen — a path such as `/docs/editor?id=abc`.
 */
export function bugReportHref(page: string): string {
  const params = new URLSearchParams({ body: issueBody(page) });
  return `${ISSUES_NEW_URL}?${params.toString()}`;
}
