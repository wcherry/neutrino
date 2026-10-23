//! Asking a team for a file's key (UI roadmap stage 6).
//!
//! A team file's key is sealed to each member in the browser of whoever uploads, moves or lends it
//! (`web/apps/web/src/lib/teamTransfer.ts`). Someone who joins afterwards sees the file and cannot
//! open it, and nothing here can change that: the server never has the plaintext key. What it can
//! do is carry the question. A member asks; the team's Owners and Admins, and the file's owner, are
//! told; whichever of them answers first seals the key to the requester in their own browser
//! (`POST /encryption/files/{id}/share`) and then approves — or declines, with a reason if they
//! want to give one. Approval is refused until the requester actually holds a key row, so an
//! approved request always means a file they can open.
//!
//! The rules follow the rest of Team Spaces: a non-member gets the team's 404; an archived team
//! still takes requests (asking to read is a read) but cannot have them answered, since answering
//! is a write.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

use super::model::Team;
use super::repository::{db_err, TeamsRepository};
use super::roles::{Role, TeamAction};
use super::service::{TeamsService, FLAG_TEAM_SPACES};
use crate::schema::{file_key_refs, files, team_key_requests, users};
use crate::shared::{ApiError, AuthenticatedUser};

pub const PENDING: &str = "pending";
pub const APPROVED: &str = "approved";
pub const DENIED: &str = "denied";

/// The notification each side is sent. The web's `notificationLabel` reads these.
pub const EVENT_REQUESTED: &str = "team_key_requested";
pub const EVENT_APPROVED: &str = "team_key_approved";
pub const EVENT_DENIED: &str = "team_key_denied";

const MAX_TEXT: usize = 500;

// ── Rows ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Queryable, Selectable)]
#[diesel(table_name = team_key_requests)]
#[diesel(check_for_backend(diesel::sqlite::Sqlite))]
pub struct TeamKeyRequest {
    pub id: String,
    pub team_id: String,
    pub file_id: String,
    pub requester_id: String,
    pub message: Option<String>,
    pub status: String,
    pub reason: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<NaiveDateTime>,
    pub created_at: NaiveDateTime,
    #[allow(dead_code)]
    pub updated_at: NaiveDateTime,
}

#[derive(Debug, Insertable)]
#[diesel(table_name = team_key_requests)]
struct NewTeamKeyRequest<'a> {
    id: &'a str,
    team_id: &'a str,
    file_id: &'a str,
    requester_id: &'a str,
    message: Option<&'a str>,
    status: &'a str,
    created_at: NaiveDateTime,
    updated_at: NaiveDateTime,
}

// ── DTOs ─────────────────────────────────────────────────────────────────────

#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateKeyRequestRequest {
    pub file_id: String,
    /// Optional note to whoever answers, at most 500 characters.
    pub message: Option<String>,
}

#[derive(Debug, Default, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DenyKeyRequestRequest {
    /// Optional reason shown to the requester, at most 500 characters.
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamKeyRequestResponse {
    pub id: String,
    pub team_id: String,
    pub file_id: String,
    pub file_name: String,
    pub requester_id: String,
    pub requester_name: String,
    pub requester_email: String,
    pub message: Option<String>,
    /// `pending` | `approved` | `denied`.
    pub status: String,
    pub reason: Option<String>,
    pub decided_by: Option<String>,
    pub decided_at: Option<String>,
    pub created_at: String,
    /// Whether the caller may approve or deny it: a team Owner or Admin, or the file's owner, and
    /// never the requester themselves.
    pub can_decide: bool,
}

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamKeyRequestListResponse {
    pub requests: Vec<TeamKeyRequestResponse>,
    pub total: i64,
}

/// A notification to send once the write has landed. Returned rather than sent, so the service
/// stays synchronous and testable; the handler sends it.
#[derive(Debug, Clone)]
pub struct Notice {
    pub recipients: Vec<String>,
    pub event_type: &'static str,
    pub payload: serde_json::Value,
}

