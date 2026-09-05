//! What a team's visibility means (issue #185).
//!
//! Visibility answers two questions that travel together: **can a non-member find this team**, and
//! **what may they do about it**. It never answers what a member may do once inside — that is
//! [`Role`](super::roles::Role), and the two must not be confused. A Viewer in a private team and a
//! Viewer in an organization team have identical authority; the difference is only in how each of
//! them arrived.
//!
//! | Visibility     | Findable by a non-member | How a non-member joins        |
//! |----------------|--------------------------|-------------------------------|
//! | `private`      | No — 404, as if absent   | They don't; someone adds them |
//! | `organization` | Yes                      | Adds themselves, immediately  |
//! | `invite_only`  | Yes                      | Asks, and an admin decides    |
//!
//! The two discoverable values differ *only* in whether joining needs someone's agreement, which is
//! why they are one enum and not two independent flags: every combination is expressible and none
//! of them is contradictory.

use std::fmt;

/// Who can find a team, and how they get in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Visibility {
    /// Members only, and its existence is not public: a non-member gets the same 404 as for a team
    /// id that never existed.
    Private,
    /// Anyone signed in can find it and ask to join; an Owner or Admin decides.
    InviteOnly,
    /// Anyone signed in can find it and add themselves without asking.
    Organization,
}

/// What a non-member may do about a team they can see.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum JoinPolicy {
    /// Nothing — they cannot see it in the first place.
    Closed,
    /// Add themselves. The membership exists the moment they ask for it.
    SelfServe,
    /// Ask. A row in `team_join_requests` until someone answers it.
    ByRequest,
}

impl Visibility {
    pub fn as_str(&self) -> &'static str {
        match self {
            Visibility::Private => "private",
            Visibility::InviteOnly => "invite_only",
            Visibility::Organization => "organization",
        }
    }

    /// Parse a value arriving from a client. `None` is a 400, not a default — a request that names
    /// a visibility nobody implements should be refused rather than quietly stored as something
    /// else.
    pub fn parse(value: &str) -> Option<Visibility> {
        match value {
            "private" => Some(Visibility::Private),
            "invite_only" => Some(Visibility::InviteOnly),
            "organization" => Some(Visibility::Organization),
            _ => None,
        }
    }

    /// Read a value already in the database, **failing closed**.
    ///
    /// A stored value nothing recognises becomes `Private` rather than an error, because the caller
    /// here is usually a listing that would otherwise fail wholesale over one bad row. Private is
    /// the safe reading: the cost of getting it wrong is a team nobody can discover, against a team
    /// everybody can join. A typo in this column must never open a team up.
    pub fn stored(value: &str, team_id: &str) -> Visibility {
        Visibility::parse(value).unwrap_or_else(|| {
            tracing::error!(
                "team {team_id} has unrecognised visibility {value:?}; treating it as private"
            );
            Visibility::Private
        })
    }

    pub const ALL: [Visibility; 3] = [
        Visibility::Private,
        Visibility::InviteOnly,
        Visibility::Organization,
    ];

    /// Whether a non-member can see that this team exists.
    pub fn is_discoverable(&self) -> bool {
        match self {
            Visibility::Private => false,
            Visibility::InviteOnly | Visibility::Organization => true,
        }
    }

    /// What a non-member may do about it.
    ///
    /// An explicit match rather than a derived default, for the reason `Role::can` is: a fourth
    /// visibility should be a compile error here, not a silent `Closed` that leaves a team
    /// discoverable and unjoinable.
    pub fn join_policy(&self) -> JoinPolicy {
        match self {
            Visibility::Private => JoinPolicy::Closed,
            Visibility::InviteOnly => JoinPolicy::ByRequest,
            Visibility::Organization => JoinPolicy::SelfServe,
        }
    }
}

impl fmt::Display for Visibility {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn visibilities_round_trip_through_their_stored_form() {
        for v in Visibility::ALL {
            assert_eq!(Visibility::parse(v.as_str()), Some(v));
        }
    }

    #[test]
    fn an_unknown_visibility_does_not_parse() {
        assert_eq!(Visibility::parse("public"), None);
        assert_eq!(Visibility::parse("Private"), None);
        assert_eq!(Visibility::parse(""), None);
    }

    /// The property that matters most: a value nobody understands must not make a team findable.
    #[test]
    fn an_unrecognised_stored_value_reads_as_private() {
        let v = Visibility::stored("world_readable", "team-1");
        assert_eq!(v, Visibility::Private);
        assert!(!v.is_discoverable());
        assert_eq!(v.join_policy(), JoinPolicy::Closed);
    }

    #[test]
    fn private_is_the_only_undiscoverable_one() {
        for v in Visibility::ALL {
            assert_eq!(
                v.is_discoverable(),
                v != Visibility::Private,
                "{v} discoverability"
            );
        }
    }

    /// The distinction the user asked for: both discoverable, differing only in whether joining
    /// needs an answer from someone.
    #[test]
    fn the_two_discoverable_values_differ_only_in_how_you_join() {
        assert!(Visibility::Organization.is_discoverable());
        assert!(Visibility::InviteOnly.is_discoverable());
        assert_eq!(
            Visibility::Organization.join_policy(),
            JoinPolicy::SelfServe
        );
        assert_eq!(Visibility::InviteOnly.join_policy(), JoinPolicy::ByRequest);
    }

    #[test]
    fn a_private_team_admits_nobody_of_their_own_accord() {
        assert_eq!(Visibility::Private.join_policy(), JoinPolicy::Closed);
    }
}
