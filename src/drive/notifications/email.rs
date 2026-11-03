//! The email that goes with a notification.
//!
//! Events that ask something of the recipient or change what they can open get
//! one: something was shared with them or taken away, someone asked them for
//! access or answered their request, they were mentioned, assigned or replied
//! to.
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
    payload
        .get("sharedById")
        .or_else(|| payload.get("revokedById"))
        .and_then(|v| v.as_str())
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

    let kind = if is_folder { "folder" } else { "file" };
    let drive = format!("{}/drive", ctx.base_url.trim_end_matches('/'));
    let mut link = link;
    let (subject, line, action) = match event_type {
        "file_shared" | "folder_shared" => {
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
        "access_requested" => {
            let who = match str_of("requesterEmail") {
                Some(email) => format!("{actor} ({email})"),
                None => actor.to_string(),
            };
            let role = role_verb(str_of("role"));
            let message = str_of("message")
                .map(|m| format!(" Their message: “{m}”"))
                .unwrap_or_default();
            link = format!("{}/drive/requests", ctx.base_url.trim_end_matches('/'));
            (
                format!("{actor} is asking for access to “{name}”"),
                format!("{who} asked to {role} the {kind} “{name}”.{message}"),
                "Review request".to_string(),
            )
        }
        "access_request_approved" => (
            format!("{actor} gave you access to “{name}”"),
            format!(
                "{actor} approved your request: you can now {} the {kind} “{name}”.",
                role_verb(str_of("role"))
            ),
            format!("Open {kind}"),
        ),
        "access_request_denied" => {
            link = drive.clone();
            (
                format!("Your request for “{name}” was declined"),
                format!("{actor} declined your request for access to the {kind} “{name}”."),
                "Open Drive".to_string(),
            )
        }
        "file_access_revoked" | "folder_access_revoked" => {
            link = drive.clone();
            (
                format!("{actor} removed your access to “{name}”"),
                format!(
                    "You can no longer open the {kind} “{name}”. If you still need it, ask its owner to share it again."
                ),
                "Open Drive".to_string(),
            )
        }
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

/// What a role lets someone do, to finish "you can now …".
fn role_verb(role: Option<&str>) -> &'static str {
    match role {
        Some("editor") | Some("owner") => "edit",
        Some("commenter") => "comment on",
        _ => "view",
    }
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
    fn losing_access_is_mailed_and_points_at_drive() {
        let payload = json!({
            "resourceType": "file",
            "resourceId": "f1",
            "resourceName": "Plan",
            "revokedById": "u2",
        });
        assert_eq!(actor_id(&payload), Some("u2"));
        let c = compose("file_access_revoked", &payload, &ctx(Some("Grace"), None)).unwrap();
        assert_eq!(c.subject, "Grace removed your access to “Plan”");
        assert!(c.text.contains("https://neutrino.test/drive\n"), "{}", c.text);
        let folder = json!({ "resourceType": "folder", "resourceId": "d1", "resourceName": "Photos" });
        let c = compose("folder_access_revoked", &folder, &ctx(None, None)).unwrap();
        assert!(c.text.contains("the folder “Photos”"));
    }

    #[test]
    fn an_access_request_asks_the_owner_to_review_it() {
        let payload = json!({
            "resourceType": "file",
            "resourceId": "f1",
            "fileId": "f1",
            "resourceName": "Budget",
            "role": "editor",
            "actorName": "Bob",
            "requesterEmail": "bob@example.com",
            "message": "For the Q4 review",
        });
        let c = compose("access_requested", &payload, &ctx(None, None)).unwrap();
        assert_eq!(c.subject, "Bob is asking for access to “Budget”");
        assert!(c.text.contains("Bob (bob@example.com) asked to edit the file “Budget”."));
        assert!(c.text.contains("“For the Q4 review”"));
        assert!(c.text.contains("Review request: https://neutrino.test/drive/requests\n"), "{}", c.text);
    }

    #[test]
    fn an_answered_request_tells_the_requester() {
        let payload = json!({
            "resourceType": "file",
            "resourceId": "f1",
            "resourceName": "Budget",
            "mimeType": "application/vnd.neutrino.sheet",
            "role": "commenter",
            "sharedById": "u1",
        });
        let c = compose("access_request_approved", &payload, &ctx(Some("Ada"), None)).unwrap();
        assert_eq!(c.subject, "Ada gave you access to “Budget”");
        assert!(c.text.contains("you can now comment on the file “Budget”"));
        assert!(c.text.contains("/sheets/editor?id=f1"));

        let c = compose("access_request_denied", &payload, &ctx(Some("Ada"), None)).unwrap();
        assert_eq!(c.subject, "Your request for “Budget” was declined");
        assert!(c.text.contains("https://neutrino.test/drive\n"));
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
