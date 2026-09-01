import { describe, expect, it } from 'vitest';
import { connectFailureMessage } from '@/app/(apps)/settings/connectErrors';

describe('connectFailureMessage', () => {
  /**
   * Issue #159: clicking Connect on an Outlook-less deployment showed nothing at
   * all. The server already says which variable is missing; the message has to
   * carry that through rather than flatten it to "something went wrong".
   */
  it('passes the server’s reason through', () => {
    const err = new Error('Outlook OAuth not configured (OUTLOOK_CLIENT_ID missing)');
    expect(connectFailureMessage('outlook', err)).toBe(
      'Could not connect Outlook / Microsoft 365: Outlook OAuth not configured (OUTLOOK_CLIENT_ID missing)',
    );
  });

  it('names the provider that failed', () => {
    expect(connectFailureMessage('google', new Error('boom'))).toBe(
      'Could not connect Google Calendar: boom',
    );
    expect(connectFailureMessage('apple', new Error('boom'))).toBe(
      'Could not connect Apple Calendar (iCloud): boom',
    );
  });

  it('still says something when the failure carries no message', () => {
    expect(connectFailureMessage('outlook', new Error('  '))).toBe(
      'Could not connect Outlook / Microsoft 365. Please try again.',
    );
    expect(connectFailureMessage('outlook', 'not an error')).toBe(
      'Could not connect Outlook / Microsoft 365. Please try again.',
    );
  });
});
