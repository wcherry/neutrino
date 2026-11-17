//! A small iCalendar (RFC 5545) reader and writer for CalDAV.
//!
//! Hand-rolled rather than the `ical` crate the iCloud client uses, because CalDAV needs two
//! things that crate doesn't give: every property's **raw line**, so what Neutrino doesn't model
//! (alarms, `X-APPLE-*`, ATTENDEE parameters) is stored and written back exactly as the client
//! sent it, and text values **unescaped** (`\,` `\;` `\n` `\\`).

use chrono::{Duration, NaiveDate, NaiveDateTime, Offset, TimeZone};
use chrono_tz::Tz;

#[derive(Debug, Clone, PartialEq)]
pub struct Prop {
    /// Upper-cased.
    pub name: String,
    /// Parameter names upper-cased; values as written, quotes removed.
    pub params: Vec<(String, String)>,
    /// The raw value, still escaped.
    pub value: String,
    /// The whole unfolded line, for writing back verbatim.
    pub raw: String,
}

impl Prop {
    pub fn param(&self, name: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(name))
            .map(|(_, v)| v.as_str())
    }

    /// The value as text, unescaped.
    pub fn text(&self) -> String {
        unescape(&self.value)
    }
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Component {
    /// Upper-cased: `VCALENDAR`, `VEVENT`, `VTODO`, `VALARM`, `VTIMEZONE`, …
    pub name: String,
    pub props: Vec<Prop>,
    pub children: Vec<Component>,
}

impl Component {
    pub fn new(name: &str) -> Self {
        Component {
            name: name.to_string(),
            ..Default::default()
        }
    }

    pub fn prop(&self, name: &str) -> Option<&Prop> {
        self.props.iter().find(|p| p.name == name)
    }

    pub fn props_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Prop> + 'a {
        self.props.iter().filter(move |p| p.name == name)
    }

    pub fn text(&self, name: &str) -> Option<String> {
        self.prop(name).map(Prop::text)
    }

    pub fn children_named<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a Component> + 'a {
        self.children.iter().filter(move |c| c.name == name)
    }

    /// Adds a property built from parts; the value is written as given (escape text first).
    pub fn push(&mut self, name: &str, params: &[(&str, &str)], value: &str) {
        let mut raw = name.to_string();
        for (k, v) in params {
            raw.push(';');
            raw.push_str(k);
            raw.push('=');
            if v.contains([':', ';', ',']) {
                raw.push('"');
                raw.push_str(v);
                raw.push('"');
            } else {
                raw.push_str(v);
            }
        }
        raw.push(':');
        raw.push_str(value);
        self.props.push(Prop {
            name: name.to_string(),
            params: params.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            value: value.to_string(),
            raw,
        });
    }

    pub fn push_text(&mut self, name: &str, value: &str) {
        self.push(name, &[], &escape(value));
    }

    /// The component as iCalendar text: CRLF line ends, folded at 75 octets.
    pub fn to_ics(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        fold_into(out, &format!("BEGIN:{}", self.name));
        for p in &self.props {
            fold_into(out, &p.raw);
        }
        for c in &self.children {
            c.write(out);
        }
        fold_into(out, &format!("END:{}", self.name));
    }
}

#[derive(Debug, PartialEq)]
pub struct ParseError(pub String);

/// Parses one iCalendar object (a `VCALENDAR`).
pub fn parse(text: &str) -> Result<Component, ParseError> {
    let mut stack: Vec<Component> = Vec::new();
    let mut root: Option<Component> = None;
    for line in unfold(text) {
        if line.trim().is_empty() {
            continue;
        }
        let prop = parse_line(&line).ok_or_else(|| ParseError(format!("Malformed line: {line}")))?;
        match prop.name.as_str() {
            "BEGIN" => stack.push(Component::new(&prop.value.trim().to_ascii_uppercase())),
            "END" => {
                let done = stack
                    .pop()
                    .ok_or_else(|| ParseError("END without BEGIN".into()))?;
                if !done.name.eq_ignore_ascii_case(prop.value.trim()) {
                    return Err(ParseError(format!("END:{} closes {}", prop.value, done.name)));
                }
                match stack.last_mut() {
                    Some(parent) => parent.children.push(done),
                    None if root.is_none() => root = Some(done),
                    None => return Err(ParseError("More than one object".into())),
                }
            }
            _ => stack
                .last_mut()
                .ok_or_else(|| ParseError("Property outside a component".into()))?
                .props
                .push(prop),
        }
    }
    if !stack.is_empty() {
        return Err(ParseError("Unterminated component".into()));
    }
    let root = root.ok_or_else(|| ParseError("Empty".into()))?;
    if root.name != "VCALENDAR" {
        return Err(ParseError("Not a VCALENDAR".into()));
    }
    Ok(root)
}

