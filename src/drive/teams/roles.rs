//! Team roles and the per-action permission matrix (issue #185, phase 6).
//!
//! The six roles are not a ladder and the matrix is not derivable from an ordering. A Contributor
//! may upload a file but may not delete one; a Viewer may read a page but not comment on the team;
//! a Guest may read only what has been shared with them explicitly. No integer rank expresses
//! "may add, may not remove", which is why `team_members.role` is text and why the matrix below is
//! written out in full rather than computed.
//!
//! Everything that touches a team resource goes through [`Role::can`]. That includes reads: a
//! non-member is not a Viewer with fewer rights, they have no role at all, and the service turns
//! that into a 404 rather than a 403 — whether a team exists is itself something membership
//! decides.

use std::fmt;

/// What someone may do inside a team.
///
/// Ordered here from most to least authority for readability only; nothing reads the order.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    /// Created the team, or was handed it. The only role that can delete the team or transfer
    /// ownership, and the only one that cannot be removed while it is the last of its kind.
    Owner,
    /// Everything an Owner can do except delete the team or change who owns it.
    Admin,
    /// Full authority over content — pages and files, including deleting them — and none over the
    /// team itself or its membership.
    Editor,
    /// Adds content but does not remove it. The role for someone who should be able to write a
    /// page and upload a file without being able to take down anyone else's.
    Contributor,
    /// Reads everything in the team, writes nothing.
    Viewer,
    /// Reads only, and is not counted as part of the team in the places that ask "who is on this
    /// team" — an outside collaborator brought in for one thing.
    Guest,
}

/// One thing that can be done to a team or something it owns.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TeamAction {
    ViewTeam,
    CreatePage,
    EditPage,
    DeletePage,
    UploadFile,
    DeleteFile,
    InviteMember,
    /// Answer a request to join an invite-only team. Distinct from `InviteMember` only in who
    /// started it — the authority is the same, so the two always agree in the matrix.
    ManageJoinRequests,
    ManagePermissions,
    ManageSettings,
    DeleteTeam,
}

impl TeamAction {
    /// Every action, so a test can walk the whole matrix instead of a hand-written subset of it.
    ///
    /// `Role::can` is what actually forces a new action to be decided — its match is exhaustive.
    /// This is for the tests, which previously listed the actions inline in two places and would
    /// have gone on passing while silently not covering a new one.
    pub const ALL: [TeamAction; 11] = [
        TeamAction::ViewTeam,
        TeamAction::CreatePage,
        TeamAction::EditPage,
        TeamAction::DeletePage,
        TeamAction::UploadFile,
        TeamAction::DeleteFile,
        TeamAction::InviteMember,
        TeamAction::ManageJoinRequests,
        TeamAction::ManagePermissions,
        TeamAction::ManageSettings,
        TeamAction::DeleteTeam,
    ];

    /// Every action except viewing — i.e. everything that changes something.
    pub fn writes() -> impl Iterator<Item = TeamAction> {
        TeamAction::ALL
            .into_iter()
            .filter(|a| *a != TeamAction::ViewTeam)
    }
}

