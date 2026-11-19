//! How an event shows its owner's time: busy, free, tentative or away (out of office).
//!
//! Stored as text in `events.availability`, default `busy`. The formats Neutrino reads and
//! writes each say it differently, and the mappings live here so they stay in step:
//!
//! - **iCalendar** (CalDAV, iCloud sync): `TRANSP` says busy or free and is what Apple Calendar
//!   shows and edits ("Show As"). Tentative and out-of-office ride on Microsoft's
//!   `X-MICROSOFT-CDO-BUSYSTATUS`, which Outlook, Thunderbird and Fantastical read. `TRANSP` wins
//!   when the two disagree, because a client that edits only `TRANSP` leaves a stale status
//!   behind it.
//! - **Google**: `transparency`, an `outOfOffice` event type, and the user's own tentative reply.
//! - **Outlook**: `showAs`.

use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "lowercase")]
pub enum Availability {
    #[default]
    Busy,
    Free,
    Tentative,
    /// Out of office.
    Away,
}

impl Availability {
    pub fn as_str(self) -> &'static str {
        match self {
            Availability::Busy => "busy",
            Availability::Free => "free",
            Availability::Tentative => "tentative",
            Availability::Away => "away",
        }
    }

    /// The stored value; anything unrecognised reads as busy, the safe assumption about time.
    pub fn from_stored(s: &str) -> Availability {
        match s {
            "free" => Availability::Free,
            "tentative" => Availability::Tentative,
            "away" => Availability::Away,
            _ => Availability::Busy,
        }
    }

    // ── iCalendar ────────────────────────────────────────────────────────────

    /// From a `VEVENT`'s `TRANSP` and `X-MICROSOFT-CDO-BUSYSTATUS`, either possibly absent.
    pub fn from_ical(transp: Option<&str>, busy_status: Option<&str>) -> Availability {
        let transp = transp.map(|t| t.trim().to_ascii_uppercase());
        if transp.as_deref() == Some("TRANSPARENT") {
            return Availability::Free;
        }
        match busy_status.map(|s| s.trim().to_ascii_uppercase()).as_deref() {
            Some("TENTATIVE") => Availability::Tentative,
            Some("OOF") => Availability::Away,
            // FREE under an explicit OPAQUE is a status left behind by a client that changed
            // only TRANSP; with no TRANSP at all, it is the whole answer.
            Some("FREE") if transp.is_none() => Availability::Free,
            _ => Availability::Busy,
        }
    }

    /// `TRANSP`, and `X-MICROSOFT-CDO-BUSYSTATUS` when it says more than `TRANSP` does.
    pub fn to_ical(self) -> (&'static str, Option<&'static str>) {
        match self {
            Availability::Busy => ("OPAQUE", None),
            Availability::Free => ("TRANSPARENT", Some("FREE")),
            Availability::Tentative => ("OPAQUE", Some("TENTATIVE")),
            Availability::Away => ("OPAQUE", Some("OOF")),
        }
    }

    // ── Providers ────────────────────────────────────────────────────────────

    /// From a Google event's `transparency`, `eventType`, and the user's own reply to it.
    pub fn from_google(
        transparency: Option<&str>,
        event_type: Option<&str>,
        own_response: Option<&str>,
    ) -> Availability {
        if event_type == Some("outOfOffice") {
            Availability::Away
        } else if transparency == Some("transparent") {
            Availability::Free
        } else if own_response == Some("tentative") {
            Availability::Tentative
        } else {
            Availability::Busy
        }
    }

    /// From a Microsoft Graph event's `showAs`. `workingElsewhere` is still busy.
    pub fn from_outlook(show_as: Option<&str>) -> Availability {
        match show_as {
            Some("free") => Availability::Free,
            Some("tentative") => Availability::Tentative,
            Some("oof") => Availability::Away,
            _ => Availability::Busy,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::Availability::{self, *};

    #[test]
    fn stored_values_round_trip_and_unknown_is_busy() {
        for a in [Busy, Free, Tentative, Away] {
            assert_eq!(Availability::from_stored(a.as_str()), a);
        }
        assert_eq!(Availability::from_stored("oof"), Busy);
    }

    #[test]
    fn ical_round_trips() {
        for a in [Busy, Free, Tentative, Away] {
            let (transp, status) = a.to_ical();
            assert_eq!(Availability::from_ical(Some(transp), status), a);
        }
    }

    #[test]
    fn ical_reads_what_clients_write() {
        // Apple Calendar: TRANSP alone.
        assert_eq!(Availability::from_ical(Some("TRANSPARENT"), None), Free);
        assert_eq!(Availability::from_ical(Some("OPAQUE"), None), Busy);
        // Nothing at all: RFC 5545's default is OPAQUE.
        assert_eq!(Availability::from_ical(None, None), Busy);
        // Outlook: the status alone, any case.
        assert_eq!(Availability::from_ical(None, Some("free")), Free);
        assert_eq!(Availability::from_ical(None, Some("OOF")), Away);
        assert_eq!(Availability::from_ical(None, Some("WORKINGELSEWHERE")), Busy);
        // Apple switched a free event to busy and left Outlook's status behind.
        assert_eq!(Availability::from_ical(Some("OPAQUE"), Some("FREE")), Busy);
        // ...or a tentative one to free.
        assert_eq!(Availability::from_ical(Some("TRANSPARENT"), Some("TENTATIVE")), Free);
    }

    #[test]
    fn providers() {
        assert_eq!(Availability::from_google(Some("transparent"), None, None), Free);
        assert_eq!(Availability::from_google(None, Some("outOfOffice"), None), Away);
        assert_eq!(Availability::from_google(Some("opaque"), Some("default"), Some("tentative")), Tentative);
        assert_eq!(Availability::from_google(None, None, Some("accepted")), Busy);
        assert_eq!(Availability::from_outlook(Some("oof")), Away);
        assert_eq!(Availability::from_outlook(Some("workingElsewhere")), Busy);
        assert_eq!(Availability::from_outlook(None), Busy);
    }
}
