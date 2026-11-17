//! WebDAV XML: a namespace-aware reader for request bodies (PROPFIND, REPORT, PROPPATCH,
//! MKCALENDAR) and a writer for `multistatus` responses.

use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::NsReader;

pub const DAV: &str = "DAV:";
pub const CALDAV: &str = "urn:ietf:params:xml:ns:caldav";
pub const CS: &str = "http://calendarserver.org/ns/";
pub const ICAL: &str = "http://apple.com/ns/ical/";

/// A property or element name: `(namespace, local name)`.
pub type QName = (String, String);

pub fn qname(ns: &str, name: &str) -> QName {
    (ns.to_string(), name.to_string())
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Element {
    pub ns: String,
    pub name: String,
    pub attrs: Vec<(String, String)>,
    pub children: Vec<Element>,
    pub text: String,
}

impl Element {
    pub fn is(&self, ns: &str, name: &str) -> bool {
        self.ns == ns && self.name == name
    }

    pub fn child(&self, ns: &str, name: &str) -> Option<&Element> {
        self.children.iter().find(|c| c.is(ns, name))
    }

    pub fn children_named<'a>(&'a self, ns: &'a str, name: &'a str) -> impl Iterator<Item = &'a Element> + 'a {
        self.children.iter().filter(move |c| c.is(ns, name))
    }

    pub fn attr(&self, name: &str) -> Option<&str> {
        self.attrs.iter().find(|(k, _)| k == name).map(|(_, v)| v.as_str())
    }

    pub fn qname(&self) -> QName {
        (self.ns.clone(), self.name.clone())
    }

    /// Every descendant (and this element) with the name, depth first.
    pub fn find_all<'a>(&'a self, ns: &str, name: &str, out: &mut Vec<&'a Element>) {
        if self.is(ns, name) {
            out.push(self);
        }
        for c in &self.children {
            c.find_all(ns, name, out);
        }
    }
}

/// Parses an XML body into its root element. `None` for an empty or malformed body.
pub fn parse(body: &str) -> Option<Element> {
    let mut reader = NsReader::from_str(body);
    reader.config_mut().trim_text(true);
    let mut stack: Vec<Element> = Vec::new();
    loop {
        let (ns, event) = reader.read_resolved_event().ok()?;
        let ns = match ns {
            ResolveResult::Bound(n) => String::from_utf8_lossy(n.as_ref()).into_owned(),
            _ => String::new(),
        };
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                stack.push(Element {
                    ns,
                    name: String::from_utf8_lossy(e.local_name().as_ref()).into_owned(),
                    attrs: e
                        .attributes()
                        .filter_map(|a| a.ok())
                        .map(|a| {
                            (
                                String::from_utf8_lossy(a.key.local_name().as_ref()).into_owned(),
                                a.unescape_value().map(|v| v.into_owned()).unwrap_or_default(),
                            )
                        })
                        .collect(),
                    ..Default::default()
                });
                if matches!(event, Event::Empty(_)) {
                    if let Some(root) = close(&mut stack)? {
                        return Some(root);
                    }
                }
            }
            Event::End(_) => {
                if let Some(root) = close(&mut stack)? {
                    return Some(root);
                }
            }
            Event::Text(t) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&t.unescape().ok()?);
                }
            }
            Event::CData(t) => {
                if let Some(top) = stack.last_mut() {
                    top.text.push_str(&String::from_utf8_lossy(&t.into_inner()));
                }
            }
            Event::Eof => return None,
            _ => {}
        }
    }
}

/// Pops the top element into its parent. `Some(root)` when the root closed.
fn close(stack: &mut Vec<Element>) -> Option<Option<Element>> {
    let done = stack.pop()?;
    match stack.last_mut() {
        Some(parent) => {
            parent.children.push(done);
            Some(None)
        }
        None => Some(Some(done)),
    }
}

// ── Writing ───────────────────────────────────────────────────────────────────

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

fn prefix(ns: &str) -> Option<&'static str> {
    match ns {
        DAV => Some("d"),
        CALDAV => Some("c"),
        CS => Some("cs"),
        ICAL => Some("ic"),
        _ => None,
    }
}

