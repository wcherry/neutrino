//! Team Spaces business rules (issue #185).
//!
//! Two invariants run through everything here and are worth stating once rather than at each call
//! site.
//!
//! **A team a caller has no role in does not exist.** Every entry point resolves the caller's
//! membership first and answers 404 when there is none — never 403. 403 would confirm the team
//! exists and say only that this person may not have it, which is a fact about the organisation
//! that a stranger could harvest by walking team ids. Inside a team, where membership is already
//! established, refusing an action *is* a 403: the actor can already see the thing they are being
//! refused.
//!
//! **An archived team is read-only.** Archiving is the pause button, not the delete button, so a
//! caller keeps every read they had and loses every write, including writes their role would
//! otherwise allow. Un-archiving is itself a write, and is the one exception — an Owner or Admin
//! can always reach it.

use chrono::NaiveDateTime;
use std::sync::Arc;
use uuid::Uuid;

use super::dto::*;
use super::model::*;
use super::repository::TeamsRepository;
use super::roles::{Role, TeamAction};
use super::visibility::{JoinPolicy, Visibility};
use crate::drive::activity::service::ActivityService;
use crate::drive::feature_flags::gate::FeatureGate;
use crate::shared::{ApiError, AuthenticatedUser};

/// The flag every team route is behind — the only one.
///
/// Team Spaces was specified with per-phase sub-flags beside this (`teamSpacesPages`,
/// `teamSpacesFiles`, `teamSpacesActivity`) and deliberately does not have them. Each would have
/// been defensible on its own, which is precisely how the system this replaces reached fifteen
/// keys; and the phases are not separately shippable anyway, since a team whose wiki is switched
/// off is a navigation entry leading to a page that says a feature is missing. One feature, one
/// switch: Team Spaces is on, or it is off.
pub const FLAG_TEAM_SPACES: &str = "teamSpaces";

/// The markdown a team's Home page is created with.
///
/// A blank page is a worse starting point than a wrong one: it gives a new team nothing to react to
/// and no demonstration that the page is editable at all. Phase 9 replaces this with configurable
/// widgets; until then the headings are the shape the widgets will fill.
fn home_page_markdown(team_name: &str) -> String {
    format!(
        "# Welcome to {team_name}\n\n\
         This is your team's home page. Everyone in the team can read it, and editors can change \
         it — including this paragraph.\n\n\
         ## What we're working on\n\n\
         _Replace this with your team's current focus._\n\n\
         ## Quick links\n\n\
         - [ ] Add a link to your team's most-used document\n\
         - [ ] Write an onboarding page for new members\n\n\
         ## Recent activity\n\n\
         _Files and pages your team has changed recently will appear here._\n"
    )
}

/// Turn a title into a URL-stable slug.
///
/// Anything that is not an ASCII letter, digit or hyphen becomes a hyphen, runs collapse, and the
/// ends are trimmed. A title with no usable characters at all — an emoji, a title in a script this
/// does not transliterate — yields an empty string, and the caller falls back to a generated id
/// rather than to a slug that would collide with every other such title.
pub fn slugify(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    let mut last_was_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            last_was_dash = false;
        } else if !last_was_dash && !out.is_empty() {
            out.push('-');
            last_was_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    out.truncate(64);
    while out.ends_with('-') {
        out.pop();
    }
    out
}

/// The role someone gets by joining a team themselves, or by having their request approved without
/// a role being named.
///
/// Least privilege, deliberately. The team's owner chose to make it findable and joinable; they did
/// not thereby say that anyone who wanders in may rewrite the wiki. A Viewer reads everything and
/// changes nothing, and an Admin promotes them in one click — which is the recoverable direction to
/// be wrong in. Granting Contributor by default would mean that making a team discoverable silently
/// granted write access to everyone in the deployment, which is not what the setting says it does.
///
/// An approval can name a different role, so an admin who wants a new joiner writing straight away
/// says so at the point of admitting them.
const DEFAULT_JOIN_ROLE: Role = Role::Viewer;

fn parse_visibility(value: &str) -> Result<Visibility, ApiError> {
    Visibility::parse(value).ok_or_else(|| {
        ApiError::bad_request(
            "Visibility must be private, invite_only or organization",
        )
    })
}

pub struct TeamsService {
    repo: Arc<TeamsRepository>,
    activity: Arc<ActivityService>,
    gate: FeatureGate,
}

impl TeamsService {
    pub fn new(
        repo: Arc<TeamsRepository>,
        activity: Arc<ActivityService>,
        gate: FeatureGate,
    ) -> Self {
        Self {
            repo,
            activity,
            gate,
        }
    }

    fn now() -> NaiveDateTime {
        chrono::Local::now().naive_local()
    }

    // ── Access ───────────────────────────────────────────────────────────────

    /// Resolve the team and the caller's role in it, or 404.
    ///
    /// An admin is *not* given a role here. Being a Neutrino administrator is authority over the
    /// deployment, not membership of every team on it, and a team's wiki is exactly the kind of
    /// content where the difference matters. Administration reaches team content through the admin
    /// surfaces, which log the access.
    fn resolve(&self, team_id: &str, user: &AuthenticatedUser) -> Result<(Team, Role), ApiError> {
        let team = self
            .repo
            .find(team_id)?
            .ok_or_else(|| ApiError::not_found("Team not found"))?;

        let member = self
            .repo
            .find_member(team_id, &user.user_id)?
            .ok_or_else(|| ApiError::not_found("Team not found"))?;

        // A role string nothing recognises grants nothing, and is indistinguishable from having no
        // membership at all — see `Role::parse`.
        let role = Role::parse(&member.role).ok_or_else(|| {
            tracing::error!(
                "team_members row {} has unrecognised role {:?}",
                member.id,
                member.role
            );
            ApiError::not_found("Team not found")
        })?;

        Ok((team, role))
    }

    /// Resolve, then check one action against the caller's role and the team's archived state.
    fn authorize(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
        action: TeamAction,
    ) -> Result<(Team, Role), ApiError> {
        let (team, role) = self.resolve(team_id, user)?;
        if !role.can(action) {
            return Err(ApiError::forbidden(format!(
                "A {role} cannot do this in this team"
            )));
        }
        if team.is_archived() && action != TeamAction::ViewTeam {
            return Err(ApiError::forbidden(
                "This team is archived. Restore it before making changes.",
            ));
        }
        Ok((team, role))
    }