/// Lines with RFC 5545 folding undone: a line starting with a space or tab continues the one
/// before it.
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for line in text.split('\n') {
        let line = line.strip_suffix('\r').unwrap_or(line);
        match (line.strip_prefix(' ').or_else(|| line.strip_prefix('\t')), lines.last_mut()) {
            (Some(rest), Some(last)) => last.push_str(rest),
            _ => lines.push(line.to_string()),
        }
    }
    lines
}

/// `NAME;P1=a;P2="b:c":value`. The value starts at the first colon outside quotes.
fn parse_line(line: &str) -> Option<Prop> {
    let mut in_quotes = false;
    let mut split = None;
    for (i, c) in line.char_indices() {
        match c {
            '"' => in_quotes = !in_quotes,
            ':' if !in_quotes => {
                split = Some(i);
                break;
            }
            _ => {}
        }
    }
    let split = split?;
    let (head, value) = (&line[..split], &line[split + 1..]);
    let mut parts = split_unquoted(head, ';').into_iter();
    let name = parts.next()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }
    let params = parts
        .filter_map(|p| {
            let (k, v) = p.split_once('=')?;
            Some((k.trim().to_ascii_uppercase(), v.trim().trim_matches('"').to_string()))
        })
        .collect();
    Some(Prop {
        name,
        params,
        value: value.to_string(),
        raw: line.to_string(),
    })
}

fn split_unquoted(s: &str, sep: char) -> Vec<&str> {
    let mut out = Vec::new();
    let mut in_quotes = false;
    let mut start = 0;
    for (i, c) in s.char_indices() {
        if c == '"' {
            in_quotes = !in_quotes;
        } else if c == sep && !in_quotes {
            out.push(&s[start..i]);
            start = i + c.len_utf8();
        }
    }
    out.push(&s[start..]);
    out
}

/// Folds a content line at 75 octets, never inside a UTF-8 character, and ends it with CRLF.
fn fold_into(out: &mut String, line: &str) {
    let mut width = 0;
    for c in line.chars() {
        let len = c.len_utf8();
        if width + len > 75 {
            out.push_str("\r\n ");
            width = 1;
        }
        out.push(c);
        width += len;
    }
    out.push_str("\r\n");
}

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            ';' => out.push_str("\\;"),
            ',' => out.push_str("\\,"),
            '\n' => out.push_str("\\n"),
            '\r' => {}
            _ => out.push(c),
        }
    }
    out
}

pub fn unescape(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c != '\\' {
            out.push(c);
            continue;
        }
        match chars.next() {
            Some('n') | Some('N') => out.push('\n'),
            Some(other) => out.push(other),
            None => out.push('\\'),
        }
    }
    out
}

// ── Date-times ───────────────────────────────────────────────────────────────

/// A DTSTART/DUE/RECURRENCE-ID-style value read as UTC, and whether it was a date.
///
/// A local time with an IANA `TZID` is converted out of that zone (the earlier instant in an
/// hour that repeats, the moment after the gap in one that is skipped). A floating time, or one
/// in a zone that isn't an IANA name, is read as UTC: the model has no floating time, and this
/// is documented as lossy.
pub fn read_time(prop: &Prop) -> Option<(NaiveDateTime, bool)> {
    read_time_value(prop.value.trim(), prop.param("TZID"), prop.param("VALUE"))
}