/// An element `<p:name>inner</p:name>`, declaring an unknown namespace on itself. `inner` is
/// already XML.
pub fn el(name: &QName, inner: &str) -> String {
    let (ns, local) = name;
    match prefix(ns) {
        Some(p) if inner.is_empty() => format!("<{p}:{local}/>"),
        Some(p) => format!("<{p}:{local}>{inner}</{p}:{local}>"),
        None if inner.is_empty() => format!("<x:{local} xmlns:x=\"{}\"/>", escape(ns)),
        None => format!("<x:{local} xmlns:x=\"{}\">{inner}</x:{local}>", escape(ns)),
    }
}

pub fn d(local: &str, inner: &str) -> String {
    el(&qname(DAV, local), inner)
}

pub fn href(path: &str) -> String {
    d("href", &escape(path))
}

/// One `<d:response>`: the properties found (200) and not found (404).
pub struct PropResponse {
    pub href: String,
    pub found: Vec<(QName, String)>,
    pub missing: Vec<QName>,
}

impl PropResponse {
    pub fn to_xml(&self) -> String {
        let mut out = String::new();
        out.push_str(&href(&self.href));
        if !self.found.is_empty() {
            let props: String = self.found.iter().map(|(n, v)| el(n, v)).collect();
            out.push_str(&d("propstat", &(d("prop", &props) + &d("status", "HTTP/1.1 200 OK"))));
        }
        if !self.missing.is_empty() {
            let props: String = self.missing.iter().map(|n| el(n, "")).collect();
            out.push_str(&d(
                "propstat",
                &(d("prop", &props) + &d("status", "HTTP/1.1 404 Not Found")),
            ));
        }
        d("response", &out)
    }
}

/// A `<d:response>` saying the resource is gone, for `sync-collection`.
pub fn gone_response(path: &str) -> String {
    d("response", &(href(path) + &d("status", "HTTP/1.1 404 Not Found")))
}

pub fn multistatus(responses: &[String], extra: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<d:multistatus xmlns:d=\"{DAV}\" xmlns:c=\"{CALDAV}\" xmlns:cs=\"{CS}\" xmlns:ic=\"{ICAL}\">{}{extra}</d:multistatus>",
        responses.concat()
    )
}

/// `<d:error>` with one precondition, the body of a `403`/`409` that names why.
pub fn error_body(name: &QName) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<d:error xmlns:d=\"{DAV}\" xmlns:c=\"{CALDAV}\">{}</d:error>",
        el(name, "")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_propfind_with_prefixed_and_default_namespaces() {
        let body = r#"<?xml version="1.0"?>
<A:propfind xmlns:A="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <A:prop>
    <A:displayname/>
    <C:calendar-home-set/>
    <getctag xmlns="http://calendarserver.org/ns/"/>
  </A:prop>
</A:propfind>"#;
        let root = parse(body).unwrap();
        assert!(root.is(DAV, "propfind"));
        let names: Vec<QName> = root.child(DAV, "prop").unwrap().children.iter().map(Element::qname).collect();
        assert_eq!(
            names,
            vec![qname(DAV, "displayname"), qname(CALDAV, "calendar-home-set"), qname(CS, "getctag")]
        );
    }

    #[test]
    fn reads_text_and_attributes() {
        let body = r#"<C:calendar-multiget xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
<D:prop><D:getetag/></D:prop>
<D:href>/dav/calendars/u/cal-1/a%20b.ics</D:href>
<C:filter><C:comp-filter name="VCALENDAR"/></C:filter>
</C:calendar-multiget>"#;
        let root = parse(body).unwrap();
        assert_eq!(root.child(DAV, "href").unwrap().text, "/dav/calendars/u/cal-1/a%20b.ics");
        let filter = root.child(CALDAV, "filter").unwrap();
        assert_eq!(filter.child(CALDAV, "comp-filter").unwrap().attr("name"), Some("VCALENDAR"));
    }

    #[test]
    fn malformed_or_empty_bodies_are_none() {
        assert!(parse("").is_none());
        assert!(parse("<a><b></a>").is_none());
    }

    #[test]
    fn writes_unknown_namespaces_on_the_element() {
        let r = PropResponse {
            href: "/dav/".into(),
            found: vec![(qname(DAV, "displayname"), escape("A & B"))],
            missing: vec![qname("urn:x", "thing")],
        };
        let xml = multistatus(&[r.to_xml()], "");
        assert!(xml.contains("<d:displayname>A &amp; B</d:displayname>"));
        assert!(xml.contains("<x:thing xmlns:x=\"urn:x\"/>"));
        assert!(parse(&xml).is_some());
    }
}