    fn log(&self, team: &Team, user: &AuthenticatedUser, action: &str, detail: serde_json::Value) {
        // Logged against the team's id in the shared activity table with `resource_type` set to
        // `team`, so the existing retention, export and admin tooling covers team activity without
        // learning about a second table.
        if let Err(e) = self.activity.log_with_context(
            &team.id,
            &user.user_id,
            &user.email,
            action,
            Some(detail),
            Some("team"),
            None,
            None,
        ) {
            // Activity is a record of the write, not part of it. Failing the caller's request
            // because the log could not be written would turn a bookkeeping fault into a lost
            // page.
            tracing::warn!("failed to log team activity {}: {:?}", action, e);
        }
    }

    /// A slug for `name` that no live team is using, disambiguated with a counter when needed.
    fn unique_team_slug(&self, name: &str) -> Result<String, ApiError> {
        let base = slugify(name);
        let base = if base.is_empty() {
            format!("team-{}", &Uuid::new_v4().to_string()[..8])
        } else {
            base
        };
        if !self.repo.slug_taken(&base)? {
            return Ok(base);
        }
        for n in 2..100 {
            let candidate = format!("{base}-{n}");
            if !self.repo.slug_taken(&candidate)? {
                return Ok(candidate);
            }
        }
        // A hundred teams called the same thing is not a naming collision to resolve, it is a
        // suffix to stop guessing at.
        Ok(format!("{base}-{}", &Uuid::new_v4().to_string()[..8]))
    }

    // ── Teams ────────────────────────────────────────────────────────────────

    pub fn list_teams(&self, user: &AuthenticatedUser) -> Result<TeamListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;

