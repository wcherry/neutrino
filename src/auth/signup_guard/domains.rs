//! Address checks at sign-up: shape, and throwaway-mail domains.

/// Widely used disposable / throwaway mail providers. Not exhaustive by
/// design: the point is to make the easy option for a script cost something.
/// Operators add whatever the current attack uses with
/// `SIGNUP_BLOCKED_EMAIL_DOMAINS`, without a release.
const DISPOSABLE_DOMAINS: &[&str] = &[
    "10minutemail.com", "10minutemail.net", "20minutemail.com", "33mail.com",
    "anonaddy.me", "burnermail.io", "byom.de", "discard.email", "dispostable.com",
    "dropmail.me", "emailondeck.com", "fakeinbox.com", "fakemail.net", "getairmail.com",
    "getnada.com", "guerrillamail.biz", "guerrillamail.com", "guerrillamail.de",
    "guerrillamail.info", "guerrillamail.net", "guerrillamail.org", "guerrillamailblock.com",
    "grr.la", "harakirimail.com", "inboxbear.com", "incognitomail.org", "jetable.org",
    "mail-temp.com", "mail.tm", "mailcatch.com", "maildrop.cc", "mailinator.com",
    "mailinator.net", "mailinator2.com", "mailnesia.com", "mailpoof.com", "mailsac.com",
    "mintemail.com", "moakt.com", "mohmal.com", "mytemp.email", "nada.email",
    "sharklasers.com", "spam4.me", "spamgourmet.com", "temp-mail.io", "temp-mail.org",
    "tempail.com", "tempinbox.com", "tempmail.com", "tempmail.dev", "tempmail.net",
    "tempmailo.com", "tempr.email", "throwawaymail.com", "tmail.ws", "tmpmail.net",
    "tmpmail.org", "trashmail.com", "trashmail.de", "trashmail.net", "yopmail.com",
    "yopmail.fr", "yopmail.net", "emailfake.com", "fakemailgenerator.com", "luxusmail.org",
    "cyclelove.cc", "1secmail.com", "1secmail.net", "1secmail.org", "esiix.com",
    "wwjmp.com", "xojxe.com", "yoggm.com", "laafd.com", "txcct.com", "vjuum.com",
];

/// The part after `@`, lowercased; `None` unless the address looks like one:
/// one `@`, something either side, a dotted domain, no whitespace.
pub fn email_domain(email: &str) -> Option<String> {
    let email = email.trim();
    if email.is_empty() || email.len() > 254 || email.chars().any(char::is_whitespace) {
        return None;
    }
    let (local, domain) = email.split_once('@')?;
    let domain = domain.to_ascii_lowercase();
    let ok = !local.is_empty()
        && local.len() <= 64
        && !domain.contains('@')
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !domain.contains("..");
    ok.then_some(domain)
}

/// Whether `domain` (or a parent of it) is a throwaway provider or listed in
/// `extra`.
pub fn is_blocked(domain: &str, extra: &[String]) -> bool {
    let matches = |blocked: &str| domain == blocked || domain.ends_with(&format!(".{blocked}"));
    DISPOSABLE_DOMAINS.iter().any(|d| matches(d)) || extra.iter().any(|d| matches(d))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shapes() {
        assert_eq!(email_domain("Ann@Example.COM").as_deref(), Some("example.com"));
        for bad in ["", "ann", "ann@", "@x.com", "ann@x", "a b@x.com", "a@b@x.com", "a@.x.com", "a@x..com"] {
            assert_eq!(email_domain(bad), None, "{bad}");
        }
    }

    #[test]
    fn blocks_listed_domains_and_their_subdomains_only() {
        assert!(is_blocked("mailinator.com", &[]));
        assert!(is_blocked("eu.mailinator.com", &[]));
        assert!(!is_blocked("notmailinator.com", &[]));
        assert!(!is_blocked("gmail.com", &[]));
        assert!(is_blocked("spam.example", &["spam.example".into()]));
    }
}
