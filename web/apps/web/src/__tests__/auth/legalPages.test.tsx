/**
 * The Privacy Policy and Terms of Service: each renders its title, links to the other and gives
 * the contact address; the privacy policy carries the Google Limited Use statement that Google's
 * OAuth verification looks for.
 */
import { describe, it, expect } from 'vitest';
// Matcher types (toBeInTheDocument, …): the setup file loads them at runtime, but tsc never sees it.
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import PrivacyPage from '@/app/(public)/privacy/page';
import TermsPage from '@/app/(public)/terms/page';

describe('legal pages', () => {
  it('the privacy policy links to the terms and says how to reach us', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Terms of Service' })[0]).toHaveAttribute('href', '/terms');
    expect(screen.getAllByRole('link', { name: 'support@getneutrino.app' })[0]).toHaveAttribute(
      'href',
      'mailto:support@getneutrino.app',
    );
  });

  it('the privacy policy makes the Google API Limited Use disclosure', () => {
    render(<PrivacyPage />);
    expect(screen.getByRole('link', { name: 'Google API Services User Data Policy' })).toHaveAttribute(
      'href',
      'https://developers.google.com/terms/api-services-user-data-policy',
    );
    expect(document.body).toHaveTextContent('including the Limited Use requirements');
  });

  it('the terms link to the privacy policy', () => {
    render(<TermsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Terms of Service' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Privacy Policy' })[0]).toHaveAttribute('href', '/privacy');
  });
});
