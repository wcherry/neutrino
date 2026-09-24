//! Where a recurring reminder goes next once it is completed.
//!
//! The clients expand recurring *events* themselves (`expandRecurringEvents` in the web's
//! `calendarHelpers.ts`, `RecurrenceExpander` in the iOS app). A reminder is different: completing
//! one has to move it, and every client has to see the same move, so the server makes it. This
//! module steps an RRULE the way those expansions do, not the way RFC 5545 would, so a reminder
//! and an event with the same rule land on the same days:
//!
//! - Steps are taken in the user's own time zone, keeping the wall-clock time across DST. A local
//!   time that doesn't exist (02:30 on the spring-forward day) moves forward by the gap; one that
//!   happens twice takes the first.
//! - MONTHLY and YEARLY overflow rather than clamp: Jan 31 → Mar 3, Feb 29 → Mar 1.
//! - BYDAY applies to WEEKLY only and reaches forward from each step's date.
//! - UNTIL is read only as a UTC date-time (`20260930T170000Z`); a bare date is ignored.
//! - A rule that doesn't parse (an `RRULE:` prefix, an unknown FREQ) doesn't recur.
//!
//! The one deliberate difference is COUNT. An expansion counts from a fixed start, but a
//! reminder's start moves every time it is completed, so here COUNT means how many times the
//! reminder still has to come round, this one included: completing it decrements COUNT, and
//! completing it at COUNT=1 finishes it.

use chrono::{
    DateTime, Datelike, Duration, LocalResult, NaiveDate, NaiveDateTime, Offset, TimeZone, Utc,
};
use chrono_tz::Tz;

