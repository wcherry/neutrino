//! The email that goes with a notification.
//!
//! Only events that ask something of the recipient get one — something was
//! shared with them, they were mentioned, assigned or replied to. Losing access
//! is shown in the inbox but not mailed: there is nothing to click through to.
//!
//! Composing is pure, so the wording and the links are tested without a mailer
//! or a database; [`super::service::NotificationService`] fills in [`Context`].

/// What the service looked up to word the email.
pub struct Context<'a> {
    /// The deployment's public origin, e.g. `https://getneutrino.app`.
    pub base_url: &'a str,
    pub recipient_name: &'a str,
    /// Who did it, when the payload names them only by id.
    pub actor_name: Option<&'a str>,
    /// The file the event is about, when the payload names it only by id.
    pub file: Option<(&'a str, &'a str)>,
}

#[derive(Debug, PartialEq)]
pub struct Content {
    pub subject: String,
    pub text: String,
    pub html: String,
}

/// The id of the user whose name the email needs, if the payload does not
/// carry it.
pub fn actor_id(payload: &serde_json::Value) -> Option<&str> {
    if payload.get("actorName").is_some() {
        return None;
    }
    payload.get("sharedById").and_then(|v| v.as_str())
}

/// The id of the file whose name and type the email needs, if the payload does
/// not carry them.
pub fn file_id(payload: &serde_json::Value) -> Option<&str> {
    if payload.get("resourceName").is_some() {
        return None;
    }
    payload.get("fileId").and_then(|v| v.as_str())
}

pub fn compose(event_type: &str, payload: &serde_json::Value, ctx: &Context) -> Option<Content> {
    let str_of = |key: &str| payload.get(key).and_then(|v| v.as_str()).filter(|s| !s.is_empty());
    let actor = str_of("actorName")
        .or(ctx.actor_name)
        .filter(|s| !s.is_empty())
        .unwrap_or("Someone");
    let (name, mime) = match (str_of("resourceName"), ctx.file) {
        (Some(name), _) => (name, str_of("mimeType").unwrap_or("")),
        (None, Some((name, mime))) => (name, mime),
        (None, None) => ("a file", ""),
    };
    let is_folder = str_of("resourceType") == Some("folder");
    let id = str_of("resourceId").or(str_of("fileId"));
    let link = format!(
        "{}{}",
        ctx.base_url.trim_end_matches('/'),
        href(is_folder, id, mime)
    );

    let (subject, line, action) = match event_type {
        "file_shared" | "folder_shared" => {
            let kind = if is_folder { "folder" } else { "file" };
            let role = match str_of("role") {
                Some("editor") | Some("owner") => " and can edit it",
                Some("commenter") => " and can comment on it",
                _ => "",
            };
            (
                format!("{actor} shared “{name}” with you"),
                format!("{actor} shared the {kind} “{name}” with you{role}."),
                format!("Open {kind}"),
            )
        }
        "mention" => (
            format!("{actor} mentioned you on “{name}”"),
            format!("{actor} mentioned you in a comment on “{name}”."),
            "View comment".to_string(),
        ),
        "comment_reply" => (
            format!("{actor} replied to your comment on “{name}”"),
            format!("{actor} replied to your comment on “{name}”."),
            "View reply".to_string(),
        ),
        "action_item_assigned" => (
            format!("{actor} assigned you an action item on “{name}”"),
            format!("{actor} assigned you an action item in a comment on “{name}”."),
            "View action item".to_string(),
        ),
        _ => return None,
    };

    let greeting = if ctx.recipient_name.is_empty() {
        "Hi,".to_string()
    } else {
        format!("Hi {},", ctx.recipient_name)
    };
    let footer = "You are getting this because email notifications are on in \
                  Neutrino. Turn them off under Settings → Notifications.";
    let text = format!("{greeting}\n\n{line}\n\n{action}: {link}\n\n—\n{footer}\n");
    let html = format!(
        r#"<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px">{greeting}</p>
<p style="margin:0 0 24px;line-height:1.5">{line}</p>
<p style="margin:0 0 24px"><a href="{link}" style="display:inline-block;background:#2f6feb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">{action}</a></p>
<p style="margin:0;font-size:12px;color:#656d76;line-height:1.5">{footer}</p>
</div>
</body></html>
"#,
        greeting = escape(&greeting),
        line = escape(&line),
        link = escape(&link),
        action = escape(&action),
        footer = escape(footer),
    );
    Some(Content {
        subject,
        text,
        html,
    })
}