impl Role {
    pub fn as_str(&self) -> &'static str {
        match self {
            Role::Owner => "owner",
            Role::Admin => "admin",
            Role::Editor => "editor",
            Role::Contributor => "contributor",
            Role::Viewer => "viewer",
            Role::Guest => "guest",
        }
    }

    /// Parse a stored role.
    ///
    /// An unrecognised value is `None` rather than a default, and the service treats that the same
    /// as no membership. A row whose role nothing understands is a row whose authority nothing can
    /// state, and guessing `Viewer` would silently grant read access on the strength of a typo.
    pub fn parse(value: &str) -> Option<Role> {
        match value {
            "owner" => Some(Role::Owner),
            "admin" => Some(Role::Admin),
            "editor" => Some(Role::Editor),
            "contributor" => Some(Role::Contributor),
            "viewer" => Some(Role::Viewer),
            "guest" => Some(Role::Guest),
            _ => None,
        }
    }

    /// Every role, for validating an incoming role name and for the tests that walk the matrix.
    pub const ALL: [Role; 6] = [
        Role::Owner,
        Role::Admin,
        Role::Editor,
        Role::Contributor,
        Role::Viewer,
        Role::Guest,
    ];

    /// The matrix.
    ///
    /// Written as an explicit match rather than a set of capability bits so that adding an action
    /// is a compile error in six places instead of a silently-false default — a new action that
    /// nobody can perform is a much better failure than one everybody can.
    pub fn can(&self, action: TeamAction) -> bool {
        use Role::*;
        use TeamAction::*;
        match action {
            // Every role is in the team, so every role can see it. Membership is the check that
            // matters here; it happens before this call.
            ViewTeam => true,

            CreatePage => matches!(self, Owner | Admin | Editor | Contributor),
            // A Contributor edits pages — including other people's. The line a Contributor does
            // not cross is destruction, not authorship; the version history makes an unwanted edit
            // recoverable, which is what makes that safe.
            EditPage => matches!(self, Owner | Admin | Editor | Contributor),
            DeletePage => matches!(self, Owner | Admin | Editor),

            UploadFile => matches!(self, Owner | Admin | Editor | Contributor),
            DeleteFile => matches!(self, Owner | Admin | Editor),

            InviteMember => matches!(self, Owner | Admin),
            // Approving a request admits someone to the team, which is inviting them by another
            // route. Anyone who could not have invited them must not be able to let them in.
            ManageJoinRequests => matches!(self, Owner | Admin),
            ManagePermissions => matches!(self, Owner | Admin),
            ManageSettings => matches!(self, Owner | Admin),

            // Deleting the team takes everything with it, so it stays with whoever owns it.
            DeleteTeam => matches!(self, Owner),
        }
    }
}

impl fmt::Display for Role {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn roles_round_trip_through_their_stored_form() {
        for role in Role::ALL {
            assert_eq!(Role::parse(role.as_str()), Some(role));
        }
    }

    /// An unknown role grants nothing, rather than defaulting to the weakest real role.
    #[test]
    fn unknown_role_does_not_parse() {
        assert_eq!(Role::parse("superuser"), None);
        assert_eq!(Role::parse(""), None);
        assert_eq!(Role::parse("Owner"), None);
    }

    #[test]
    fn only_the_owner_can_delete_the_team() {
        for role in Role::ALL {
            assert_eq!(
                role.can(TeamAction::DeleteTeam),
                role == Role::Owner,
                "{role} and DeleteTeam"
            );
        }
    }

    #[test]
    fn membership_alone_grants_view() {
        for role in Role::ALL {
            assert!(role.can(TeamAction::ViewTeam), "{role} cannot view");
        }
    }

    /// The distinction the whole role exists for.
    #[test]
    fn contributor_adds_but_does_not_remove() {
        let r = Role::Contributor;
        assert!(r.can(TeamAction::CreatePage));
        assert!(r.can(TeamAction::EditPage));
        assert!(r.can(TeamAction::UploadFile));
        assert!(!r.can(TeamAction::DeletePage));
        assert!(!r.can(TeamAction::DeleteFile));
    }

    #[test]
    fn viewer_and_guest_write_nothing() {
        for role in [Role::Viewer, Role::Guest] {
            for action in TeamAction::writes() {
                assert!(!role.can(action), "{role} should not be able to {action:?}");
            }
        }
    }

    /// An Editor has every authority over content and none over the team.
    #[test]
    fn editor_owns_content_not_the_team() {
        let r = Role::Editor;
        assert!(r.can(TeamAction::DeletePage));
        assert!(r.can(TeamAction::DeleteFile));
        assert!(!r.can(TeamAction::InviteMember));
        assert!(!r.can(TeamAction::ManagePermissions));
        assert!(!r.can(TeamAction::ManageSettings));
    }

    #[test]
    fn admin_matches_owner_on_everything_but_deleting_the_team() {
        for action in TeamAction::ALL {
            if action == TeamAction::DeleteTeam {
                continue;
            }
            assert_eq!(
                Role::Admin.can(action),
                Role::Owner.can(action),
                "admin and owner disagree on {action:?}"
            );
        }
        assert!(!Role::Admin.can(TeamAction::DeleteTeam));
    }

    /// Letting someone in by approving their request is the same authority as inviting them, and
    /// the matrix must not drift apart on the two routes to the same outcome.
    #[test]
    fn answering_a_join_request_takes_the_same_authority_as_inviting() {
        for role in Role::ALL {
            assert_eq!(
                role.can(TeamAction::ManageJoinRequests),
                role.can(TeamAction::InviteMember),
                "{role} can do one of invite/approve but not the other"
            );
        }
    }
}
