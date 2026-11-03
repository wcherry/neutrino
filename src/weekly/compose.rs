//! Words the weekly email. Pure: the service gathers a [`Digest`], and this
//! turns it into a subject, a text body and an HTML body, or decides there is
//! nothing worth sending.

use crate::auth::welcome::{escape, Content};

use super::model::{ProductUpdateRecord, TeamActivity};

/// What one account's week held.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Digest {
    pub name: String,
    /// Shown in the heading, e.g. "26 Oct – 1 Nov".
    pub period: String,
    /// Names of files and folders shared with them, in order.
    pub shared: Vec<String>,
    pub mentions: usize,
    pub replies: usize,
    pub action_items: usize,
    /// Requests for access to their files, still to be answered or not.
    pub access_requests: usize,
    /// Bytes used and quota. Shown only alongside something else.
    pub storage: Option<(i64, Option<i64>)>,
    pub teams: Vec<TeamActivity>,
    pub updates: Vec<ProductUpdateRecord>,
}

impl Digest {
    /// Fold the week's notifications into the counts.
    pub fn add_notifications(&mut self, rows: &[(String, serde_json::Value)]) {
        for (event_type, payload) in rows {
            match event_type.as_str() {
                "file_shared" | "folder_shared" | "access_request_approved" => {
                    let name = payload
                        .get("resourceName")
                        .and_then(|v| v.as_str())
                        .filter(|s| !s.is_empty())
                        .unwrap_or("an item");
                    self.shared.push(name.to_string());
                }
                "mention" => self.mentions += 1,
                "comment_reply" => self.replies += 1,
                "action_item_assigned" => self.action_items += 1,
                "access_requested" => self.access_requests += 1,
                _ => {}
            }
        }
    }

    fn has_activity(&self) -> bool {
        !self.shared.is_empty()
            || self.mentions + self.replies + self.action_items + self.access_requests > 0
    }

    /// Whether there is anything worth an email. Storage alone is not.
    pub fn is_empty(&self) -> bool {
        !self.has_activity() && self.teams.is_empty() && self.updates.is_empty()
    }
}

/// `n thing` / `n things`.
fn count(n: usize, one: &str, many: &str) -> String {
    if n == 1 {
        format!("1 {one}")
    } else {
        format!("{n} {many}")
    }
}

/// `1.2 GB`, `340 MB`, `12 KB`.
pub fn human_bytes(bytes: i64) -> String {
    const UNITS: [&str; 5] = ["bytes", "KB", "MB", "GB", "TB"];
    let mut value = bytes.max(0) as f64;
    let mut unit = 0;
    while value >= 1000.0 && unit < UNITS.len() - 1 {
        value /= 1000.0;
        unit += 1;
    }
    if unit == 0 {
        format!("{} bytes", bytes.max(0))
    } else if value >= 100.0 {
        format!("{value:.0} {}", UNITS[unit])
    } else {
        format!("{value:.1} {}", UNITS[unit])
    }
}

/// One section: a heading and its lines.
struct Section {
    heading: &'static str,
    lines: Vec<String>,
    /// For product updates: each line is a title, then its body.
    bodies: Vec<String>,
}

fn activity_lines(d: &Digest) -> Vec<String> {
    let mut lines = Vec::new();
    match d.shared.len() {
        0 => {}
        1 => lines.push(format!("“{}” was shared with you.", d.shared[0])),
        2 => lines.push(format!("“{}” and “{}” were shared with you.", d.shared[0], d.shared[1])),
        n => lines.push(format!(
            "“{}”, “{}” and {} were shared with you.",
            d.shared[0],
            d.shared[1],
            count(n - 2, "other", "others")
        )),
    }
    if d.mentions > 0 {
        lines.push(format!("You were mentioned {}.", count(d.mentions, "time", "times")));
    }
    if d.replies > 0 {
        lines.push(format!("{} to your comments.", count(d.replies, "reply", "replies")));
    }
    if d.action_items > 0 {
        lines.push(format!(
            "{} assigned to you.",
            count(d.action_items, "action item", "action items")
        ));
    }
    if d.access_requests > 0 {
        lines.push(format!(
            "{} for access to your files.",
            count(d.access_requests, "request", "requests")
        ));
    }
    if let Some((used, quota)) = d.storage {
        lines.push(match quota {
            Some(q) if q > 0 => format!(
                "You're using {} of {} ({}%).",
                human_bytes(used),
                human_bytes(q),
                (used.max(0) * 100 / q).min(100)
            ),
            _ => format!("You're using {} of storage.", human_bytes(used)),
        });
    }
    lines
}