/// The web's `MAX_OCCURRENCES`: how many FREQ steps an expansion takes before giving up.
const MAX_STEPS: i64 = 1000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Frequency {
    Daily,
    Weekly,
    Monthly,
    Yearly,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Rule {
    pub freq: Frequency,
    /// `None` when INTERVAL is present but unreadable, which ends the expansion after one step.
    pub interval: Option<i64>,
    pub count: Option<i64>,
    pub until: Option<DateTime<Utc>>,
    /// Days 0 (Sunday) to 6 (Saturday).
    pub by_day: Option<Vec<u32>>,
}

impl Rule {
    /// The web's `parseRRule`, including what it tolerates: keys are case-insensitive but FREQ's
    /// value is not, an empty value counts as absent, and numbers are read like `parseInt`.
    pub fn parse(rrule: &str) -> Option<Rule> {
        let mut parts = std::collections::HashMap::new();
        for part in rrule.split(';') {
            let mut pieces = part.split('=');
            let (Some(key), Some(value)) = (pieces.next(), pieces.next()) else {
                continue;
            };
            if key.is_empty() {
                continue;
            }
            parts.insert(key.to_uppercase(), value.to_string());
        }
        let freq = match parts.get("FREQ").map(String::as_str) {
            Some("DAILY") => Frequency::Daily,
            Some("WEEKLY") => Frequency::Weekly,
            Some("MONTHLY") => Frequency::Monthly,
            Some("YEARLY") => Frequency::Yearly,
            _ => return None,
        };
        parts.retain(|_, v| !v.is_empty());
        Some(Rule {
            freq,
            interval: parts.get("INTERVAL").map_or(Some(1), |v| js_parse_int(v)),
            count: parts.get("COUNT").and_then(|v| js_parse_int(v)),
            until: parts.get("UNTIL").and_then(|v| parse_until(v)),
            by_day: parts.get("BYDAY").map(|v| {
                v.split(',')
                    .filter_map(|token| {
                        let day: String = token
                            .chars()
                            .filter(|c| !"+-0123456789".contains(*c))
                            .collect();
                        ["SU", "MO", "TU", "WE", "TH", "FR", "SA"]
                            .iter()
                            .position(|d| *d == day)
                            .map(|i| i as u32)
                    })
                    .collect()
            }),
        })
    }
}

/// What completing a recurring reminder does to it.
#[derive(Debug, PartialEq)]
pub enum Completion {
    /// It comes round again: reopen it at `due`, storing `rule` (COUNT decremented, if any).
    Advance { due: DateTime<Utc>, rule: String },
    /// The rule is used up; the reminder is simply done.
    Finished,
}

/// Completing a reminder due at `due` under `rrule`, stepping in `tz`. `None` when the rule
/// doesn't parse, which means the reminder doesn't recur at all.
pub fn complete(due: DateTime<Utc>, rrule: &str, tz: Tz) -> Option<Completion> {
    let rule = Rule::parse(rrule)?;
    if rule.count.is_some_and(|c| c <= 1) {
        return Some(Completion::Finished);
    }
    // COUNT is handled here, by decrementing, so the stepping must not also stop on it.
    let stepping = Rule {
        count: None,
        ..rule.clone()
    };
    Some(match next_after(due, &stepping, tz) {
        Some(next) => Completion::Advance {
            due: next,
            rule: match rule.count {
                Some(count) => with_count(rrule, count - 1),
                None => rrule.to_string(),
            },
        },
        None => Completion::Finished,
    })
}

/// The first occurrence strictly after `due`, expanding with `due` as the start — the web's
/// `expandRecurringEvents` loop, stopped at its first hit.
pub fn next_after(due: DateTime<Utc>, rule: &Rule, tz: Tz) -> Option<DateTime<Utc>> {
    let mut current = due;
    for step in 0..MAX_STEPS {
        if rule.count.is_some_and(|c| step >= c) {
            return None;
        }
        if rule.until.is_some_and(|u| current > u) {
            return None;
        }
        let weekday = current.with_timezone(&tz).weekday().num_days_from_sunday();
        let targets = match (&rule.freq, &rule.by_day) {
            (Frequency::Weekly, Some(days)) => days.clone(),
            _ => vec![weekday],
        };
        // A step's BYDAY days all fall within six days of it, before the next step begins, so
        // the earliest hit in the first step that has one is the answer.
        let hit = targets
            .iter()
            .map(|target| {
                shift(
                    current,
                    Unit::Day,
                    ((*target as i64 - weekday as i64) + 7) % 7,
                    tz,
                )
            })
            .filter(|occurrence| *occurrence > due)
            .filter(|occurrence| rule.until.map_or(true, |u| *occurrence <= u))
            .min();
        if hit.is_some() {
            return hit;
        }
        let interval = rule.interval?;
        current = match rule.freq {
            Frequency::Daily => shift(current, Unit::Day, interval, tz),
            Frequency::Weekly => shift(current, Unit::Day, 7 * interval, tz),
            Frequency::Monthly => shift(current, Unit::Month, interval, tz),
            Frequency::Yearly => shift(current, Unit::Year, interval, tz),
        };
    }
    None
}

// ── JavaScript Date arithmetic ───────────────────────────────────────────────

enum Unit {
    Day,
    Month,
    Year,
}

/// `setDate(getDate() + n)`, `setMonth(…)`, `setFullYear(…)` on a local date-time: change one
/// field, let the day overflow into the next month, keep the wall-clock time.
fn shift(instant: DateTime<Utc>, unit: Unit, n: i64, tz: Tz) -> DateTime<Utc> {
    let local = instant.with_timezone(&tz).naive_local();
    let date = local.date();
    let shifted = match unit {
        Unit::Day => date + Duration::days(n),
        Unit::Month => overflowing_date(date.year() as i64, date.month0() as i64 + n, date.day()),
        Unit::Year => overflowing_date(date.year() as i64 + n, date.month0() as i64, date.day()),
    };
    resolve(shifted.and_time(local.time()), tz)
}

/// `new Date(year, month0, day)`: the first of the (normalised) month, plus `day - 1` days, so
/// Feb 31 is Mar 3.
fn overflowing_date(year: i64, month0: i64, day: u32) -> NaiveDate {
    let year = year + month0.div_euclid(12);
    let month = month0.rem_euclid(12) as u32 + 1;
    NaiveDate::from_ymd_opt(year as i32, month, 1).expect("a first of the month always exists")
        + Duration::days(day as i64 - 1)
}

/// A local date-time to an instant, as JavaScript resolves one: a repeated time takes the first
/// (earlier) instant, and a skipped one keeps the offset from before the gap, which moves it
/// forward by the gap.
fn resolve(local: NaiveDateTime, tz: Tz) -> DateTime<Utc> {
    match tz.from_local_datetime(&local) {
        LocalResult::Single(t) => t.with_timezone(&Utc),
        LocalResult::Ambiguous(earliest, _) => earliest.with_timezone(&Utc),
        LocalResult::None => {
            let before = tz
                .from_local_datetime(&(local - Duration::hours(3)))
                .earliest()
                .expect("three hours before a DST gap is an ordinary local time");
            let offset = before.offset().fix();
            (local - Duration::seconds(offset.local_minus_utc() as i64)).and_utc()
        }
    }
}

// ── Parsing ──────────────────────────────────────────────────────────────────

/// JavaScript's `parseInt(s, 10)`: leading whitespace, an optional sign, then the digits there
/// are. `"2abc"` is 2; `"abc"` is `None`, standing in for NaN.
fn js_parse_int(s: &str) -> Option<i64> {
    let s = s.trim_start();
    let (sign, rest) = match s.strip_prefix('-') {
        Some(rest) => (-1, rest),
        None => (1, s.strip_prefix('+').unwrap_or(s)),
    };
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
    digits.parse::<i64>().ok().map(|n| sign * n)
}

/// The web strips every `T` and `Z` and reads the rest only when it is fourteen digits.
fn parse_until(value: &str) -> Option<DateTime<Utc>> {
    let digits: String = value.chars().filter(|c| *c != 'T' && *c != 'Z').collect();
    if digits.len() != 14 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    NaiveDateTime::parse_from_str(&digits, "%Y%m%d%H%M%S")
        .ok()
        .map(|t| t.and_utc())
}

/// `rrule` with its COUNT replaced by `count`, every other part left exactly as written.
fn with_count(rrule: &str, count: i64) -> String {
    rrule
        .split(';')
        .map(|part| match part.split_once('=') {
            Some((key, _)) if key.eq_ignore_ascii_case("COUNT") => format!("{key}={count}"),
            _ => part.to_string(),
        })
        .collect::<Vec<_>>()
        .join(";")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(s: &str) -> DateTime<Utc> {
        s.parse().unwrap()
    }

    const LA: Tz = chrono_tz::America::Los_Angeles;

    /// Expected values come from running the web's `expandRecurringEvents` under
    /// TZ=America/Los_Angeles with the due time as the event start, and taking the first
    /// occurrence after it. They pin this module to the clients' stepping, quirks included.
    #[test]
    fn next_occurrence_matches_the_web_expansion() {
        let cases = [
            (
                "daily keeps local time across DST end",
                "2026-10-31T16:00:00Z",
                "FREQ=DAILY",
                Some("2026-11-01T17:00:00Z"),
            ),
            (
                "daily keeps local time across DST start",
                "2027-03-13T17:00:00Z",
                "FREQ=DAILY",
                Some("2027-03-14T16:00:00Z"),
            ),
            (
                "weekly",
                "2026-09-02T17:00:00Z",
                "FREQ=WEEKLY",
                Some("2026-09-09T17:00:00Z"),
            ),
            (
                "weekdays from Friday is Monday",
                "2026-09-04T16:00:00Z",
                "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
                Some("2026-09-07T16:00:00Z"),
            ),
            (
                "BYDAY reaches forward from Wednesday",
                "2026-09-02T17:00:00Z",
                "FREQ=WEEKLY;BYDAY=MO,WE",
                Some("2026-09-07T17:00:00Z"),
            ),
            (
                "every other week",
                "2026-09-01T17:00:00Z",
                "FREQ=WEEKLY;INTERVAL=2",
                Some("2026-09-15T17:00:00Z"),
            ),
            (
                "monthly from the 31st overflows",
                "2027-01-31T18:00:00Z",
                "FREQ=MONTHLY",
                Some("2027-03-03T18:00:00Z"),
            ),
            (
                "yearly from Feb 29 overflows",
                "2028-02-29T18:00:00Z",
                "FREQ=YEARLY",
                Some("2029-03-01T18:00:00Z"),
            ),
            (
                "UNTIL already reached",
                "2026-09-04T17:00:00Z",
                "FREQ=DAILY;UNTIL=20260904T170000Z",
                None,
            ),
            (
                "a nonexistent local time moves forward",
                "2027-03-13T10:30:00Z",
                "FREQ=DAILY",
                Some("2027-03-14T10:30:00Z"),
            ),
            (
                "a repeated local time takes the first",
                "2026-10-31T08:30:00Z",
                "FREQ=DAILY",
                Some("2026-11-01T08:30:00Z"),
            ),
            (
                "a bare-date UNTIL is ignored",
                "2026-09-04T17:00:00Z",
                "FREQ=DAILY;UNTIL=20260901",
                Some("2026-09-05T17:00:00Z"),
            ),
        ];
        for (name, due, rrule, expected) in cases {
            let rule = Rule::parse(rrule).unwrap();
            assert_eq!(next_after(at(due), &rule, LA), expected.map(at), "{name}");
        }
    }

    #[test]
    fn utc_steps_are_plain_days() {
        let rule = Rule::parse("FREQ=DAILY").unwrap();
        assert_eq!(
            next_after(at("2026-10-31T16:00:00Z"), &rule, Tz::UTC),
            Some(at("2026-11-01T16:00:00Z"))
        );
    }

    #[test]
    fn completing_advances_and_keeps_the_rule() {
        assert_eq!(
            complete(at("2026-09-02T17:00:00Z"), "FREQ=WEEKLY", LA),
            Some(Completion::Advance {
                due: at("2026-09-09T17:00:00Z"),
                rule: "FREQ=WEEKLY".into()
            })
        );
    }

    #[test]
    fn completing_counts_down_and_finishes_at_one() {
        assert_eq!(
            complete(
                at("2026-09-02T17:00:00Z"),
                "FREQ=DAILY;COUNT=3;INTERVAL=1",
                LA
            ),
            Some(Completion::Advance {
                due: at("2026-09-03T17:00:00Z"),
                rule: "FREQ=DAILY;COUNT=2;INTERVAL=1".into()
            })
        );
        assert_eq!(
            complete(at("2026-09-02T17:00:00Z"), "FREQ=DAILY;count=1", LA),
            Some(Completion::Finished)
        );
    }

    #[test]
    fn completing_past_until_finishes() {
        assert_eq!(
            complete(
                at("2026-09-04T17:00:00Z"),
                "FREQ=DAILY;UNTIL=20260904T170000Z",
                LA
            ),
            Some(Completion::Finished)
        );
    }

    #[test]
    fn a_rule_that_does_not_parse_does_not_recur() {
        assert_eq!(
            complete(at("2026-09-02T17:00:00Z"), "RRULE:FREQ=DAILY", LA),
            None
        );
        assert_eq!(complete(at("2026-09-02T17:00:00Z"), "FREQ=daily", LA), None);
        assert_eq!(complete(at("2026-09-02T17:00:00Z"), "", LA), None);
    }

    #[test]
    fn parsing_follows_the_web() {
        let rule = Rule::parse("freq=WEEKLY;interval=2abc;BYDAY=+1MO,-1FR,XX;UNTIL=").unwrap();
        assert_eq!(rule.freq, Frequency::Weekly);
        assert_eq!(rule.interval, Some(2));
        assert_eq!(rule.by_day, Some(vec![1, 5]));
        assert_eq!(rule.until, None);
        assert_eq!(
            Rule::parse("FREQ=DAILY;INTERVAL=abc").unwrap().interval,
            None
        );
    }

    #[test]
    fn an_unreadable_interval_has_no_next() {
        let rule = Rule::parse("FREQ=DAILY;INTERVAL=abc").unwrap();
        assert_eq!(next_after(at("2026-09-02T17:00:00Z"), &rule, LA), None);
    }
}