        let teams = self.repo.list_for_user(&user.user_id)?;
        let mut out = Vec::with_capacity(teams.len());
        for team in teams {
            let member_count = self.repo.count_members(&team.id)?;
            let role = self
                .repo
                .find_member(&team.id, &user.user_id)?
                .map(|m| m.role)
                .unwrap_or_default();
            out.push(TeamResponse::build(team, member_count, role));
        }
        Ok(TeamListResponse {
            total: out.len() as i64,
            teams: out,
        })
    }

    pub fn get_team(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, role) = self.authorize(team_id, user, TeamAction::ViewTeam)?;
        let member_count = self.repo.count_members(&team.id)?;
        Ok(TeamResponse::build(team, member_count, role.to_string()))
    }

    /// Create a team, its creator's Owner membership and its Home page, together.
    ///
    /// The Home page is created here rather than lazily on first visit because the partial unique
    /// index in 00127 makes "exactly one Home page" a property of the table, and a team that has
    /// not been visited yet would otherwise violate the thing the rest of the code is allowed to
    /// assume.
    pub fn create_team(
        &self,
        req: CreateTeamRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;

        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("A team needs a name"));
        }
        if name.chars().count() > 120 {
            return Err(ApiError::bad_request(
                "A team name can be at most 120 characters",
            ));
        }
        let visibility = match req.visibility.as_deref() {
            Some(v) => parse_visibility(v)?,
            None => Visibility::Private,
        };

        let now = Self::now();
        let team_id = Uuid::new_v4().to_string();
        let slug = self.unique_team_slug(name)?;

        self.repo.insert_team(&NewTeam {
            id: team_id.clone(),
            name: name.to_string(),
            slug,
            description: req.description.map(|d| d.trim().to_string()),
            avatar_color: req.avatar_color,
            avatar_emoji: req.avatar_emoji,
            visibility: visibility.as_str().to_string(),
            created_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        self.repo.insert_member(&NewTeamMember {
            id: Uuid::new_v4().to_string(),
            team_id: team_id.clone(),
            user_id: user.user_id.clone(),
            user_email: user.email.clone(),
            // The users table is not read here: the token already carries who this is, and a team's
            // member list is denormalised anyway. A display name arrives when the row is next
            // touched by an invitation, which does read the users table.
            user_name: user.email.clone(),
            role: Role::Owner.as_str().to_string(),
            added_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        let home_id = Uuid::new_v4().to_string();
        self.repo.insert_page(&NewTeamPage {
            id: home_id.clone(),
            team_id: team_id.clone(),
            parent_page_id: None,
            title: "Home".to_string(),
            slug: "home".to_string(),
            content_md: home_page_markdown(name),
            icon: Some("🏠".to_string()),
            sort_order: 0,
            is_home: 1,
            created_by: user.user_id.clone(),
            last_edited_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        self.repo.update_team(
            &team_id,
            None,
            None,
            None,
            None,
            None,
            None,
            Some(&home_id),
            None,
            now,
        )?;

        let team = self
            .repo
            .find(&team_id)?
            .ok_or_else(|| ApiError::internal("Team disappeared immediately after creation"))?;
        self.log(
            &team,
            user,
            "team.created",
            serde_json::json!({ "name": team.name }),
        );

        Ok(TeamResponse::build(team, 1, Role::Owner.to_string()))
    }

    pub fn update_team(
        &self,
        team_id: &str,
        req: UpdateTeamRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;

        // Un-archiving has to be reachable on a team that is archived, and `authorize` refuses
        // every write on one — so restoring is checked against the role directly.
        let (team, role) = if req.archived == Some(false) {
            let (team, role) = self.resolve(team_id, user)?;
            if !role.can(TeamAction::ManageSettings) {
                return Err(ApiError::forbidden(format!(
                    "A {role} cannot restore this team"
                )));
            }
            (team, role)
        } else {
            self.authorize(team_id, user, TeamAction::ManageSettings)?
        };

        if let Some(name) = req.name.as_deref() {
            if name.trim().is_empty() {
                return Err(ApiError::bad_request("A team needs a name"));
            }
        }
        let new_visibility = req.visibility.as_deref().map(parse_visibility).transpose()?;

        // A rename does not move the team. The slug is what links point at, so changing it would
        // break every bookmark into the space for the sake of a tidier URL.
        let name = req.name.as_deref().map(str::trim);
        let now = Self::now();
        self.repo.update_team(
            team_id,
            name,
            None,
            req.description.as_ref().map(|d| d.as_deref()),
            req.avatar_color.as_ref().map(|d| d.as_deref()),
            req.avatar_emoji.as_ref().map(|d| d.as_deref()),
            req.visibility.as_deref(),
            req.default_page_id.as_deref(),
            req.archived,
            now,
        )?;

        // Who can find the team, and how they get into it, is worth its own entry rather than
        // being folded into a generic "updated" — opening a team up is the kind of change someone
        // reads the feed to find. Pending requests are deliberately left alone by a change of
        // visibility: approving one is only ever an admin admitting someone they could have
        // invited outright.
        if let Some(v) = new_visibility {
            if v.as_str() != team.visibility {
                self.log(
                    &team,
                    user,
                    "team.visibility_changed",
                    serde_json::json!({ "from": team.visibility, "to": v.as_str() }),
                );
            }
        }

        if let Some(archived) = req.archived {
            self.log(
                &team,
                user,
                if archived {
                    "team.archived"
                } else {
                    "team.restored"
                },
                serde_json::json!({ "name": team.name }),
            );
        } else {
            self.log(
                &team,
                user,
                "team.updated",
                serde_json::json!({ "name": name.unwrap_or(&team.name) }),
            );
        }

        let updated = self
            .repo
            .find(team_id)?
            .ok_or_else(|| ApiError::not_found("Team not found"))?;
        let member_count = self.repo.count_members(team_id)?;
        Ok(TeamResponse::build(
            updated,
            member_count,
            role.to_string(),
        ))
    }

    pub fn delete_team(&self, team_id: &str, user: &AuthenticatedUser) -> Result<(), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        // Deleting an archived team has to work — archiving is often the step before deleting —
        // so this resolves and checks the role rather than going through `authorize`.
        let (team, role) = self.resolve(team_id, user)?;
        if !role.can(TeamAction::DeleteTeam) {
            return Err(ApiError::forbidden("Only the team's owner can delete it"));
        }

        self.log(
            &team,
            user,
            "team.deleted",
            serde_json::json!({ "name": team.name }),
        );
        self.repo.soft_delete_team(team_id, Self::now())
    }

    // ── Discovery and joining ────────────────────────────────────────────────

    /// The teams the caller could join but is not in.
    ///
    /// This is the one read in the whole module that a non-member is allowed, and it is why
    /// `visibility` exists. It returns [`DiscoverableTeamResponse`], never [`TeamResponse`]: a
    /// caller with no role must not receive the members' view of a team, and keeping them separate
    /// types is what stops that happening by accident later.
    pub fn list_discoverable(
        &self,
        user: &AuthenticatedUser,
    ) -> Result<DiscoverableTeamListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;

        let teams = self.repo.list_discoverable_for_user(&user.user_id)?;
        let pending = self.repo.teams_with_open_request(&user.user_id)?;

        let mut out = Vec::with_capacity(teams.len());
        for team in teams {
            let visibility = Visibility::stored(&team.visibility, &team.id);
            // `list_discoverable_for_user` filters on the same rule, so this only fires for a row
            // whose stored value nothing recognises — which `stored` has already downgraded to
            // private and logged.
            if !visibility.is_discoverable() {
                continue;
            }
            let member_count = self.repo.count_members(&team.id)?;
            let join_action = match visibility.join_policy() {
                JoinPolicy::SelfServe => "join",
                JoinPolicy::ByRequest if pending.contains(&team.id) => "requested",
                JoinPolicy::ByRequest => "request",
                JoinPolicy::Closed => continue,
            };
            out.push(DiscoverableTeamResponse {
                id: team.id,
                name: team.name,
                slug: team.slug,
                description: team.description,
                avatar_color: team.avatar_color,
                avatar_emoji: team.avatar_emoji,
                visibility: visibility.as_str().to_string(),
                member_count,
                join_action: join_action.to_string(),
                created_at: team.created_at.to_string(),
            });
        }

        Ok(DiscoverableTeamListResponse {
            total: out.len() as i64,
            teams: out,
        })
    }

    /// Find a team a non-member is allowed to act on, by the rules of its visibility.
    ///
    /// A private team is 404 here exactly as it is everywhere else — this is the entry point that
    /// could most easily become the leak the 404 rule exists to prevent, since it is the one place
    /// a non-member is expected. So it answers 404 for: no such team, a deleted team, a private
    /// team, and a team whose stored visibility is unreadable.
    fn resolve_joinable(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(Team, Visibility), ApiError> {
        let team = self
            .repo
            .find(team_id)?
            .ok_or_else(|| ApiError::not_found("Team not found"))?;

        let visibility = Visibility::stored(&team.visibility, &team.id);
        if !visibility.is_discoverable() {
            return Err(ApiError::not_found("Team not found"));
        }

        // Already in it. A 409 rather than a 404: they can see this team, so there is nothing to
        // hide, and "you are already a member" is the useful answer.
        if self.repo.find_member(team_id, &user.user_id)?.is_some() {
            return Err(ApiError::conflict("You are already in this team"));
        }

        // Findable but not joinable. Every write is refused in an archived team, so admitting
        // someone would hand them a room they cannot act in.
        if team.is_archived() {
            return Err(ApiError::conflict(
                "This team is archived and is not accepting new members",
            ));
        }

        Ok((team, visibility))
    }

    /// Add yourself to an `organization` team.
    pub fn join_team(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamMemberResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, visibility) = self.resolve_joinable(team_id, user)?;

        match visibility.join_policy() {
            JoinPolicy::SelfServe => {}
            // Discoverable, but not like this. 403 rather than 404 because the caller can already
            // see the team; what they may not do is walk in without being asked.
            JoinPolicy::ByRequest => {
                return Err(ApiError::forbidden(
                    "This team is invite only. Request access instead.",
                ))
            }
            JoinPolicy::Closed => return Err(ApiError::not_found("Team not found")),
        }

        let now = Self::now();
        let (user_id, user_email, user_name) = self.identify(user)?;

        self.repo.insert_member(&NewTeamMember {
            id: Uuid::new_v4().to_string(),
            team_id: team_id.to_string(),
            user_id: user_id.clone(),
            user_email: user_email.clone(),
            user_name: user_name.clone(),
            role: DEFAULT_JOIN_ROLE.as_str().to_string(),
            // Nobody added them. Recording them as their own sponsor is the truth of a self-serve
            // join and keeps the column non-null without inventing an admin who did it.
            added_by: user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        self.log(
            &team,
            user,
            "team.member_joined",
            serde_json::json!({ "member": user_email, "role": DEFAULT_JOIN_ROLE.as_str() }),
        );

        Ok(TeamMemberResponse {
            user_id,
            email: user_email,
            name: user_name,
            role: DEFAULT_JOIN_ROLE.as_str().to_string(),
            added_by: user.user_id.clone(),
            created_at: now.to_string(),
        })
    }

    /// Ask to join an `invite_only` team.
    pub fn request_access(
        &self,
        team_id: &str,
        req: RequestAccessRequest,
        user: &AuthenticatedUser,
    ) -> Result<JoinRequestResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, visibility) = self.resolve_joinable(team_id, user)?;

        match visibility.join_policy() {
            JoinPolicy::ByRequest => {}
            // Nothing to ask for — they can simply join. A 400 rather than silently minting a
            // request nobody would ever look at.
            JoinPolicy::SelfServe => {
                return Err(ApiError::bad_request(
                    "Anyone can join this team; no request is needed.",
                ))
            }
            JoinPolicy::Closed => return Err(ApiError::not_found("Team not found")),
        }

        if self
            .repo
            .find_open_join_request(team_id, &user.user_id)?
            .is_some()
        {
            return Err(ApiError::conflict(
                "You have already asked to join this team",
            ));
        }

        let message = req
            .message
            .map(|m| m.trim().to_string())
            .filter(|m| !m.is_empty());
        if let Some(m) = message.as_deref() {
            if m.chars().count() > 500 {
                return Err(ApiError::bad_request(
                    "A request message can be at most 500 characters",
                ));
            }
        }

        let now = Self::now();
        let (user_id, user_email, user_name) = self.identify(user)?;
        let id = Uuid::new_v4().to_string();

        self.repo.insert_join_request(&NewTeamJoinRequest {
            id: id.clone(),
            team_id: team_id.to_string(),
            user_id: user_id.clone(),
            user_email: user_email.clone(),
            user_name: user_name.clone(),
            message: message.clone(),
            status: RequestStatus::PENDING.to_string(),
            created_at: now,
            updated_at: now,
        })?;

        self.log(
            &team,
            user,
            "team.access_requested",
            serde_json::json!({ "requester": user_email }),
        );

        Ok(JoinRequestResponse {
            id,
            team_id: team_id.to_string(),
            user_id,
            email: user_email,
            name: user_name,
            message,
            status: RequestStatus::PENDING.to_string(),
            decided_by: None,
            decided_at: None,
            created_at: now.to_string(),
        })
    }

    /// The team's join requests — pending by default.
    pub fn list_join_requests(
        &self,
        team_id: &str,
        status: Option<&str>,
        user: &AuthenticatedUser,
    ) -> Result<JoinRequestListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ManageJoinRequests)?;

        let status = status.unwrap_or(RequestStatus::PENDING);
        if !matches!(
            status,
            RequestStatus::PENDING | RequestStatus::APPROVED | RequestStatus::DECLINED
        ) {
            return Err(ApiError::bad_request(
                "Status must be pending, approved or declined",
            ));
        }

        let requests = self.repo.list_join_requests(team_id, status)?;
        Ok(JoinRequestListResponse {
            total: requests.len() as i64,
            requests: requests.into_iter().map(Into::into).collect(),
        })
    }

    /// Approve a request, admitting the requester.
    pub fn approve_join_request(
        &self,
        team_id: &str,
        request_id: &str,
        req: ApproveJoinRequestRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamMemberResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, actor_role) = self.authorize(team_id, user, TeamAction::ManageJoinRequests)?;

        let role = match req.role.as_deref() {
            Some(r) => Role::parse(r)
                .ok_or_else(|| ApiError::bad_request(format!("Unknown role {r:?}")))?,
            None => DEFAULT_JOIN_ROLE,
        };
        // The same escalation rule `add_member` applies: admitting someone into more authority
        // than the admitter holds is not an approval.
        if role == Role::Owner && actor_role != Role::Owner {
            return Err(ApiError::forbidden(
                "Only an owner can make someone else an owner",
            ));
        }

        let request = self.pending_request(team_id, request_id)?;

        // They may have been added by hand while the request sat in the queue. Answering it is
        // still the right outcome — the queue should not keep showing a request that is moot —
        // but there is no second membership to write.
        if self
            .repo
            .find_member(team_id, &request.user_id)?
            .is_some()
        {
            self.repo.decide_join_request(
                &request.id,
                RequestStatus::APPROVED,
                &user.user_id,
                Self::now(),
            )?;
            return Err(ApiError::conflict(
                "That person is already in this team; the request has been closed",
            ));
        }

        let now = Self::now();
        self.repo.insert_member(&NewTeamMember {
            id: Uuid::new_v4().to_string(),
            team_id: team_id.to_string(),
            user_id: request.user_id.clone(),
            user_email: request.user_email.clone(),
            user_name: request.user_name.clone(),
            role: role.as_str().to_string(),
            added_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;
        self.repo
            .decide_join_request(&request.id, RequestStatus::APPROVED, &user.user_id, now)?;

        self.log(
            &team,
            user,
            "team.request_approved",
            serde_json::json!({ "member": request.user_email, "role": role.as_str() }),
        );

        Ok(TeamMemberResponse {
            user_id: request.user_id,
            email: request.user_email,
            name: request.user_name,
            role: role.as_str().to_string(),
            added_by: user.user_id.clone(),
            created_at: now.to_string(),
        })
    }

    /// Decline a request. The row is kept, so the same person does not reappear in the queue
    /// tomorrow with nothing to say they were already answered.
    pub fn decline_join_request(
        &self,
        team_id: &str,
        request_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::ManageJoinRequests)?;

        let request = self.pending_request(team_id, request_id)?;
        self.repo.decide_join_request(
            &request.id,
            RequestStatus::DECLINED,
            &user.user_id,
            Self::now(),
        )?;

        self.log(
            &team,
            user,
            "team.request_declined",
            serde_json::json!({ "requester": request.user_email }),
        );
        Ok(())
    }

    /// A request that exists, belongs to this team and has not been answered yet.
    fn pending_request(
        &self,
        team_id: &str,
        request_id: &str,
    ) -> Result<TeamJoinRequest, ApiError> {
        let request = self
            .repo
            .find_join_request(team_id, request_id)?
            .ok_or_else(|| ApiError::not_found("No such join request in this team"))?;

        if request.status != RequestStatus::PENDING {
            return Err(ApiError::conflict(format!(
                "That request was already {}",
                request.status
            )));
        }
        Ok(request)
    }

    /// The caller's id, email and display name for a membership row they create for themselves.
    ///
    /// The id is always the token's, never the looked-up row's: the token is what authenticated
    /// this request, and writing a membership for whatever id an email lookup happened to return
    /// would be a way to act as someone else if the two ever disagreed. The lookup supplies only
    /// the display name, which the token does not carry and which a member list needs — a row
    /// showing an email where every other row shows a name reads as a bug. The email stands in when
    /// there is no row, the same fallback `create_team` uses.
    fn identify(&self, user: &AuthenticatedUser) -> Result<(String, String, String), ApiError> {
        let email = user.email.trim().to_lowercase();
        let name = self
            .repo
            .find_user_by_email(&email)?
            .map(|(_, _, name)| name)
            .unwrap_or_else(|| user.email.clone());
        Ok((user.user_id.clone(), user.email.clone(), name))
    }

    // ── Members ──────────────────────────────────────────────────────────────

    pub fn list_members(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamMemberListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ViewTeam)?;
        let members = self.repo.list_members(team_id)?;
        Ok(TeamMemberListResponse {
            total: members.len() as i64,
            members: members.into_iter().map(Into::into).collect(),
        })
    }

    pub fn add_member(
        &self,
        team_id: &str,
        req: AddMemberRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamMemberResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, actor_role) = self.authorize(team_id, user, TeamAction::InviteMember)?;

        let role = Role::parse(&req.role)
            .ok_or_else(|| ApiError::bad_request(format!("Unknown role {:?}", req.role)))?;
        // Otherwise an Admin could mint an Owner and then be removed by them — inviting someone
        // into more authority than the inviter holds is an escalation, not an invitation.
        if role == Role::Owner && actor_role != Role::Owner {
            return Err(ApiError::forbidden(
                "Only an owner can make someone else an owner",
            ));
        }

        let email = req.email.trim().to_lowercase();
        let (user_id, user_email, user_name) = self
            .repo
            .find_user_by_email(&email)?
            // Named rather than generic: this is a team owner typing a colleague's address, and
            // "no account" is the actionable answer. It reveals only what an invitation reveals.
            .ok_or_else(|| ApiError::not_found("No Neutrino account has that email address"))?;

        if self.repo.find_member(team_id, &user_id)?.is_some() {
            return Err(ApiError::conflict("That person is already in this team"));
        }

        let now = Self::now();
        self.repo.insert_member(&NewTeamMember {
            id: Uuid::new_v4().to_string(),
            team_id: team_id.to_string(),
            user_id: user_id.clone(),
            user_email: user_email.clone(),
            user_name: user_name.clone(),
            role: role.as_str().to_string(),
            added_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        self.log(
            &team,
            user,
            "team.member_added",
            serde_json::json!({ "member": user_email, "role": role.as_str() }),
        );

        Ok(TeamMemberResponse {
            user_id,
            email: user_email,
            name: user_name,
            role: role.as_str().to_string(),
            added_by: user.user_id.clone(),
            created_at: now.to_string(),
        })
    }

    pub fn update_member(
        &self,
        team_id: &str,
        member_user_id: &str,
        req: UpdateMemberRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamMemberResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, actor_role) = self.authorize(team_id, user, TeamAction::ManagePermissions)?;

        let new_role = Role::parse(&req.role)
            .ok_or_else(|| ApiError::bad_request(format!("Unknown role {:?}", req.role)))?;
        let existing = self
            .repo
            .find_member(team_id, member_user_id)?
            .ok_or_else(|| ApiError::not_found("That person is not in this team"))?;
        let existing_role = Role::parse(&existing.role);

        if new_role == Role::Owner && actor_role != Role::Owner {
            return Err(ApiError::forbidden(
                "Only an owner can make someone else an owner",
            ));
        }
        // The check that keeps a team reachable. Demoting the last owner leaves a team nobody can
        // delete, rename or hand on — recoverable only by an administrator going into the database.
        if existing_role == Some(Role::Owner)
            && new_role != Role::Owner
            && self.repo.count_with_role(team_id, Role::Owner.as_str())? <= 1
        {
            return Err(ApiError::conflict(
                "This is the team's only owner. Make someone else an owner first.",
            ));
        }

        let now = Self::now();
        self.repo
            .update_member_role(team_id, member_user_id, new_role.as_str(), now)?;
        self.log(
            &team,
            user,
            "team.member_role_changed",
            serde_json::json!({ "member": existing.user_email, "role": new_role.as_str() }),
        );

        Ok(TeamMemberResponse {
            role: new_role.as_str().to_string(),
            ..existing.into()
        })
    }

    pub fn remove_member(
        &self,
        team_id: &str,
        member_user_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;

        // Leaving a team is not managing its permissions, so it is allowed to anyone in it —
        // including a Viewer, who can manage nothing else.
        let leaving = member_user_id == user.user_id;
        let (team, _) = if leaving {
            self.resolve(team_id, user)?
        } else {
            self.authorize(team_id, user, TeamAction::ManagePermissions)?
        };

        let existing = self
            .repo
            .find_member(team_id, member_user_id)?
            .ok_or_else(|| ApiError::not_found("That person is not in this team"))?;

        if Role::parse(&existing.role) == Some(Role::Owner)
            && self.repo.count_with_role(team_id, Role::Owner.as_str())? <= 1
        {
            return Err(ApiError::conflict(
                "This is the team's only owner. Make someone else an owner first.",
            ));
        }

        self.repo.remove_member(team_id, member_user_id)?;
        self.log(
            &team,
            user,
            if leaving {
                "team.member_left"
            } else {
                "team.member_removed"
            },
            serde_json::json!({ "member": existing.user_email }),
        );
        Ok(())
    }

    // ── Pages ────────────────────────────────────────────────────────────────

    pub fn list_pages(
        &self,
        team_id: &str,
        query: Option<&str>,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ViewTeam)?;

        let pages = match query.map(str::trim).filter(|q| !q.is_empty()) {
            Some(q) => self.repo.search_pages(team_id, q)?,
            None => self.repo.list_pages(team_id)?,
        };
        Ok(TeamPageListResponse {
            total: pages.len() as i64,
            pages: pages.into_iter().map(TeamPageResponse::summary).collect(),
        })
    }

    pub fn get_page(
        &self,
        team_id: &str,
        page_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ViewTeam)?;

        let page = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;
        Ok(TeamPageResponse::with_content(page))
    }

    pub fn create_page(
        &self,
        team_id: &str,
        req: CreatePageRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::CreatePage)?;

        let title = req.title.trim();
        if title.is_empty() {
            return Err(ApiError::bad_request("A page needs a title"));
        }

        if let Some(parent) = req.parent_page_id.as_deref() {
            if self.repo.find_page(team_id, parent)?.is_none() {
                return Err(ApiError::bad_request("That parent page is not in this team"));
            }
        }

        let now = Self::now();
        let page_id = Uuid::new_v4().to_string();
        let slug = self.unique_page_slug(team_id, title)?;

        self.repo.insert_page(&NewTeamPage {
            id: page_id.clone(),
            team_id: team_id.to_string(),
            parent_page_id: req.parent_page_id,
            title: title.to_string(),
            slug,
            content_md: req.content_md.unwrap_or_default(),
            icon: req.icon,
            sort_order: 0,
            is_home: 0,
            created_by: user.user_id.clone(),
            last_edited_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        self.log(
            &team,
            user,
            "team.page_created",
            serde_json::json!({ "page": title }),
        );

        let page = self
            .repo
            .find_page(team_id, &page_id)?
            .ok_or_else(|| ApiError::internal("Page disappeared immediately after creation"))?;
        Ok(TeamPageResponse::with_content(page))
    }

    fn unique_page_slug(&self, team_id: &str, title: &str) -> Result<String, ApiError> {
        let base = slugify(title);
        let base = if base.is_empty() {
            format!("page-{}", &Uuid::new_v4().to_string()[..8])
        } else {
            base
        };
        if !self.repo.page_slug_taken(team_id, &base)? {
            return Ok(base);
        }
        for n in 2..100 {
            let candidate = format!("{base}-{n}");
            if !self.repo.page_slug_taken(team_id, &candidate)? {
                return Ok(candidate);
            }
        }
        Ok(format!("{base}-{}", &Uuid::new_v4().to_string()[..8]))
    }

    /// Whether making `new_parent` the parent of `page_id` would close a loop.
    ///
    /// Walks up from the proposed parent looking for the page being moved. The database cannot
    /// express this — a cycle satisfies every foreign key — and a cycle is not a cosmetic problem:
    /// the sidebar's tree walk and the recursive delete below would both spin forever on one.
    fn would_create_cycle(
        &self,
        team_id: &str,
        page_id: &str,
        new_parent: &str,
    ) -> Result<bool, ApiError> {
        if page_id == new_parent {
            return Ok(true);
        }
        let mut cursor = Some(new_parent.to_string());
        // A wiki nested five hundred deep is a cycle the walk has not closed yet, or a tree nobody
        // can navigate. Either way, refusing is right.
        for _ in 0..500 {
            let Some(current) = cursor else {
                return Ok(false);
            };
            if current == page_id {
                return Ok(true);
            }
            cursor = self
                .repo
                .find_page(team_id, &current)?
                .and_then(|p| p.parent_page_id);
        }
        Ok(true)
    }

    pub fn update_page(
        &self,
        team_id: &str,
        page_id: &str,
        req: UpdatePageRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::EditPage)?;

        let page = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;

        if let Some(title) = req.title.as_deref() {
            if title.trim().is_empty() {
                return Err(ApiError::bad_request("A page needs a title"));
            }
        }

        if let Some(Some(parent)) = req.parent_page_id.as_ref() {
            if self.repo.find_page(team_id, parent)?.is_none() {
                return Err(ApiError::bad_request("That parent page is not in this team"));
            }
            if self.would_create_cycle(team_id, page_id, parent)? {
                return Err(ApiError::bad_request(
                    "A page cannot be moved inside itself or one of its own subpages",
                ));
            }
        }
        // Home is what a team opens on and what the partial unique index guarantees exists at the
        // top level; nesting it would hide it behind the page it was moved under.
        if page.is_home() && matches!(req.parent_page_id, Some(Some(_))) {
            return Err(ApiError::bad_request("The Home page cannot be nested"));
        }

        let now = Self::now();

        // A version records what the page *was*, written before the change lands, so the history
        // is a list of states this page has actually held. Only a change of body earns one: a
        // rename or a move produces no new content, and a version per icon change would bury the
        // edits worth finding.
        let content_changed = req
            .content_md
            .as_deref()
            .is_some_and(|c| c != page.content_md);
        if content_changed {
            self.repo.insert_page_version(
                page_id,
                &page.title,
                &page.content_md,
                req.version_label.as_deref(),
                &user.user_id,
                &user.email,
                now,
            )?;
        }

        // A retitled page keeps its slug, for the same reason a renamed team does.
        self.repo.update_page(
            page_id,
            req.title.as_deref().map(str::trim),
            None,
            req.content_md.as_deref(),
            req.icon.as_ref().map(|v| v.as_deref()),
            req.cover_image.as_ref().map(|v| v.as_deref()),
            req.parent_page_id.as_ref().map(|v| v.as_deref()),
            req.sort_order,
            req.published.map(|p| if p { 1 } else { 0 }),
            &user.user_id,
            now,
        )?;

        self.log(
            &team,
            user,
            "team.page_updated",
            serde_json::json!({
                "page": req.title.as_deref().unwrap_or(&page.title),
                "contentChanged": content_changed,
            }),
        );

        let updated = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;
        Ok(TeamPageResponse::with_content(updated))
    }

    pub fn delete_page(
        &self,
        team_id: &str,
        page_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::DeletePage)?;

        let page = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;
        // The partial unique index guarantees a live team has exactly one Home page. Deleting it
        // would leave a team with none, and nothing else in the code is prepared for that.
        if page.is_home() {
            return Err(ApiError::bad_request(
                "The Home page cannot be deleted. Archive the team instead.",
            ));
        }

        // Deleting a parent deletes its subtree, so the tree never contains a page whose parent is
        // gone. Collected breadth-first with the same depth bound the cycle check uses, so a cycle
        // that predates that check cannot make this loop forever.
        let mut to_delete = vec![page_id.to_string()];
        let mut frontier = vec![page_id.to_string()];
        for _ in 0..500 {
            if frontier.is_empty() {
                break;
            }
            let mut next = Vec::new();
            for id in frontier {
                for child in self.repo.child_page_ids(&id)? {
                    if !to_delete.contains(&child) {
                        to_delete.push(child.clone());
                        next.push(child);
                    }
                }
            }
            frontier = next;
        }

        self.repo.soft_delete_pages(&to_delete, Self::now())?;
        self.log(
            &team,
            user,
            "team.page_deleted",
            serde_json::json!({ "page": page.title, "pages": to_delete.len() }),
        );
        Ok(())
    }

    pub fn duplicate_page(
        &self,
        team_id: &str,
        page_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::CreatePage)?;

        let source = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;

        let title = format!("{} (copy)", source.title);
        let now = Self::now();
        let new_id = Uuid::new_v4().to_string();
        // A copy is never the Home page, whatever it was copied from — the index allows only one,
        // and a second "Home" is not what duplicating Home means.
        self.repo.insert_page(&NewTeamPage {
            id: new_id.clone(),
            team_id: team_id.to_string(),
            parent_page_id: source.parent_page_id.clone(),
            title: title.clone(),
            slug: self.unique_page_slug(team_id, &title)?,
            content_md: source.content_md.clone(),
            icon: source.icon.clone(),
            sort_order: source.sort_order,
            is_home: 0,
            created_by: user.user_id.clone(),
            last_edited_by: user.user_id.clone(),
            created_at: now,
            updated_at: now,
        })?;

        self.log(
            &team,
            user,
            "team.page_duplicated",
            serde_json::json!({ "page": source.title }),
        );

        let page = self
            .repo
            .find_page(team_id, &new_id)?
            .ok_or_else(|| ApiError::internal("Page disappeared immediately after creation"))?;
        Ok(TeamPageResponse::with_content(page))
    }

    pub fn list_page_versions(
        &self,
        team_id: &str,
        page_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageVersionListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ViewTeam)?;
        // Through the team, so a page id from another team cannot be read by a member of this one.
        self.repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;

        let versions = self.repo.list_page_versions(page_id)?;
        Ok(TeamPageVersionListResponse {
            total: versions.len() as i64,
            versions: versions
                .into_iter()
                .map(TeamPageVersionResponse::summary)
                .collect(),
        })
    }

    pub fn get_page_version(
        &self,
        team_id: &str,
        page_id: &str,
        version_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageVersionResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ViewTeam)?;
        self.repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;

        let version = self
            .repo
            .find_page_version(page_id, version_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;
        Ok(TeamPageVersionResponse::with_content(version))
    }

    /// Put an old snapshot back as the page's current content.
    ///
    /// Restoring is an edit like any other, so it first records what the page holds now. Otherwise
    /// restoring the wrong version would destroy the content it replaced, and the feature meant to
    /// undo a mistake would be a way to make an unrecoverable one.
    pub fn restore_page_version(
        &self,
        team_id: &str,
        page_id: &str,
        version_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamPageResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::EditPage)?;

        let page = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;
        let version = self
            .repo
            .find_page_version(page_id, version_id)?
            .ok_or_else(|| ApiError::not_found("Version not found"))?;

        let now = Self::now();
        self.repo.insert_page_version(
            page_id,
            &page.title,
            &page.content_md,
            Some(&format!("Before restoring v{}", version.version_number)),
            &user.user_id,
            &user.email,
            now,
        )?;

        self.repo.update_page(
            page_id,
            Some(&version.title),
            None,
            Some(&version.content_md),
            None,
            None,
            None,
            None,
            None,
            &user.user_id,
            now,
        )?;

        self.log(
            &team,
            user,
            "team.page_version_restored",
            serde_json::json!({ "page": page.title, "version": version.version_number }),
        );

        let updated = self
            .repo
            .find_page(team_id, page_id)?
            .ok_or_else(|| ApiError::not_found("Page not found"))?;
        Ok(TeamPageResponse::with_content(updated))
    }

    // ── Activity ─────────────────────────────────────────────────────────────

    /// The team's activity feed (phase 8's groundwork).
    ///
    /// Behind `teamSpaces` like everything else here: the feed exists exactly when teams do, and
    /// the entries it reads were written by [`Self::log`] on every team write since the flag went
    /// on — so it has a history from the first team that was created rather than from whenever
    /// someone thought to look at it.
    pub fn list_activity(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamActivityResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.authorize(team_id, user, TeamAction::ViewTeam)?;

        // A feed is a recent-activity list, not an audit log; the audit trail is the same table
        // read through the admin tooling, which pages properly.
        let rows = self.repo.list_team_activity(team_id, 100)?;
        let entries: Vec<TeamActivityEntry> = rows
            .into_iter()
            .map(|(id, actor, action, detail_json, created_at)| TeamActivityEntry {
                id,
                actor,
                action,
                // A row whose detail will not parse is still a real event, so the entry is kept
                // with no detail rather than dropped from the feed.
                detail: detail_json.and_then(|d| serde_json::from_str(&d).ok()),
                created_at: created_at.to_string(),
            })
            .collect();

        Ok(TeamActivityResponse {
            total: entries.len() as i64,
            entries,
        })
    }

    // ── File library ─────────────────────────────────────────────────────────

    pub fn list_library(
        &self,
        team_id: &str,
        folder_id: Option<&str>,
        user: &AuthenticatedUser,
    ) -> Result<TeamLibraryResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::ViewTeam)?;

        if let Some(id) = folder_id {
            self.repo
                .find_team_folder(team_id, id)?
                .ok_or_else(|| ApiError::not_found("Folder not found"))?;
        }

        let folders = self.repo.list_team_folders(team_id, folder_id)?;
        let files = self.repo.list_team_files(team_id, folder_id)?;

        Ok(TeamLibraryResponse {
            folders: folders
                .into_iter()
                .map(|f| TeamFolderResponse {
                    id: f.id,
                    name: f.name,
                    parent_id: f.parent_id,
                    created_at: f.created_at.to_string(),
                    updated_at: f.updated_at.to_string(),
                })
                .collect(),
            files: files
                .into_iter()
                .map(|f| TeamFileResponse {
                    id: f.id,
                    name: f.name,
                    size_bytes: f.size_bytes,
                    mime_type: f.mime_type,
                    folder_id: f.folder_id,
                    uploaded_by: f.user_id,
                    created_at: f.created_at.to_string(),
                    updated_at: f.updated_at.to_string(),
                })
                .collect(),
            storage_used_bytes: team.storage_used_bytes,
        })
    }

    pub fn create_library_folder(
        &self,
        team_id: &str,
        req: CreateTeamFolderRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamFolderResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::UploadFile)?;

        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("A folder needs a name"));
        }
        if let Some(parent) = req.parent_id.as_deref() {
            self.repo
                .find_team_folder(team_id, parent)?
                .ok_or_else(|| ApiError::bad_request("That parent folder is not in this team"))?;
        }

        let now = Self::now();
        let folder = self.repo.insert_team_folder(
            &Uuid::new_v4().to_string(),
            team_id,
            &user.user_id,
            req.parent_id.as_deref(),
            name,
            now,
        )?;

        self.log(
            &team,
            user,
            "team.folder_created",
            serde_json::json!({ "folder": name }),
        );

        Ok(TeamFolderResponse {
            id: folder.id,
            name: folder.name,
            parent_id: folder.parent_id,
            created_at: folder.created_at.to_string(),
            updated_at: folder.updated_at.to_string(),
        })
    }

    /// Move a file the caller has just uploaded into the team's library.
    ///
    /// The upload itself goes through the ordinary Drive endpoint, which already handles the bytes,
    /// the encryption envelope, the thumbnail and the uploader's own quota. This is the second
    /// step, and it is what a team upload *is*: reusing that path rather than threading a team id
    /// through it is what keeps team files inside the existing versioning, trash and encryption
    /// instead of beside them.
    pub fn claim_file(
        &self,
        team_id: &str,
        req: ClaimFileRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamFileResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::UploadFile)?;

        if let Some(folder) = req.folder_id.as_deref() {
            self.repo
                .find_team_folder(team_id, folder)?
                .ok_or_else(|| ApiError::bad_request("That folder is not in this team"))?;
        }

        // The team's own quota, checked before the file joins it (phase 1's "storage quotas").
        // The uploader's personal quota was already charged by the upload that created the file;
        // this is the team's separate limit, which is what makes a team's storage the team's
        // problem rather than whichever member happened to press upload.
        if let Some(limit) = team.storage_limit_bytes {
            if let Some(incoming) = self.repo.find_own_unclaimed_file(&req.file_id, &user.user_id)?
            {
                let used = self.repo.recalculate_storage(team_id)?;
                if used + incoming.size_bytes > limit {
                    return Err(ApiError::new(
                        413,
                        "TEAM_QUOTA_EXCEEDED",
                        "This team has no room left. Delete something or raise the team's storage limit.",
                    ));
                }
            }
        }

        let now = Self::now();
        let file = self
            .repo
            .claim_file_for_team(
                &req.file_id,
                &user.user_id,
                team_id,
                req.folder_id.as_deref(),
                now,
            )?
            .ok_or_else(|| {
                ApiError::not_found("No file of yours with that id is available to move")
            })?;

        // A team's meter counts the team's files, so it moves when a file joins the team.
        self.repo.recalculate_storage(team_id)?;
        self.log(
            &team,
            user,
            "team.file_added",
            serde_json::json!({ "file": file.name, "sizeBytes": file.size_bytes }),
        );

        Ok(TeamFileResponse {
            id: file.id,
            name: file.name,
            size_bytes: file.size_bytes,
            mime_type: file.mime_type,
            folder_id: file.folder_id,
            uploaded_by: file.user_id,
            created_at: file.created_at.to_string(),
            updated_at: file.updated_at.to_string(),
        })
    }

    pub fn rename_library_file(
        &self,
        team_id: &str,
        file_id: &str,
        req: RenameTeamFileRequest,
        user: &AuthenticatedUser,
    ) -> Result<TeamFileResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::UploadFile)?;

        let name = req.name.trim();
        if name.is_empty() {
            return Err(ApiError::bad_request("A file needs a name"));
        }

        let now = Self::now();
        if self.repo.rename_team_file(team_id, file_id, name, now)? == 0 {
            return Err(ApiError::not_found("File not found in this team"));
        }
        let file = self
            .repo
            .find_team_file(team_id, file_id)?
            .ok_or_else(|| ApiError::not_found("File not found in this team"))?;

        self.log(
            &team,
            user,
            "team.file_renamed",
            serde_json::json!({ "file": name }),
        );

        Ok(TeamFileResponse {
            id: file.id,
            name: file.name,
            size_bytes: file.size_bytes,
            mime_type: file.mime_type,
            folder_id: file.folder_id,
            uploaded_by: file.user_id,
            created_at: file.created_at.to_string(),
            updated_at: file.updated_at.to_string(),
        })
    }

    /// Trash a team file, into the same trash every other file goes to.
    pub fn trash_library_file(
        &self,
        team_id: &str,
        file_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::DeleteFile)?;

        let file = self
            .repo
            .find_team_file(team_id, file_id)?
            .ok_or_else(|| ApiError::not_found("File not found in this team"))?;

        if self.repo.trash_team_file(team_id, file_id, Self::now())? == 0 {
            return Err(ApiError::not_found("File not found in this team"));
        }
        self.repo.recalculate_storage(team_id)?;
        self.log(
            &team,
            user,
            "team.file_trashed",
            serde_json::json!({ "file": file.name }),
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slugify_lowercases_and_hyphenates() {
        assert_eq!(slugify("Marketing Team"), "marketing-team");
        assert_eq!(slugify("  Q3   Roadmap  "), "q3-roadmap");
        assert_eq!(slugify("Design/Research & Ops"), "design-research-ops");
    }

    /// The generated slug never starts or ends with a separator, whatever the input did.
    #[test]
    fn slugify_trims_separators() {
        assert_eq!(slugify("---hello---"), "hello");
        assert_eq!(slugify("!!!"), "");
        assert_eq!(slugify(""), "");
    }

    /// A title with nothing sluggable is empty rather than a run of hyphens, so the caller knows to
    /// fall back to a generated id instead of creating a second team called "---".
    #[test]
    fn slugify_of_unsluggable_input_is_empty() {
        assert_eq!(slugify("🏠"), "");
        assert_eq!(slugify("日本語"), "");
    }

    #[test]
    fn slugify_is_bounded() {
        assert!(slugify(&"a".repeat(500)).len() <= 64);
    }

    /// Parsing itself is covered in `visibility.rs`; what matters here is that a bad value becomes
    /// a 400 rather than an internal error or a silently-stored string.
    #[test]
    fn an_unparseable_visibility_becomes_a_bad_request() {
        for v in Visibility::ALL {
            assert_eq!(parse_visibility(v.as_str()).expect("valid"), v);
        }
        for v in ["public", "", "Private", "org"] {
            assert_eq!(parse_visibility(v).expect_err("invalid").status, 400);
        }
    }

    #[test]
    fn home_markdown_names_the_team() {
        let md = home_page_markdown("Marketing");
        assert!(md.starts_with("# Welcome to Marketing"));
        assert!(md.contains("## Quick links"));
    }
}