fn team_lines(teams: &[TeamActivity]) -> Vec<String> {
    teams
        .iter()
        .map(|t| {
            format!(
                "{}: {} to {} by {}.",
                t.team_name,
                count(t.changes as usize, "change", "changes"),
                count(t.files as usize, "file", "files"),
                count(t.people as usize, "person", "people"),
            )
        })
        .collect()
}

/// The email, or `None` when the week held nothing to tell.
pub fn compose(base_url: &str, d: &Digest) -> Option<Content> {
    if d.is_empty() {
        return None;
    }
    let base = base_url.trim_end_matches('/');
    let greeting = match d.name.trim() {
        "" => "Hi,".to_string(),
        n => format!("Hi {n},"),
    };
    let intro = format!("Here's your week in Neutrino, {}.", d.period);

    let mut sections = Vec::new();
    if d.has_activity() {
        sections.push(Section {
            heading: "Your week",
            lines: activity_lines(d),
            bodies: Vec::new(),
        });
    }
    if !d.teams.is_empty() {
        sections.push(Section {
            heading: "Your teams",
            lines: team_lines(&d.teams),
            bodies: Vec::new(),
        });
    }
    if !d.updates.is_empty() {
        sections.push(Section {
            heading: "What's new",
            lines: d.updates.iter().map(|u| u.title.clone()).collect(),
            bodies: d.updates.iter().map(|u| u.body.trim().to_string()).collect(),
        });
    }

    let subject = match (d.has_activity() || !d.teams.is_empty(), d.updates.len()) {
        (true, _) => format!("Your week in Neutrino: {}", d.period),
        (false, 1) => format!("What's new in Neutrino: {}", d.updates[0].title),
        (false, _) => "What's new in Neutrino".to_string(),
    };
    let action = "Open Neutrino";
    let link = format!("{base}/drive");
    let footer = "You get this email once a week. Turn it off by switching off \
                  General and Product updates under Settings → Notifications.";

    // Text.
    let mut text = format!("{greeting}\n\n{intro}\n");
    for s in &sections {
        text.push_str(&format!("\n{}\n", s.heading.to_uppercase()));
        if s.bodies.is_empty() {
            for line in &s.lines {
                text.push_str(&format!("- {line}\n"));
            }
        } else {
            for (title, body) in s.lines.iter().zip(&s.bodies) {
                text.push_str(&format!("\n{title}\n{body}\n"));
            }
        }
    }
    text.push_str(&format!("\n{action}: {link}\n\n—\n{footer}\n"));

    // HTML.
    let mut html_sections = String::new();
    for s in &sections {
        html_sections.push_str(&format!(
            r#"<h2 style="margin:24px 0 8px;font-size:15px">{}</h2>
"#,
            escape(s.heading)
        ));
        if s.bodies.is_empty() {
            html_sections.push_str(r#"<ul style="margin:0;padding-left:20px;line-height:1.6">"#);
            for line in &s.lines {
                html_sections.push_str(&format!("<li>{}</li>", escape(line)));
            }
            html_sections.push_str("</ul>\n");
        } else {
            for (title, body) in s.lines.iter().zip(&s.bodies) {
                html_sections.push_str(&format!(
                    r#"<p style="margin:0 0 4px;font-weight:600">{}</p>
"#,
                    escape(title)
                ));
                for para in body.split("\n\n").filter(|p| !p.trim().is_empty()) {
                    html_sections.push_str(&format!(
                        r#"<p style="margin:0 0 12px;line-height:1.5">{}</p>
"#,
                        escape(para.trim()).replace('\n', "<br>")
                    ));
                }
            }
        }
    }
    let html = format!(
        r#"<!doctype html>
<html><body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1f2328">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:28px">
<p style="margin:0 0 16px">{greeting}</p>
<p style="margin:0 0 8px;line-height:1.5">{intro}</p>
{html_sections}<p style="margin:24px 0"><a href="{link}" style="display:inline-block;background:#2f6feb;color:#ffffff;text-decoration:none;padding:10px 18px;border-radius:8px;font-weight:600">{action}</a></p>
<p style="margin:0;font-size:12px;color:#656d76;line-height:1.5">{footer}</p>
</div>
</body></html>
"#,
        greeting = escape(&greeting),
        intro = escape(&intro),
        link = escape(&link),
        action = escape(action),
        footer = escape(footer),
    );
    Some(Content {
        subject,
        text,
        html,
    })
}
