/**
 * "Report a bug" link for the topbar.
 *
 * Points at the new-issue chooser, not at a prefilled blank issue. The repo now
 * carries issue forms (`.github/ISSUE_TEMPLATE/`) with `blank_issues_enabled:
 * false`, so a `?body=` prefill is asking for the one thing the repo no longer
 * accepts: it skips the form that gathers the version, the install method and
 * the affected app, and skips the Security Vulnerability contact link that
 * exists to keep those reports out of public issues.
 *
 * That means the reporter picks a type and fills the form in themselves — the
 * page they were on included, which the prefill used to carry. A template
 * cannot be preselected without bypassing the chooser again, which is the
 * behaviour being removed.
 */
export const BUG_REPORT_URL = 'https://github.com/wcherry/neutrino/issues/new/choose';
