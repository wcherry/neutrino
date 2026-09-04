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
use crate::drive::activity::service::ActivityService;
use crate::drive::feature_flags::gate::FeatureGate;
use crate::shared::{ApiError, AuthenticatedUser};

/// The flag every team route is behind.
pub const FLAG_TEAM_SPACES: &str = "teamSpaces";
/// Phases 2–3: the wiki.
pub const FLAG_TEAM_SPACES_PAGES: &str = "teamSpacesPages";
/// Phase 4: the file library.
pub const FLAG_TEAM_SPACES_FILES: &str = "teamSpacesFiles";
/// Phase 8 groundwork: per-team activity logging.
pub const FLAG_TEAM_SPACES_ACTIVITY: &str = "teamSpacesActivity";

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

/// A visibility a team may be created with.
fn valid_visibility(value: &str) -> bool {
    matches!(value, "private" | "invite_only" | "organization")
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
        // Phase 8 gates the feed, not the recording. A feed that only starts collecting when it is
        // switched on shows an empty history on the day it ships, so the logging runs regardless
        // and the flag governs whether anyone can read it.
        //
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
        let visibility = req.visibility.unwrap_or_else(|| "private".to_string());
        if !valid_visibility(&visibility) {
            return Err(ApiError::bad_request(
                "Visibility must be private, invite_only or organization",
            ));
        }

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
            visibility,
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
        if let Some(v) = req.visibility.as_deref() {
            if !valid_visibility(v) {
                return Err(ApiError::bad_request(
                    "Visibility must be private, invite_only or organization",
                ));
            }
        }

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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_PAGES)?;
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
    /// The flag gates *reading* this, not the recording — the logging in [`Self::log`] runs
    /// whatever the flag says. A feed that only starts collecting when it is switched on shows an
    /// empty history on the day it ships, which is the worst possible first impression of a feature
    /// whose whole value is history.
    pub fn list_activity(
        &self,
        team_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<TeamActivityResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        self.gate.require(FLAG_TEAM_SPACES_ACTIVITY)?;
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
        self.gate.require(FLAG_TEAM_SPACES_FILES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_FILES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_FILES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_FILES)?;
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
        self.gate.require(FLAG_TEAM_SPACES_FILES)?;
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

    #[test]
    fn visibility_is_restricted_to_the_three_documented_values() {
        for v in ["private", "invite_only", "organization"] {
            assert!(valid_visibility(v));
        }
        for v in ["public", "", "Private", "org"] {
            assert!(!valid_visibility(v));
        }
    }

    #[test]
    fn home_markdown_names_the_team() {
        let md = home_page_markdown("Marketing");
        assert!(md.starts_with("# Welcome to Marketing"));
        assert!(md.contains("## Quick links"));
    }
}
