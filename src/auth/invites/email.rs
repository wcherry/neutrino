//! The invitation email. Pure, like `crate::auth::welcome::compose`.

use crate::auth::welcome::{escape, Content};

use super::service::INVITE_TTL_DAYS;

/// Subject names the inviter; text and HTML both carry the sign-up link, the
/// inviter's name, the note (escaped in HTML) and when the link stops working.
pub fn compose(base_url: &str, inviter_name: &str, note: Option<&str>, token: &str) -> Content {
    let inviter = match inviter_name.trim() {
        "" => "Someone",
        n => n,
    };
    let link = format!(
        "{}/register?invite={}",
        base_url.trim_end_matches('/'),
        token
    );
    let subject = format!("{inviter} invited you to Neutrino");
    let line = format!(
        "{inviter} invited you to Neutrino — files, documents and a calendar, encrypted end to end."
    );
    let expiry = format!(
        "The link works once and expires in {INVITE_TTL_DAYS} days. If you weren't expecting this, you can ignore it."
    );
    let action = "Accept the invitation";
    let note = note.map(str::trim).filter(|n| !n.is_empty());

    let mut text = format!("Hi,\n\n{line}\n\n");
    if let Some(note) = note {
        text.push_str(&format!("{inviter} wrote:\n\"{note}\"\n\n"));
    }
    text.push_str(&format!("{action}: {link}\n\n{expiry}\n"));

    let note_html = note
        .map(|n| {
            format!(
                r#"<blockquote style="margin:0 0 24px;padding:12px 16px;background:#f6f7f9;border-left:3px solid #2f6feb;border-radius:4px;line-height:1.5;white-space:pre-wrap">{}</blockquote>
"#,
                escape(n)
            )
        })
        .unwrap_or_default();
    let html = format!(
        r#"<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px">Hi,</p>
<p style="margin:0 0 24px;line-height:1.5">{line}</p>
{note_html}<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;background:#2f6feb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">{action}</a></p>
<p style="margin:0 0 8px;font-size:12px;color:#656d76;line-height:1.5">Or paste this into your browser: {link}</p>
<p style="margin:0;font-size:12px;color:#656d76;line-height:1.5">{expiry}</p>
</div>
</body></html>
"#,
        line = escape(&line),
        link = escape(&link),
        action = escape(action),
        expiry = escape(&expiry),
    );

    Content {
        subject,
        text,
        html,
    }
}