// ── Repository ───────────────────────────────────────────────────────────────

impl TeamsRepository {
    fn insert_key_request(&self, row: &NewTeamKeyRequest) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(team_key_requests::table)
            .values(row)
            .execute(&mut conn)
            .map(|_| ())
            .map_err(db_err("team key request insert"))
    }

    fn find_key_request(
        &self,
        team_id: &str,
        id: &str,
    ) -> Result<Option<TeamKeyRequest>, ApiError> {
        let mut conn = self.conn()?;
        team_key_requests::table
            .filter(team_key_requests::team_id.eq(team_id))
            .filter(team_key_requests::id.eq(id))
            .select(TeamKeyRequest::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team key request find"))
    }

    fn find_pending_key_request(
        &self,
        team_id: &str,
        file_id: &str,
        requester_id: &str,
    ) -> Result<Option<TeamKeyRequest>, ApiError> {
        let mut conn = self.conn()?;
        team_key_requests::table
            .filter(team_key_requests::team_id.eq(team_id))
            .filter(team_key_requests::file_id.eq(file_id))
            .filter(team_key_requests::requester_id.eq(requester_id))
            .filter(team_key_requests::status.eq(PENDING))
            .select(TeamKeyRequest::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team key request pending find"))
    }

    fn list_key_requests(
        &self,
        team_id: &str,
        status: &str,
    ) -> Result<Vec<TeamKeyRequest>, ApiError> {
        let mut conn = self.conn()?;
        team_key_requests::table
            .filter(team_key_requests::team_id.eq(team_id))
            .filter(team_key_requests::status.eq(status))
            .order(team_key_requests::created_at.desc())
            .limit(200)
            .select(TeamKeyRequest::as_select())
            .load(&mut conn)
            .map_err(db_err("team key requests list"))
    }

    fn decide_key_request(
        &self,
        id: &str,
        status: &str,
        reason: Option<&str>,
        decided_by: &str,
        now: NaiveDateTime,
    ) -> Result<usize, ApiError> {
        let mut conn = self.conn()?;
        // Conditional on still being pending, so two deciders answering at once cannot both win.
        diesel::update(
            team_key_requests::table
                .filter(team_key_requests::id.eq(id))
                .filter(team_key_requests::status.eq(PENDING)),
        )
        .set((
            team_key_requests::status.eq(status),
            team_key_requests::reason.eq(reason),
            team_key_requests::decided_by.eq(decided_by),
            team_key_requests::decided_at.eq(now),
            team_key_requests::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(db_err("team key request decide"))
    }

    /// Whether this person has a sealed copy of the file's key.
    fn holds_file_key(&self, file_id: &str, user_id: &str) -> Result<bool, ApiError> {
        let mut conn = self.conn()?;
        diesel::select(diesel::dsl::exists(
            file_key_refs::table
                .filter(file_key_refs::file_id.eq(file_id))
                .filter(file_key_refs::user_id.eq(user_id)),
        ))
        .get_result(&mut conn)
        .map_err(db_err("file key ref lookup"))
    }

    /// Of these files, the ones that are encrypted (someone holds a key) and to which this person
    /// holds none.
    pub(super) fn files_missing_key(
        &self,
        file_ids: &[String],
        user_id: &str,
    ) -> Result<std::collections::HashSet<String>, ApiError> {
        if file_ids.is_empty() {
            return Ok(Default::default());
        }
        let mut conn = self.conn()?;
        let rows: Vec<(String, String)> = file_key_refs::table
            .filter(file_key_refs::file_id.eq_any(file_ids))
            .select((file_key_refs::file_id, file_key_refs::user_id))
            .load(&mut conn)
            .map_err(db_err("file key refs list"))?;
        let held: std::collections::HashSet<&str> = rows
            .iter()
            .filter(|(_, u)| u == user_id)
            .map(|(f, _)| f.as_str())
            .collect();
        Ok(rows
            .iter()
            .filter(|(f, _)| !held.contains(f.as_str()))
            .map(|(f, _)| f.clone())
            .collect())
    }

    /// Whether the file is encrypted at all — anyone holds a key to it.
    fn file_has_keys(&self, file_id: &str) -> Result<bool, ApiError> {
        let mut conn = self.conn()?;
        diesel::select(diesel::dsl::exists(
            file_key_refs::table.filter(file_key_refs::file_id.eq(file_id)),
        ))
        .get_result(&mut conn)
        .map_err(db_err("file key ref lookup"))
    }

    /// The file's owner and name, if it is live.
    fn file_owner_and_name(&self, file_id: &str) -> Result<Option<(String, String)>, ApiError> {
        let mut conn = self.conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .filter(files::deleted_at.is_null())
            .select((files::user_id, files::name))
            .first(&mut conn)
            .optional()
            .map_err(db_err("file owner lookup"))
    }

    fn user_name_and_email(&self, user_id: &str) -> Result<Option<(String, String)>, ApiError> {
        let mut conn = self.conn()?;
        users::table
            .filter(users::id.eq(user_id))
            .select((users::name, users::email))
            .first(&mut conn)
            .optional()
            .map_err(db_err("user lookup"))
    }
}

// ── Service ──────────────────────────────────────────────────────────────────

fn tidy(text: Option<String>, what: &str) -> Result<Option<String>, ApiError> {
    let text = text.map(|t| t.trim().to_string()).filter(|t| !t.is_empty());
    if text
        .as_deref()
        .is_some_and(|t| t.chars().count() > MAX_TEXT)
    {
        return Err(ApiError::bad_request(format!(
            "A {what} can be at most {MAX_TEXT} characters"
        )));
    }
    Ok(text)
}

impl TeamsService {
    /// The file, if it belongs to this team or is lent to it: its owner and name.
    fn team_file_owner(&self, team_id: &str, file_id: &str) -> Result<(String, String), ApiError> {
        let in_team = self.repo.find_team_file(team_id, file_id)?.is_some()
            || self.repo.find_file_share(team_id, file_id)?.is_some();
        let found = if in_team {
            self.repo.file_owner_and_name(file_id)?
        } else {
            None
        };
        found.ok_or_else(|| ApiError::not_found("No such file in this team"))
    }

    fn may_decide(
        role: Role,
        file_owner: &str,
        request: &TeamKeyRequest,
        user: &AuthenticatedUser,
    ) -> bool {
        request.requester_id != user.user_id
            && (role.can(TeamAction::ManageJoinRequests) || file_owner == user.user_id)
    }

    fn key_request_response(
        &self,
        r: TeamKeyRequest,
        file_name: String,
        can_decide: bool,
    ) -> Result<TeamKeyRequestResponse, ApiError> {
        let (requester_name, requester_email) = self
            .repo
            .user_name_and_email(&r.requester_id)?
            .unwrap_or_default();
        Ok(TeamKeyRequestResponse {
            id: r.id,
            team_id: r.team_id,
            file_id: r.file_id,
            file_name,
            requester_id: r.requester_id,
            requester_name,
            requester_email,
            message: r.message,
            status: r.status,
            reason: r.reason,
            decided_by: r.decided_by,
            decided_at: r.decided_at.map(|d| d.to_string()),
            created_at: r.created_at.to_string(),
            can_decide,
        })
    }

    /// Who is told about a new request: the team's Owners and Admins and the file's owner, if they
    /// are a member — never the requester.
    fn deciders(
        &self,
        team_id: &str,
        file_owner: &str,
        requester: &str,
    ) -> Result<Vec<String>, ApiError> {
        let mut out: Vec<String> = self
            .repo
            .list_members(team_id)?
            .into_iter()
            .filter(|m| {
                m.user_id == file_owner
                    || Role::parse(&m.role).is_some_and(|r| r.can(TeamAction::ManageJoinRequests))
            })
            .map(|m| m.user_id)
            .filter(|id| id != requester)
            .collect();
        out.dedup();
        Ok(out)
    }

    fn notice_payload(
        team: &Team,
        file_id: &str,
        file_name: &str,
        request_id: &str,
        actor: &str,
    ) -> serde_json::Value {
        serde_json::json!({
            "teamId": team.id,
            "teamName": team.name,
            "resourceType": "file",
            "resourceId": file_id,
            "resourceName": file_name,
            "requestId": request_id,
            "actorId": actor,
        })
    }

    /// Ask for the key to a team file the caller cannot open.
    pub fn create_key_request(
        &self,
        team_id: &str,
        req: CreateKeyRequestRequest,
        user: &AuthenticatedUser,
    ) -> Result<(TeamKeyRequestResponse, Notice), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (team, _) = self.authorize(team_id, user, TeamAction::ViewTeam)?;
        let (file_owner, file_name) = self.team_file_owner(team_id, &req.file_id)?;
        let message = tidy(req.message, "message")?;

        if !self.repo.file_has_keys(&req.file_id)? {
            return Err(ApiError::bad_request(
                "This file is not encrypted; there is no key to ask for",
            ));
        }
        if self.repo.holds_file_key(&req.file_id, &user.user_id)? {
            return Err(ApiError::conflict("You already have the key to this file"));
        }
        if self
            .repo
            .find_pending_key_request(team_id, &req.file_id, &user.user_id)?
            .is_some()
        {
            return Err(ApiError::conflict(
                "You have already asked for the key to this file",
            ));
        }

        let now = Self::now();
        let id = Uuid::new_v4().to_string();
        self.repo.insert_key_request(&NewTeamKeyRequest {
            id: &id,
            team_id,
            file_id: &req.file_id,
            requester_id: &user.user_id,
            message: message.as_deref(),
            status: PENDING,
            created_at: now,
            updated_at: now,
        })?;
        self.log(
            &team,
            user,
            "team.key_requested",
            serde_json::json!({ "fileId": req.file_id }),
        );

        let mut payload = Self::notice_payload(&team, &req.file_id, &file_name, &id, &user.user_id);
        if let Some(m) = &message {
            payload["message"] = serde_json::Value::String(m.clone());
        }
        let notice = Notice {
            recipients: self.deciders(team_id, &file_owner, &user.user_id)?,
            event_type: EVENT_REQUESTED,
            payload,
        };
        let row = self
            .repo
            .find_key_request(team_id, &id)?
            .ok_or_else(|| ApiError::internal("Key request not found after insert"))?;
        Ok((self.key_request_response(row, file_name, false)?, notice))
    }

    /// The requests the caller can see: every request in the team for an Owner or Admin; for
    /// anyone else, requests on files they own and their own requests.
    pub fn list_key_requests(
        &self,
        team_id: &str,
        status: Option<&str>,
        user: &AuthenticatedUser,
    ) -> Result<TeamKeyRequestListResponse, ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        let (_, role) = self.authorize(team_id, user, TeamAction::ViewTeam)?;
        let status = status.unwrap_or(PENDING);
        if !matches!(status, PENDING | APPROVED | DENIED) {
            return Err(ApiError::bad_request(
                "Status must be pending, approved or denied",
            ));
        }

        let mut out = Vec::new();
        for r in self.repo.list_key_requests(team_id, status)? {
            let Some((owner, name)) = self.repo.file_owner_and_name(&r.file_id)? else {
                continue;
            };
            let manager = role.can(TeamAction::ManageJoinRequests);
            if !(manager || owner == user.user_id || r.requester_id == user.user_id) {
                continue;
            }
            let can_decide = r.status == PENDING && Self::may_decide(role, &owner, &r, user);
            out.push(self.key_request_response(r, name, can_decide)?);
        }
        Ok(TeamKeyRequestListResponse {
            total: out.len() as i64,
            requests: out,
        })
    }

    /// A pending request the caller may answer, with the file's name.
    fn decidable(
        &self,
        team_id: &str,
        request_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(Team, TeamKeyRequest, String), ApiError> {
        self.gate.require(FLAG_TEAM_SPACES)?;
        // ViewTeam, not a manager action: a file's owner may answer whatever their role. The
        // archived check is done by hand for the same reason.
        let (team, role) = self.authorize(team_id, user, TeamAction::ViewTeam)?;
        if team.is_archived() {
            return Err(ApiError::forbidden(
                "This team is archived. Restore it before making changes.",
            ));
        }
        let request = self
            .repo
            .find_key_request(team_id, request_id)?
            .ok_or_else(|| ApiError::not_found("No such key request in this team"))?;
        let (owner, name) = self
            .repo
            .file_owner_and_name(&request.file_id)?
            .ok_or_else(|| ApiError::not_found("No such key request in this team"))?;
        if !Self::may_decide(role, &owner, &request, user) {
            return Err(ApiError::forbidden(
                "Only the team's owners and admins, or the file's owner, can answer this request",
            ));
        }
        if request.status != PENDING {
            return Err(ApiError::conflict(format!(
                "That request was already {}",
                request.status
            )));
        }
        Ok((team, request, name))
    }

    /// Approve a request, after the caller has sealed the key to the requester.
    pub fn approve_key_request(
        &self,
        team_id: &str,
        request_id: &str,
        user: &AuthenticatedUser,
    ) -> Result<(TeamKeyRequestResponse, Notice), ApiError> {
        let (team, request, name) = self.decidable(team_id, request_id, user)?;
        if !self
            .repo
            .holds_file_key(&request.file_id, &request.requester_id)?
        {
            return Err(ApiError::new(
                409,
                "KEY_NOT_SHARED",
                "Share the file's key with them before approving",
            ));
        }
        self.decide(team, request, name, APPROVED, None, user)
    }

    /// Deny a request, optionally saying why.
    pub fn deny_key_request(
        &self,
        team_id: &str,
        request_id: &str,
        req: DenyKeyRequestRequest,
        user: &AuthenticatedUser,
    ) -> Result<(TeamKeyRequestResponse, Notice), ApiError> {
        let reason = tidy(req.reason, "reason")?;
        let (team, request, name) = self.decidable(team_id, request_id, user)?;
        self.decide(team, request, name, DENIED, reason, user)
    }

    fn decide(
        &self,
        team: Team,
        request: TeamKeyRequest,
        name: String,
        status: &'static str,
        reason: Option<String>,
        user: &AuthenticatedUser,
    ) -> Result<(TeamKeyRequestResponse, Notice), ApiError> {
        let now = Self::now();
        if self.repo.decide_key_request(
            &request.id,
            status,
            reason.as_deref(),
            &user.user_id,
            now,
        )? == 0
        {
            return Err(ApiError::conflict("That request was already answered"));
        }
        self.log(
            &team,
            user,
            if status == APPROVED {
                "team.key_request_approved"
            } else {
                "team.key_request_denied"
            },
            serde_json::json!({ "fileId": request.file_id, "requester": request.requester_id }),
        );

        let mut payload =
            Self::notice_payload(&team, &request.file_id, &name, &request.id, &user.user_id);
        if let Some(r) = &reason {
            payload["reason"] = serde_json::Value::String(r.clone());
        }
        let notice = Notice {
            recipients: vec![request.requester_id.clone()],
            event_type: if status == APPROVED {
                EVENT_APPROVED
            } else {
                EVENT_DENIED
            },
            payload,
        };
        let row = self
            .repo
            .find_key_request(&team.id, &request.id)?
            .ok_or_else(|| ApiError::internal("Key request not found after update"))?;
        Ok((self.key_request_response(row, name, false)?, notice))
    }
}
