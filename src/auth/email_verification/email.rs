//! The verification email. Pure, like `crate::auth::welcome::compose`.

use crate::auth::password_reset::email::card;
use crate::auth::welcome::Content;

use super::service::VERIFY_TTL_DAYS;

pub const VERIFY_SUBJECT: &str = "Verify your email address for Neutrino";

/// `{base_url}/verify-email?token={token}`.
pub fn verify_url(base_url: &str, token: &str) -> String {
    format!("{}/verify-email?token={}", base_url.trim_end_matches('/'), token)
}

/// The link that proves the account owns `email`. `block_days` is how many
/// days are left before an unverified account stops signing in, when that is
/// enforced.
pub fn compose_verify(base_url: &str, name: &str, token: &str, block_days: Option<i64>) -> Content {
    let greeting = match name.trim() {
        "" => "Hi,".to_string(),
        n => format!("Hi {n},"),
    };
    let link = verify_url(base_url, token);
    let line = "Confirm this is your email address so Neutrino can reach you \
                about your account, and so you can share files and reset your password.";
    let action = "Verify email address";
    let expiry = format!(
        "The link works once and expires in {VERIFY_TTL_DAYS} days. \
         If you didn't create a Neutrino account, you can ignore this email."
    );
    let deadline = block_days.map(|days| match days {
        d if d <= 0 => "Until you verify, you won't be able to sign in.".to_string(),
        1 => "Verify within a day to keep signing in.".to_string(),
        d => format!("Verify within {d} days to keep signing in."),
    });

    let mut small: Vec<&str> = Vec::new();
    if let Some(d) = &deadline {
        small.push(d);
    }
    small.push(&expiry);
    let text = format!(
        "{greeting}\n\n{line}\n\n{action}: {link}\n\n{}\n",
        small.join("\n\n")
    );
    let html = card(&greeting, line, Some((action, &link)), &small);
    Content {
        subject: VERIFY_SUBJECT.to_string(),
        text,
        html,
    }
}