pub fn read_time_value(
    value: &str,
    tzid: Option<&str>,
    value_type: Option<&str>,
) -> Option<(NaiveDateTime, bool)> {
    if value_type.is_some_and(|v| v.eq_ignore_ascii_case("DATE")) || (value.len() == 8 && !value.contains('T')) {
        let date = NaiveDate::parse_from_str(&value[..8.min(value.len())], "%Y%m%d").ok()?;
        return Some((date.and_hms_opt(0, 0, 0)?, true));
    }
    if let Some(utc) = value.strip_suffix('Z') {
        return Some((NaiveDateTime::parse_from_str(utc, "%Y%m%dT%H%M%S").ok()?, false));
    }
    let local = NaiveDateTime::parse_from_str(value, "%Y%m%dT%H%M%S").ok()?;
    match tzid.and_then(zone) {
        Some(tz) => Some((from_local(tz, local)?, false)),
        None => Some((local, false)),
    }
}

/// An IANA zone by name. Some clients write `/mozilla.org/…/Europe/London`-style prefixes;
/// the zone name is the tail.
pub fn zone(name: &str) -> Option<Tz> {
    if let Ok(tz) = name.parse::<Tz>() {
        return Some(tz);
    }
    let parts: Vec<&str> = name.trim_matches('/').split('/').collect();
    (1..parts.len()).find_map(|i| parts[i..].join("/").parse::<Tz>().ok())
}

pub fn from_local(tz: Tz, local: NaiveDateTime) -> Option<NaiveDateTime> {
    match tz.from_local_datetime(&local) {
        chrono::LocalResult::Single(t) | chrono::LocalResult::Ambiguous(t, _) => Some(t.naive_utc()),
        chrono::LocalResult::None => tz
            .from_local_datetime(&(local + Duration::hours(1)))
            .earliest()
            .map(|t| t.naive_utc()),
    }
}

/// How a time is written out: a date, in a zone, or in UTC.
#[derive(Debug, Clone, Copy)]
pub enum TimeForm {
    Date,
    Zoned(Tz),
    Utc,
}

