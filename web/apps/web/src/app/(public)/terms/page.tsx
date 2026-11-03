import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT_EMAIL, LegalPage } from '../_legal/LegalPage';

export const metadata: Metadata = {
  title: 'Terms of Service — Neutrino',
  description: 'The terms for using the hosted Neutrino service at getneutrino.app.',
};

/** The US state whose law governs these terms. */
const GOVERNING_STATE = 'California';

/** The terms of the hosted service. A self-hosted server is its operator's to set terms for. */
export default function TermsPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <LegalPage title="Terms of Service" sibling={{ href: '/privacy', label: 'Privacy Policy' }}>
      <p>
        These terms are an agreement between you and Neutrino (&ldquo;we&rdquo;, &ldquo;us&rdquo;)
        for your use of the hosted Neutrino service at getneutrino.app and its web, iOS, Android,
        macOS and Windows apps (the &ldquo;Service&rdquo;). By creating an account or using the
        Service, you agree to these terms and to our <Link href="/privacy">Privacy Policy</Link>.
        If you do not agree, do not use the Service.
      </p>
      <p>
        Neutrino&apos;s source code is available under the MIT License, which governs your use of
        the code itself. These terms govern only the hosted Service we run. A Neutrino server run by
        someone else is subject to that operator&apos;s terms, not these.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>You must be at least 13 years old, and old enough to agree to these terms where you live.</li>
        <li>Give accurate information when you sign up, and keep your password secure.</li>
        <li>You are responsible for what happens under your account.</li>
        <li>Tell us at {mail} if you think someone else has used your account.</li>
      </ul>

      <h2>Your content and your encryption key</h2>
      <p>
        You own the files and other content you put in the Service. You give us permission to
        store, copy, transmit and display it only as needed to provide the Service to you and to the
        people you share it with. We claim no other rights to it.
      </p>
      <p>
        Most of your content is end-to-end encrypted with a key that only you hold. <strong>If you
        lose every copy of your encryption key, we cannot recover your encrypted content.</strong>{' '}
        Keep the key file or recovery method the app gives you somewhere safe, and keep your own
        backups of anything you cannot afford to lose.
      </p>
      <p>
        You are responsible for having the right to store and share the content you upload.
      </p>

      <h2>Acceptable use</h2>
      <p>Do not use the Service to:</p>
      <ul>
        <li>break the law, or help anyone else do so;</li>
        <li>store or share content that infringes anyone&apos;s intellectual property or privacy rights;</li>
        <li>store or share child sexual abuse material, which we will report to the authorities;</li>
        <li>send spam, malware or phishing, or harass or threaten anyone;</li>
        <li>
          access accounts or data that are not yours, probe or break our security, or disrupt the
          Service for others, for example by overloading it;
        </li>
        <li>get around storage limits, upload caps or other restrictions we set.</li>
      </ul>
      <p>
        Because most content is encrypted, we generally cannot see it. We may act on reports,
        on what we can see, such as sharing activity and file sizes, and on legal requests.
      </p>

      <h2>Storage and limits</h2>
      <p>
        Accounts have storage quotas and upload limits, which we may change. If your account goes
        over its quota, existing files stay where they are, but you may not be able to add more
        until you free up space.
      </p>

      <h2>Third-party services</h2>
      <p>
        Some features connect to services we do not run: Google, Microsoft and Apple calendars, the
        AI provider whose API key you supply, maps, and dictionaries. Your use of those services is
        governed by their own terms, and we are not responsible for them. AI output can be wrong;
        check it before relying on it.
      </p>

      <h2>Changes to the Service</h2>
      <p>
        We are continually changing the Service. We may add or remove features, and we may suspend
        or end the Service. If we plan to shut the Service down, we will give you at least 30
        days&apos; notice so you can download your content.
      </p>

      <h2>Suspension and termination</h2>
      <p>
        You can stop using the Service and delete your account at any time in Settings. We may
        suspend or close your account if you break these terms, if the law requires it, or to
        protect the Service or other users. Where we reasonably can, we will tell you why and give
        you a chance to download your content first.
      </p>

      <h2>Disclaimer</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE&rdquo;, WITHOUT
        WARRANTIES OF ANY KIND, WHETHER EXPRESS OR IMPLIED, INCLUDING WARRANTIES OF
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. WE DO NOT PROMISE
        THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE OR SECURE, OR THAT YOUR CONTENT WILL NOT
        BE LOST.
      </p>

      <h2>Limitation of liability</h2>
      <p>
        TO THE FULLEST EXTENT THE LAW ALLOWS, WE ARE NOT LIABLE FOR ANY INDIRECT, INCIDENTAL,
        SPECIAL, CONSEQUENTIAL OR PUNITIVE DAMAGES, OR FOR ANY LOSS OF DATA, PROFITS OR REVENUE,
        ARISING FROM YOUR USE OF THE SERVICE. OUR TOTAL LIABILITY FOR ANY CLAIM RELATING TO THE
        SERVICE IS LIMITED TO THE GREATER OF THE AMOUNT YOU PAID US FOR THE SERVICE IN THE 12
        MONTHS BEFORE THE CLAIM AND US$50. Some places do not allow these limits, so they may not
        apply to you.
      </p>

      <h2>Indemnity</h2>
      <p>
        If someone brings a claim against us because of content you uploaded or your breach of
        these terms, you agree to cover our reasonable costs of dealing with it, to the extent the
        law allows.
      </p>

      <h2>Governing law</h2>
      <p>
        These terms are governed by the laws of the State of {GOVERNING_STATE} and of the United
        States, without regard to conflict-of-law rules. This does not take away any protection
        the law of the place you live gives you as a consumer.
      </p>

      <h2>Changes to these terms</h2>
      <p>
        We may update these terms. We will post changes on this page and update the effective
        date, and tell you by email or in the app before a significant change takes effect. If you
        keep using the Service after a change takes effect, you accept the new terms.
      </p>

      <h2>General</h2>
      <p>
        If any part of these terms cannot be enforced, the rest still applies. If we do not enforce
        a term right away, we have not given up the right to enforce it later. These terms and the
        Privacy Policy are the whole agreement between you and us about the Service.
      </p>

      <h2>Contact</h2>
      <p>Questions about these terms: {mail}.</p>
    </LegalPage>
  );
}