/// Where the web app opens the resource. Mirrors `notificationHref` in
/// `web/apps/web/src/app/(apps)/layout.tsx`, so the email and the inbox go to
/// the same place.
fn href(is_folder: bool, id: Option<&str>, mime: &str) -> String {
    let Some(id) = id else {
        return "/drive".into();
    };
    if is_folder {
        return "/drive".into();
    }
    let editor = if mime.contains("document") {
        "docs"
    } else if mime.contains("sheet") || mime.contains("spreadsheet") {
        "sheets"
    } else if mime.contains("slide") || mime.contains("presentation") {
        "slides"
    } else if mime.contains("diagram") {
        "diagrams"
    } else if mime.contains("drawing") {
        "drawing"
    } else {
        return "/drive".into();
    };
    format!("/{editor}/editor?id={}", url::form_urlencoded::byte_serialize(id.as_bytes()).collect::<String>())
}

fn escape(s: &str) -> String {
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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn ctx<'a>(actor: Option<&'a str>, file: Option<(&'a str, &'a str)>) -> Context<'a> {
        Context {
            base_url: "https://neutrino.test/",
            recipient_name: "Ada",
            actor_name: actor,
            file,
        }
    }

    #[test]
    fn a_shared_document_links_to_its_editor() {
        let payload = json!({
            "resourceType": "file",
            "resourceId": "f1",
            "resourceName": "Plan",
            "mimeType": "application/vnd.neutrino.document",
            "role": "editor",
            "sharedById": "u2",
        });
        assert_eq!(actor_id(&payload), Some("u2"));
        assert_eq!(file_id(&payload), None);
        let c = compose("file_shared", &payload, &ctx(Some("Grace"), None)).unwrap();
        assert_eq!(c.subject, "Grace shared “Plan” with you");
        assert!(c.text.contains("Hi Ada,"));
        assert!(c.text.contains("can edit it"));
        assert!(c.text.contains("https://neutrino.test/docs/editor?id=f1"), "{}", c.text);
    }

    #[test]
    fn a_shared_folder_opens_drive() {
        let payload = json!({
            "resourceType": "folder",
            "resourceId": "d1",
            "resourceName": "Photos",
            "role": "viewer",
        });
        let c = compose("folder_shared", &payload, &ctx(None, None)).unwrap();
        assert_eq!(c.subject, "Someone shared “Photos” with you");
        assert!(c.text.contains("the folder “Photos”"));
        assert!(c.text.contains("https://neutrino.test/drive\n"));
    }

    #[test]
    fn a_mention_names_the_file_it_looked_up() {
        let payload = json!({ "fileId": "f9", "actorName": "Grace", "commentId": "c1" });
        assert_eq!(actor_id(&payload), None);
        assert_eq!(file_id(&payload), Some("f9"));
        let c = compose(
            "mention",
            &payload,
            &ctx(None, Some(("Budget", "application/vnd.neutrino.sheet"))),
        )
        .unwrap();
        assert_eq!(c.subject, "Grace mentioned you on “Budget”");
        assert!(c.text.contains("/sheets/editor?id=f9"));
    }

    #[test]
    fn losing_access_is_not_mailed() {
        let payload = json!({ "resourceType": "file", "resourceId": "f1", "resourceName": "x" });
        assert!(compose("file_access_revoked", &payload, &ctx(None, None)).is_none());
        assert!(compose("folder_access_revoked", &payload, &ctx(None, None)).is_none());
    }

    #[test]
    fn names_are_escaped_in_html() {
        let payload = json!({
            "resourceType": "file",
            "resourceId": "f1",
            "resourceName": "<script>",
            "mimeType": "text/plain",
        });
        let c = compose("file_shared", &payload, &ctx(Some("A & B"), None)).unwrap();
        assert!(!c.html.contains("<script>"));
        assert!(c.html.contains("&lt;script&gt;"));
        assert!(c.html.contains("A &amp; B"));
    }
}
