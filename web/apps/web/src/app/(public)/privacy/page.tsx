import type { Metadata } from 'next';
import Link from 'next/link';
import { CONTACT_EMAIL, LegalPage } from '../_legal/LegalPage';

export const metadata: Metadata = {
  title: 'Privacy Policy — Neutrino',
  description:
    'What the hosted Neutrino service at getneutrino.app collects, what end-to-end encryption keeps from us, and the choices you have.',
};

/**
 * The privacy policy of the hosted service. Every statement here describes what the code does; a
 * change to what is collected, encrypted or sent to a third party must change this page too, and
 * `EFFECTIVE_DATE` with it.
 */
export default function PrivacyPage() {
  const mail = <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>;
  return (
    <LegalPage title="Privacy Policy" sibling={{ href: '/terms', label: 'Terms of Service' }}>
      <p>
        This policy explains what information Neutrino (&ldquo;we&rdquo;, &ldquo;us&rdquo;)
        collects when you use the hosted Neutrino service at getneutrino.app and its web, iOS,
        Android, macOS and Windows apps (the &ldquo;Service&rdquo;), how we use it, and the choices
        you have.
      </p>
      <p>
        Neutrino is open-source software that anyone can run on their own server. If you use a
        Neutrino server run by someone else, such as your employer, that server&apos;s operator is
        responsible for your information and this policy does not apply to it.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>
          Your files, documents, spreadsheets, presentations, notes, drawings, diagrams and photos
          are end-to-end encrypted on your device. We store them but cannot read them.
        </li>
        <li>Some information is not end-to-end encrypted; it is listed below.</li>
        <li>We do not sell your information, show ads, or use analytics or tracking tools.</li>
        <li>You can delete your account at any time.</li>
      </ul>

      <h2>End-to-end encryption</h2>
      <p>
        Content you store in Drive, Docs, Sheets, Slides, Notes, Drawing, Diagrams and Photos is
        encrypted on your device with a key that only you hold, before it reaches our servers. We
        cannot decrypt it, and neither can anyone who obtains a copy of our servers. This also
        means we cannot recover that content for you if you lose every copy of your encryption
        key.
      </p>
      <p>Even with end-to-end encryption, our servers can see:</p>
      <ul>
        <li>file and folder sizes, types, and when they were created, changed and opened;</li>
        <li>
          file and folder names and how your folders are arranged, where the app stores them
          unencrypted;
        </li>
        <li>who you share files and folders with, and their access level;</li>
        <li>
          the capture date of your photos and other details your device reads from a photo before
          encrypting it, which the Photos app uses to sort and group your library;
        </li>
        <li>how much storage you use.</li>
      </ul>

      <h2>Information we collect</h2>

      <h3>Account information</h3>
      <p>
        Your email address, name and password when you create an account. We store your password
        only as an Argon2 hash. You can also add profile details such as a photo, bio, website,
        locale and social links. Your public encryption key is stored so others can share files
        with you. Your private key is created and kept on your own devices and is not sent to us;
        accounts set up with an earlier version of the app may still have a copy stored with us,
        encrypted with a passphrase only you know, until it is removed.
      </p>

      <h3>Information that is not end-to-end encrypted</h3>
      <p>
        The following are stored on our servers in a form we can read, because the Service needs
        to process them:
      </p>
      <ul>
        <li>calendar events, reminders and tasks (saved places for location reminders are encrypted);</li>
        <li>comments on files and documents;</li>
        <li>team names, team membership and team activity;</li>
        <li>your settings and preferences.</li>
      </ul>

      <h3>Connected calendar accounts</h3>
      <p>
        If you connect a Google, Microsoft Outlook or Apple iCloud calendar, we store the access
        credentials that let the Service read and update that calendar for you: an OAuth token
        for Google and Microsoft, or the app-specific password you enter for Apple. We copy your
        events into your Neutrino calendar and refresh them periodically while the account is
        connected. Disconnecting the account in Settings deletes the stored credentials.
      </p>
      <p>
        Neutrino&apos;s use and transfer of information received from Google APIs adheres to the{' '}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noopener noreferrer">
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We use Google Calendar data only to show and sync
        your calendar in Neutrino. We do not use it for advertising, do not sell it, and do not let
        people read it except with your permission, for security, or where the law requires.
      </p>

      <h3>Usage and device information</h3>
      <p>
        Our servers keep logs of requests made to them, including your IP address, browser or app
        version, the address requested, and the time. We use these logs to run, secure and debug
        the Service.
      </p>

      <h3>Information stored on your device</h3>
      <p>
        We use your browser&apos;s local storage, not cookies, to keep you signed in and to
        remember preferences on that device. If you use AI features, the API key you provide is
        stored on your device, not on our servers.
      </p>

      <h2>How we use information</h2>
      <ul>
        <li>to provide the Service: store and sync your content, and share it with the people you choose;</li>
        <li>to send emails you need, such as account confirmations, invitations and password resets;</li>
        <li>to keep the Service and its users secure, and to prevent abuse;</li>
        <li>to diagnose problems and improve the Service;</li>
        <li>to comply with the law.</li>
      </ul>

      <h2>Services we use and where your information goes</h2>
      <ul>
        <li>
          <strong>Hosting.</strong> Our servers and the data on them are run by a hosting provider
          on our behalf.
        </li>
        <li>
          <strong>Email.</strong> Account and invitation emails are sent through Resend, which
          receives the recipient&apos;s address and the message.
        </li>
        <li>
          <strong>Calendar providers.</strong> When you connect Google, Microsoft or Apple, we
          exchange calendar data with them on your behalf.
        </li>
        <li>
          <strong>AI providers.</strong> AI features use the provider and API key you choose in
          Settings (Anthropic, OpenAI or Google). The text or images you send to an AI feature
          pass through our server to that provider and are handled under your agreement with
          them.
        </li>
        <li>
          <strong>Maps and place search.</strong> Maps load tiles from OpenStreetMap, and searching
          for a place sends your search to OpenStreetMap&apos;s Nominatim service, directly from
          your device.
        </li>
        <li>
          <strong>Dictionary and thesaurus.</strong> Looking up a word in Docs sends that word to
          dictionaryapi.dev or Datamuse, directly from your device.
        </li>
        <li>
          <strong>Content you embed.</strong> Videos you embed from YouTube, Vimeo or Loom, and
          images you link from other websites, load from those sites.
        </li>
        <li>
          <strong>Software libraries.</strong> Some features load code or shape libraries from
          unpkg.com and GitHub, which see your IP address when they do.
        </li>
      </ul>
      <p>
        We may also disclose information if the law requires it, to protect the rights and safety
        of our users or the public, or as part of a merger or sale of the Service, in which case
        this policy will continue to apply to your information. End-to-end encrypted content stays
        unreadable to us and anyone we disclose it to.
      </p>

      <h2>Retention and deletion</h2>
      <p>
        We keep your information while your account exists. You can delete your account from
        Settings. Your account is closed at once and can be restored for 30 days, after which your
        files and the rest of your account&apos;s data are permanently erased. Server logs are kept
        for a limited period for security and debugging, and copies in backups may persist for a
        limited time before they are overwritten.
      </p>

      <h2>Your choices and rights</h2>
      <ul>
        <li>You can view and change your account and profile details in the app.</li>
        <li>You can download your files at any time.</li>
        <li>You can disconnect calendar accounts and delete your account in Settings.</li>
        <li>
          Depending on where you live, you may have the right to access, correct, delete or move
          your information, or to object to how we use it. Email {mail} and we will respond within
          30 days.
        </li>
      </ul>

      <h2>Security</h2>
      <p>
        Besides end-to-end encryption, we use encrypted connections (HTTPS) between your device and
        our servers and limit who can access our systems. No service is perfectly secure, so please
        keep your password and encryption key safe.
      </p>

      <h2>Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not knowingly collect
        information from them. If you believe a child under 13 has an account, contact us and we
        will delete it.
      </p>

      <h2>International users</h2>
      <p>
        We operate the Service from the United States. If you use it from elsewhere, your
        information will be transferred to and processed in the United States.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We will post any changes on this page and update the effective date. If a change is
        significant, we will tell you by email or in the app before it takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Questions or requests about this policy: {mail}. See also our{' '}
        <Link href="/terms">Terms of Service</Link>.
      </p>
    </LegalPage>
  );
}
