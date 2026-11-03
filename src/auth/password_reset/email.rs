//! The reset-link email and the notice sent once a password has been reset.
//! Pure, like `crate::auth::welcome::compose`.

use crate::auth::welcome::{escape, Content};

use super::service::RESET_TTL_MINUTES;

pub const RESET_SUBJECT: &str = "Reset your Neutrino password";
pub const CHANGED_SUBJECT: &str = "Your Neutrino password was changed";

/// `{base_url}/reset-password?token={token}`.
pub fn reset_url(base_url: &str, token: &str) -> String {
    format!("{}/reset-password?token={}", base_url.trim_end_matches('/'), token)
}

fn greeting(name: &str) -> String {
    match name.trim() {
        "" => "Hi,".to_string(),
        n => format!("Hi {n},"),
    }
}

/// The same card the welcome and invitation emails use: a greeting, a line, an
/// optional button, then small print.
pub(crate) fn card(greeting: &str, line: &str, action: Option<(&str, &str)>, small: &[&str]) -> String {
    let button = action
        .map(|(label, link)| {
            format!(
                r#"<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;background:#2f6feb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">{label}</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#656d76;line-height:1.5">Or paste this into your browser: {link}</p>
"#,
                link = escape(link),
                label = escape(label),
            )
        })
        .unwrap_or_default();
    let small: String = small
        .iter()
        .map(|s| {
            format!(
                r#"<p style="margin:0 0 8px;font-size:12px;color:#656d76;line-height:1.5">{}</p>
"#,
                escape(s)
            )
        })
        .collect();
    format!(
        r#"<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px">{greeting}</p>
<p style="margin:0 0 24px;line-height:1.5">{line}</p>
{button}{small}</div>
</body></html>
"#,
        greeting = escape(greeting),
        line = escape(line),
    )
}

/// The link that sets a new password, and when it stops working.
pub fn compose_reset(base_url: &str, name: &str, token: &str) -> Content {
    let greeting = greeting(name);
    let link = reset_url(base_url, token);
    let line = "Someone asked to reset the password for your Neutrino account. \
                If it was you, choose a new password with the link below.";
    let action = "Choose a new password";
    let expiry = format!(
        "The link works once and expires in {RESET_TTL_MINUTES} minutes. \
         If you didn't ask for this, you can ignore it: your password stays as it is."
    );
    let files = "Your encrypted files aren't affected by a new password.";

    let text = format!("{greeting}\n\n{line}\n\n{action}: {link}\n\n{expiry}\n\n{files}\n");
    let html = card(&greeting, line, Some((action, &link)), &[&expiry, files]);
    Content {
        subject: RESET_SUBJECT.to_string(),
        text,
        html,
    }
}

/// Tells the owner a reset went through, so one they didn't make doesn't go
/// unnoticed.
pub fn compose_changed(base_url: &str, name: &str) -> Content {
    let greeting = greeting(name);
    let line = "The password for your Neutrino account was just reset, \
                and every device signed in to it has been signed out.";
    let warning = "If you didn't do this, reset your password again straight away \
                   and tell your administrator.";
    let action = "Sign in";
    let link = format!("{}/sign-in", base_url.trim_end_matches('/'));

    let text = format!("{greeting}\n\n{line}\n\n{warning}\n\n{action}: {link}\n");
    let html = card(&greeting, line, Some((action, &link)), &[warning]);
    Content {
        subject: CHANGED_SUBJECT.to_string(),
        text,
        html,
    }
}