/// `(params, value)` for a time in `form`.
pub fn write_time(at: NaiveDateTime, form: TimeForm) -> (Vec<(&'static str, String)>, String) {
    match form {
        TimeForm::Date => (vec![("VALUE", "DATE".to_string())], at.format("%Y%m%d").to_string()),
        TimeForm::Zoned(tz) => {
            let local = tz.from_utc_datetime(&at).naive_local();
            (vec![("TZID", tz.name().to_string())], local.format("%Y%m%dT%H%M%S").to_string())
        }
        TimeForm::Utc => (vec![], format!("{}Z", at.format("%Y%m%dT%H%M%S"))),
    }
}

pub fn push_time(c: &mut Component, name: &str, at: NaiveDateTime, form: TimeForm) {
    let (params, value) = write_time(at, form);
    let params: Vec<(&str, &str)> = params.iter().map(|(k, v)| (*k, v.as_str())).collect();
    c.push(name, &params, &value);
}

pub fn utc_stamp(at: NaiveDateTime) -> String {
    format!("{}Z", at.format("%Y%m%dT%H%M%S"))
}

/// A `VTIMEZONE` for `tz` covering `from_year..=to_year`: one observance per offset change in
/// those years, found by stepping a day at a time and narrowing to the second. Apple and Google
/// clients resolve an IANA `TZID` by name and ignore this; RFC 5545 requires it, and the
/// clients that do read it get correct offsets for the years the event touches.
pub fn vtimezone(tz: Tz, from_year: i32, to_year: i32) -> Component {
    let mut c = Component::new("VTIMEZONE");
    c.push("TZID", &[], tz.name());
    let offset_at = |t: NaiveDateTime| tz.offset_from_utc_datetime(&t).fix().local_minus_utc();
    let start = NaiveDate::from_ymd_opt(from_year, 1, 1).and_then(|d| d.and_hms_opt(0, 0, 0));
    let end = NaiveDate::from_ymd_opt(to_year + 1, 1, 1).and_then(|d| d.and_hms_opt(0, 0, 0));
    let (Some(mut t), Some(end)) = (start, end) else {
        return c;
    };
    let mut current = offset_at(t);
    let mut transitions = Vec::new();
    while t < end {
        let next = t + Duration::days(1);
        let o = offset_at(next);
        if o != current {
            // Narrow to the second: the change happened in (t, next].
            let (mut lo, mut hi) = (t, next);
            while hi - lo > Duration::seconds(1) {
                let mid = lo + (hi - lo) / 2;
                if offset_at(mid) == current {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            transitions.push((hi, current, o));
            current = o;
        }
        t = next;
    }
    let fmt_offset = |secs: i32| {
        let sign = if secs < 0 { '-' } else { '+' };
        let m = secs.abs() / 60;
        format!("{sign}{:02}{:02}", m / 60, m % 60)
    };
    if transitions.is_empty() {
        let mut std = Component::new("STANDARD");
        std.push("DTSTART", &[], "19700101T000000");
        std.push("TZOFFSETFROM", &[], &fmt_offset(current));
        std.push("TZOFFSETTO", &[], &fmt_offset(current));
        c.children.push(std);
        return c;
    }
    for (at, from, to) in transitions {
        let mut obs = Component::new(if to > from { "DAYLIGHT" } else { "STANDARD" });
        // DTSTART of an observance is local time in the offset before the change.
        let local = at + Duration::seconds(from as i64);
        obs.push("DTSTART", &[], &local.format("%Y%m%dT%H%M%S").to_string());
        obs.push("TZOFFSETFROM", &[], &fmt_offset(from));
        obs.push("TZOFFSETTO", &[], &fmt_offset(to));
        c.children.push(obs);
    }
    c
}

/// An RRULE with its `UNTIL` in the one form every expander here reads: UTC, `…T…Z`. A bare
/// date is the end of that day; a local time is read in `tz`.
pub fn normalize_rrule(rule: &str, tz: Option<Tz>) -> String {
    rule.split(';')
        .map(|part| match part.split_once('=') {
            Some((k, v)) if k.eq_ignore_ascii_case("UNTIL") => {
                let fixed = if v.len() == 8 {
                    format!("{v}T235959Z")
                } else if v.ends_with('Z') {
                    v.to_string()
                } else {
                    match (NaiveDateTime::parse_from_str(v, "%Y%m%dT%H%M%S").ok(), tz) {
                        (Some(local), Some(tz)) => from_local(tz, local)
                            .map(utc_stamp)
                            .unwrap_or_else(|| format!("{v}Z")),
                        _ => format!("{v}Z"),
                    }
                };
                format!("UNTIL={fixed}")
            }
            _ => part.to_string(),
        })
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Apple Inc.//iOS 26//EN\r\nBEGIN:VEVENT\r\nUID:ABC-1\r\nSUMMARY:Dinner\\, then drinks\\; maybe\r\nDESCRIPTION:Line one\\nLine two with a long tail that needs fol\r\n ding across lines\r\nDTSTART;TZID=America/Los_Angeles:20261021T180000\r\nX-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\nATTENDEE;CN=\"Doe, Jane\";PARTSTAT=ACCEPTED:mailto:jane@example.com\r\nBEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n";

    #[test]
    fn parses_components_unfolds_and_unescapes() {
        let cal = parse(SAMPLE).unwrap();
        let ev = cal.children_named("VEVENT").next().unwrap();
        assert_eq!(ev.text("SUMMARY").unwrap(), "Dinner, then drinks; maybe");
        assert_eq!(
            ev.text("DESCRIPTION").unwrap(),
            "Line one\nLine two with a long tail that needs folding across lines"
        );
        let att = ev.prop("ATTENDEE").unwrap();
        assert_eq!(att.param("CN"), Some("Doe, Jane"));
        assert_eq!(att.value, "mailto:jane@example.com");
        assert_eq!(ev.children_named("VALARM").count(), 1);
    }

    #[test]
    fn writes_back_unknown_lines_verbatim() {
        let cal = parse(SAMPLE).unwrap();
        let again = parse(&cal.to_ics()).unwrap();
        assert_eq!(cal, again);
        assert!(cal.to_ics().contains("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC\r\n"));
    }

    #[test]
    fn folds_at_75_octets_without_splitting_a_character() {
        let mut c = Component::new("VEVENT");
        c.push_text("SUMMARY", &"é".repeat(60));
        let ics = c.to_ics();
        for line in ics.split("\r\n") {
            assert!(line.len() <= 75, "{} octets", line.len());
        }
        let back = parse(&format!("BEGIN:VCALENDAR\r\n{ics}END:VCALENDAR\r\n")).unwrap();
        assert_eq!(back.children[0].text("SUMMARY").unwrap(), "é".repeat(60));
    }

    #[test]
    fn rejects_broken_objects() {
        assert!(parse("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR\r\n").is_err());
        assert!(parse("BEGIN:VEVENT\r\nEND:VEVENT\r\n").is_err());
        assert!(parse("").is_err());
    }

    #[test]
    fn reads_times_in_each_form() {
        let t = |v: &str, tz: Option<&str>| read_time_value(v, tz, None).unwrap();
        assert_eq!(t("20261021T180000Z", None).0.to_string(), "2026-10-21 18:00:00");
        // 18:00 in Los Angeles in October (UTC−7) is 01:00 UTC the next day.
        assert_eq!(t("20261021T180000", Some("America/Los_Angeles")).0.to_string(), "2026-10-22 01:00:00");
        assert_eq!(
            t("20261021T180000", Some("/mozilla.org/20050126_1/Europe/London")).0.to_string(),
            "2026-10-21 17:00:00"
        );
        assert_eq!(t("20261021", None), (NaiveDate::from_ymd_opt(2026, 10, 21).unwrap().and_hms_opt(0, 0, 0).unwrap(), true));
        // A zone that isn't IANA is read as written.
        assert_eq!(t("20261021T180000", Some("Pacific Standard Time")).0.to_string(), "2026-10-21 18:00:00");
    }

    #[test]
    fn writes_times_in_each_form() {
        let at = NaiveDate::from_ymd_opt(2026, 10, 22).unwrap().and_hms_opt(1, 0, 0).unwrap();
        let la: Tz = "America/Los_Angeles".parse().unwrap();
        assert_eq!(write_time(at, TimeForm::Zoned(la)).1, "20261021T180000");
        assert_eq!(write_time(at, TimeForm::Utc).1, "20261022T010000Z");
        assert_eq!(write_time(at, TimeForm::Date).1, "20261022");
    }

    #[test]
    fn a_vtimezone_lists_the_years_transitions() {
        let la: Tz = "America/Los_Angeles".parse().unwrap();
        let vtz = vtimezone(la, 2026, 2026);
        let kinds: Vec<&str> = vtz.children.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(kinds, ["DAYLIGHT", "STANDARD"]);
        let daylight = &vtz.children[0];
        assert_eq!(daylight.prop("DTSTART").unwrap().value, "20260308T020000");
        assert_eq!(daylight.prop("TZOFFSETFROM").unwrap().value, "-0800");
        assert_eq!(daylight.prop("TZOFFSETTO").unwrap().value, "-0700");
        let tokyo: Tz = "Asia/Tokyo".parse().unwrap();
        assert_eq!(vtimezone(tokyo, 2026, 2026).children.len(), 1);
    }

    #[test]
    fn until_is_normalised_to_utc() {
        let la: Tz = "America/Los_Angeles".parse().unwrap();
        assert_eq!(normalize_rrule("FREQ=WEEKLY;UNTIL=20261231", None), "FREQ=WEEKLY;UNTIL=20261231T235959Z");
        assert_eq!(
            normalize_rrule("FREQ=DAILY;UNTIL=20261021T180000;COUNT=3", Some(la)),
            "FREQ=DAILY;UNTIL=20261022T010000Z;COUNT=3"
        );
        assert_eq!(normalize_rrule("FREQ=DAILY;UNTIL=20261021T180000Z", None), "FREQ=DAILY;UNTIL=20261021T180000Z");
    }
}
