//! The welcome email every new account gets, once.
//!
//! It walks through the same setup steps as the welcome wizard, each a link
//! into the web app. Only the account-creation paths send it (see
//! [`crate::auth::signup::SignupService`]), so existing users never get one.
//! Composing is pure, like `drive::notifications::email`.

use std::sync::Arc;

use crate::shared::mail::{MailError, Mailer, Message};

/// A composed email.
#[derive(Debug, Clone, PartialEq)]
pub struct Content {
    pub subject: String,
    pub text: String,
    pub html: String,
}

pub const WELCOME_SUBJECT: &str = "Welcome to Neutrino";

/// One setup step: a title, a line of copy, and where it links (path and label).
struct Step {
    title: &'static str,
    line: &'static str,
    links: &'static [(&'static str, &'static str)],
}

const STEPS: &[Step] = &[
    Step {
        title: "Make it look like yours",
        line: "Pick a look and a light or dark theme.",
        links: &[("/settings?tab=appearance", "Choose a look")],
    },
    Step {
        title: "Fill in your profile",
        line: "Add a photo and a few details so people know who they're sharing with.",
        links: &[("/profile", "Edit your profile")],
    },
    Step {
        title: "Set up the AI assistant",
        line: "Add your AI provider's key and the assistant can help you write, summarise and search.",
        links: &[("/settings?tab=ai", "AI settings")],
    },
    Step {
        title: "Get your calendar going",
        line: "Add calendars and connect the ones you already use.",
        links: &[("/calendar", "Open Calendar")],
    },
    Step {
        title: "Bring your files",
        line: "Upload what you have, or import a Google Takeout archive in one go.",
        links: &[
            ("/drive", "Open Drive"),
            ("/import", "Import from Google Takeout"),
        ],
    },
    Step {
        title: "Invite friends",
        line: "Neutrino is better with the people you work and share with.",
        links: &[("/invite", "Invite friends")],
    },
];

const FOOTER: &str = "You're getting this because you just created a Neutrino account.";

/// Pure. Subject "Welcome to Neutrino"; text and HTML both carry every setup
/// link, absolute from `base_url` (trailing slash trimmed).
pub fn compose(base_url: &str, name: &str) -> Content {
    let base = base_url.trim_end_matches('/');
    let name = name.trim();
    let greeting = if name.is_empty() {
        "Hi,".to_string()
    } else {
        format!("Hi {name},")
    };
    let intro = "Welcome to Neutrino — your files, documents and calendar, encrypted end to end. \
                 Here are a few things to get you set up, whenever suits you.";

    let mut text = format!("{greeting}\n\n{intro}\n\n");
    let mut items = String::new();
    for (i, step) in STEPS.iter().enumerate() {
        text.push_str(&format!("{}. {}\n   {}\n", i + 1, step.title, step.line));
        let mut anchors = Vec::new();
        for (path, label) in step.links {
            let url = format!("{base}{path}");
            text.push_str(&format!("   {label}: {url}\n"));
            anchors.push(format!(
                r#"<a href="{url}" style="color:#2f6feb;text-decoration:none;font-weight:600">{label}</a>"#,
                url = escape(&url),
                label = escape(label),
            ));
        }
        text.push('\n');
        items.push_str(&format!(
            r#"<li style="margin:0 0 16px;line-height:1.5"><strong>{title}</strong><br>{line}<br>{links}</li>
"#,
            title = escape(step.title),
            line = escape(step.line),
            links = anchors.join(" · "),
        ));
    }
    text.push_str(&format!("Enjoy,\nNeutrino\n\n—\n{FOOTER}\n"));

    let html = format!(
        r#"<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px">{greeting}</p>
<p style="margin:0 0 24px;line-height:1.5">{intro}</p>
<ol style="margin:0 0 24px;padding-left:20px">
{items}</ol>
<p style="margin:0 0 24px">Enjoy,<br>Neutrino</p>
<p style="margin:0;font-size:12px;color:#656d76;line-height:1.5">{footer}</p>
</div>
</body></html>
"#,
        greeting = escape(&greeting),
        intro = escape(intro),
        footer = escape(FOOTER),
    );

    Content {
        subject: WELCOME_SUBJECT.to_string(),
        text,
        html,
    }
}

/// HTML-escapes text for an element body or a quoted attribute.
pub(crate) fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            _ => out.push(c),
        }
    }
    out
}

/// Sends the welcome email.
#[derive(Clone)]
pub struct WelcomeMailer {
    mailer: Arc<Mailer>,
    base_url: String,
}

impl WelcomeMailer {
    pub fn new(mailer: Arc<Mailer>, base_url: String) -> Self {
        WelcomeMailer { mailer, base_url }
    }

    /// Compose and send, awaited.
    pub async fn send(&self, email: &str, name: &str) -> Result<(), MailError> {
        let content = compose(&self.base_url, name);
        self.mailer
            .send(Message {
                to: email.to_string(),
                subject: content.subject,
                body: content.text,
                html: Some(content.html),
                headers: Vec::new(),
            })
            .await
    }

    /// Send on a spawned task, so a slow mail provider never holds up sign-up;
    /// a failure is logged.
    pub fn send_later(&self, email: String, name: String) {
        let this = self.clone();
        tokio::spawn(async move {
            if let Err(e) = this.send(&email, &name).await {
                tracing::error!(to = %email, "could not send the welcome email: {}", e);
            }
        });
    }
}
