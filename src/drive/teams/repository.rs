//! Storage for teams, their membership, their pages and their file library.
//!
//! Files and folders are the shared `files`/`folders` tables scoped by `team_id` (migration 00128),
//! not a parallel pair of tables. Every read here therefore states the scope it means; a query that
//! filtered on `user_id` alone would mix a member's own Drive into the team's library, and the
//! mirror-image mistake — a My Drive listing picking up team rows — is prevented in
//! `filesystem::repository` and `storage::repository`, which now say `team_id IS NULL`.

use chrono::NaiveDateTime;
use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};

use super::model::*;
use super::roles::Role;
use super::visibility::Visibility;
use crate::drive::filesystem::model::FolderRecord;
use crate::drive::storage::model::FileRecord;
use crate::schema::{
    files, folders, permissions, team_file_shares, team_join_requests, team_members,
    team_page_versions, team_pages, teams, users,
};
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

/// One row of the admin console's team list.
///
/// Its own struct rather than [`Team`], because the two say different things: `Team` is the row as
/// stored, with a cached `storage_used_bytes`, and this is a derived view whose `used_bytes` was
/// computed by the query that produced it. Returning a `Team` with the total patched in would
/// invite the reader to assume the rest of it had been refreshed too.
#[derive(Debug, Clone, diesel::QueryableByName)]
pub struct AdminTeamRow {
    #[diesel(sql_type = diesel::sql_types::Text)]
    pub id: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    pub name: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    pub slug: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    pub visibility: String,
    #[diesel(sql_type = diesel::sql_types::Text)]
    pub created_by: String,
    #[diesel(sql_type = diesel::sql_types::Nullable<diesel::sql_types::BigInt>)]
    pub storage_limit_bytes: Option<i64>,
    #[diesel(sql_type = diesel::sql_types::Timestamp)]
    pub created_at: NaiveDateTime,
    #[diesel(sql_type = diesel::sql_types::Bool)]
    pub archived: bool,
    /// Summed from the live file rows by the listing query, not read from the cached column.
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    pub used_bytes: i64,
    #[diesel(sql_type = diesel::sql_types::BigInt)]
    pub member_count: i64,
}

pub struct TeamsRepository {
    pool: DbPool,
}

fn db_err(context: &'static str) -> impl Fn(diesel::result::Error) -> ApiError {
    move |e| {
        tracing::error!("DB {} error: {:?}", context, e);
        ApiError::internal("Database error")
    }
}

impl TeamsRepository {
    pub fn new(pool: DbPool) -> Self {
        Self { pool }
    }

    fn conn(
        &self,
    ) -> Result<diesel::r2d2::PooledConnection<ConnectionManager<SqliteConnection>>, ApiError> {
        self.pool.get().map_err(|e| {
            tracing::error!("DB pool error: {:?}", e);
            ApiError::internal("Database connection unavailable")
        })
    }

    // ── Teams ────────────────────────────────────────────────────────────────

    /// The live teams this user belongs to, newest first.
    ///
    /// Archived teams are included: they still appear in Shared Spaces, marked, because a team you
    /// archived is one you may want to bring back and one whose pages you may still want to read.
    /// Deleted teams are not.
    pub fn list_for_user(&self, user_id: &str) -> Result<Vec<Team>, ApiError> {
        let mut conn = self.conn()?;
        teams::table
            .inner_join(team_members::table.on(team_members::team_id.eq(teams::id)))
            .filter(team_members::user_id.eq(user_id))
            .filter(teams::deleted_at.is_null())
            .order(teams::created_at.desc())
            .select(Team::as_select())
            .load(&mut conn)
            .map_err(db_err("teams list"))
    }

    pub fn find(&self, team_id: &str) -> Result<Option<Team>, ApiError> {
        let mut conn = self.conn()?;
        teams::table
            .filter(teams::id.eq(team_id))
            .filter(teams::deleted_at.is_null())
            .select(Team::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team find"))
    }

    /// Whether a slug is already taken by a live team.
    pub fn slug_taken(&self, slug: &str) -> Result<bool, ApiError> {
        let mut conn = self.conn()?;
        let count: i64 = teams::table
            .filter(teams::slug.eq(slug))
            .filter(teams::deleted_at.is_null())
            .count()
            .get_result(&mut conn)
            .map_err(db_err("team slug check"))?;
        Ok(count > 0)
    }

    pub fn insert_team(&self, team: &NewTeam) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(teams::table)
            .values(team)
            .execute(&mut conn)
            .map_err(db_err("team insert"))?;
        Ok(())
    }

    /// Apply a partial update. Every field is optional and `None` leaves the column alone; the
    /// doubly-wrapped ones distinguish "not given" from "given as null".
    #[allow(clippy::too_many_arguments)]
    pub fn update_team(
        &self,
        team_id: &str,
        name: Option<&str>,
        slug: Option<&str>,
        description: Option<Option<&str>>,
        avatar_color: Option<Option<&str>>,
        avatar_emoji: Option<Option<&str>>,
        visibility: Option<&str>,
        default_page_id: Option<&str>,
        archived: Option<bool>,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            macro_rules! set {
                ($col:expr, $value:expr) => {
                    if let Some(v) = $value {
                        diesel::update(teams::table.filter(teams::id.eq(team_id)))
                            .set($col.eq(v))
                            .execute(conn)?;
                    }
                };
            }
            set!(teams::name, name);
            set!(teams::slug, slug);
            set!(teams::description, description);
            set!(teams::avatar_color, avatar_color);
            set!(teams::avatar_emoji, avatar_emoji);
            set!(teams::visibility, visibility);
            set!(teams::default_page_id, default_page_id);
            if let Some(archived) = archived {
                let at = if archived { Some(now) } else { None };
                diesel::update(teams::table.filter(teams::id.eq(team_id)))
                    .set(teams::archived_at.eq(at))
                    .execute(conn)?;
            }
            diesel::update(teams::table.filter(teams::id.eq(team_id)))
                .set(teams::updated_at.eq(now))
                .execute(conn)?;
            Ok(())
        })
        .map_err(db_err("team update"))?;
        Ok(())
    }

    /// Soft-delete the team.
    ///
    /// Soft rather than hard, so a team deleted by mistake is recoverable and so the pages and
    /// files that cascade off it are not destroyed by one click. The slug is freed immediately —
    /// the unique index in 00126 is partial on `deleted_at IS NULL` — so the name can be reused
    /// straight away.
    pub fn soft_delete_team(&self, team_id: &str, now: NaiveDateTime) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::update(teams::table.filter(teams::id.eq(team_id)))
            .set((teams::deleted_at.eq(now), teams::updated_at.eq(now)))
            .execute(&mut conn)
            .map_err(db_err("team delete"))?;
        Ok(())
    }

    /// Recompute a team's storage from the files that are actually in it.
    ///
    /// Derived rather than incremented, because an increment has to be right on every path that
    /// adds or removes a file — including the trash, the restore and the permanent delete — and one
    /// missed path leaves a number that drifts further from the truth with every upload.
    pub fn recalculate_storage(&self, team_id: &str) -> Result<i64, ApiError> {
        use diesel::sql_types::{BigInt, Text};

        // Raw SQL rather than `diesel::dsl::sum`, which comes back as Numeric and reaches Rust as
        // a float — the wrong shape for byte counts, which must stay exact past 2^53. Same reason
        // `storage::repository::calculate_used_bytes` does it this way.
        #[derive(diesel::QueryableByName)]
        struct Total {
            #[diesel(sql_type = BigInt)]
            total: i64,
        }

        let mut conn = self.conn()?;
        let rows: Vec<Total> = diesel::sql_query(
            "SELECT COALESCE(SUM(size_bytes), 0) AS total FROM files \
             WHERE team_id = ? AND deleted_at IS NULL",
        )
        .bind::<Text, _>(team_id)
        .load(&mut conn)
        .map_err(db_err("team storage sum"))?;
        let used = rows.first().map(|r| r.total).unwrap_or(0);
        diesel::update(teams::table.filter(teams::id.eq(team_id)))
            .set(teams::storage_used_bytes.eq(used))
            .execute(&mut conn)
            .map_err(db_err("team storage update"))?;
        Ok(used)
    }

    // ── Membership ───────────────────────────────────────────────────────────

    /// Look up the person an invitation names, as `(id, email, name)`.
    ///
    /// Deleted accounts are excluded, so inviting a former colleague by an address that no longer
    /// belongs to anyone reads as "no such user" rather than resurrecting the row. Disabled
    /// accounts are *not* excluded: being disabled is a temporary state, and a team's membership
    /// should survive it rather than having to be rebuilt when the account comes back.
    pub fn find_user_by_email(
        &self,
        email: &str,
    ) -> Result<Option<(String, String, String)>, ApiError> {
        let mut conn = self.conn()?;
        users::table
            .filter(users::email.eq(email))
            .filter(users::deleted_at.is_null())
            .select((users::id, users::email, users::name))
            .first(&mut conn)
            .optional()
            .map_err(db_err("user lookup by email"))
    }

    pub fn list_members(&self, team_id: &str) -> Result<Vec<TeamMember>, ApiError> {
        let mut conn = self.conn()?;
        team_members::table
            .filter(team_members::team_id.eq(team_id))
            .order(team_members::created_at.asc())
            .select(TeamMember::as_select())
            .load(&mut conn)
            .map_err(db_err("team members list"))
    }

    pub fn find_member(
        &self,
        team_id: &str,
        user_id: &str,
    ) -> Result<Option<TeamMember>, ApiError> {
        let mut conn = self.conn()?;
        team_members::table
            .filter(team_members::team_id.eq(team_id))
            .filter(team_members::user_id.eq(user_id))
            .select(TeamMember::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team member find"))
    }

    pub fn count_members(&self, team_id: &str) -> Result<i64, ApiError> {
        let mut conn = self.conn()?;
        team_members::table
            .filter(team_members::team_id.eq(team_id))
            .count()
            .get_result(&mut conn)
            .map_err(db_err("team member count"))
    }

    /// How many people hold a given role. Used to refuse the change that would leave a team with
    /// no owner.
    pub fn count_with_role(&self, team_id: &str, role: &str) -> Result<i64, ApiError> {
        let mut conn = self.conn()?;
        team_members::table
            .filter(team_members::team_id.eq(team_id))
            .filter(team_members::role.eq(role))
            .count()
            .get_result(&mut conn)
            .map_err(db_err("team role count"))
    }

    pub fn insert_member(&self, member: &NewTeamMember) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(team_members::table)
            .values(member)
            .execute(&mut conn)
            .map_err(db_err("team member insert"))?;
        Ok(())
    }

    pub fn update_member_role(
        &self,
        team_id: &str,
        user_id: &str,
        role: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::update(
            team_members::table
                .filter(team_members::team_id.eq(team_id))
                .filter(team_members::user_id.eq(user_id)),
        )
        .set((
            team_members::role.eq(role),
            team_members::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(db_err("team member role update"))?;
        Ok(())
    }

    pub fn remove_member(&self, team_id: &str, user_id: &str) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::delete(
            team_members::table
                .filter(team_members::team_id.eq(team_id))
                .filter(team_members::user_id.eq(user_id)),
        )
        .execute(&mut conn)
        .map_err(db_err("team member delete"))?;
        Ok(())
    }

    // ── Discovery ────────────────────────────────────────────────────────────

    /// The teams this user could join: discoverable, live, not archived, and not already theirs.
    ///
    /// Archived teams are excluded even when discoverable. An archived team refuses every write,
    /// so joining one gets you a read-only room nobody can act in — findable is not the same as
    /// joinable, and offering it would be offering something that does not work.
    ///
    /// Two queries rather than a correlated subquery: the exclusion set is the caller's own
    /// memberships, which is a handful of ids, and `NOT IN` over them reads far more plainly than
    /// the join it replaces.
    pub fn list_discoverable_for_user(&self, user_id: &str) -> Result<Vec<Team>, ApiError> {
        let mut conn = self.conn()?;

        let already_mine: Vec<String> = team_members::table
            .filter(team_members::user_id.eq(user_id))
            .select(team_members::team_id)
            .load(&mut conn)
            .map_err(db_err("team discovery membership"))?;

        let discoverable: Vec<&str> = Visibility::ALL
            .iter()
            .filter(|v| v.is_discoverable())
            .map(|v| v.as_str())
            .collect();

        teams::table
            .filter(teams::deleted_at.is_null())
            .filter(teams::archived_at.is_null())
            .filter(teams::visibility.eq_any(discoverable))
            .filter(teams::id.ne_all(already_mine))
            .order(teams::name.asc())
            .select(Team::as_select())
            .load(&mut conn)
            .map_err(db_err("team discovery"))
    }

    // ── Join requests ────────────────────────────────────────────────────────

    pub fn insert_join_request(&self, req: &NewTeamJoinRequest) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(team_join_requests::table)
            .values(req)
            .execute(&mut conn)
            .map_err(db_err("team join request insert"))?;
        Ok(())
    }

    /// One request, looked up within its team so an id from another team cannot be decided here.
    pub fn find_join_request(
        &self,
        team_id: &str,
        request_id: &str,
    ) -> Result<Option<TeamJoinRequest>, ApiError> {
        let mut conn = self.conn()?;
        team_join_requests::table
            .filter(team_join_requests::id.eq(request_id))
            .filter(team_join_requests::team_id.eq(team_id))
            .select(TeamJoinRequest::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team join request find"))
    }

    /// This user's outstanding request for this team, if they have one.
    pub fn find_open_join_request(
        &self,
        team_id: &str,
        user_id: &str,
    ) -> Result<Option<TeamJoinRequest>, ApiError> {
        let mut conn = self.conn()?;
        team_join_requests::table
            .filter(team_join_requests::team_id.eq(team_id))
            .filter(team_join_requests::user_id.eq(user_id))
            .filter(team_join_requests::status.eq(RequestStatus::PENDING))
            .select(TeamJoinRequest::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team join request find open"))
    }

    /// The team ids this user has an outstanding request for, so the Discover list can mark them.
    pub fn teams_with_open_request(&self, user_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.conn()?;
        team_join_requests::table
            .filter(team_join_requests::user_id.eq(user_id))
            .filter(team_join_requests::status.eq(RequestStatus::PENDING))
            .select(team_join_requests::team_id)
            .load(&mut conn)
            .map_err(db_err("team open requests for user"))
    }

    /// A team's requests in one status, oldest first — the order an admin should answer them in.
    pub fn list_join_requests(
        &self,
        team_id: &str,
        status: &str,
    ) -> Result<Vec<TeamJoinRequest>, ApiError> {
        let mut conn = self.conn()?;
        team_join_requests::table
            .filter(team_join_requests::team_id.eq(team_id))
            .filter(team_join_requests::status.eq(status.to_string()))
            .order(team_join_requests::created_at.asc())
            .select(TeamJoinRequest::as_select())
            .load(&mut conn)
            .map_err(db_err("team join requests list"))
    }

    /// Answer a request. The row is kept, not deleted — see migration 00129.
    pub fn decide_join_request(
        &self,
        request_id: &str,
        status: &str,
        decided_by: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::update(team_join_requests::table.filter(team_join_requests::id.eq(request_id)))
            .set((
                team_join_requests::status.eq(status.to_string()),
                team_join_requests::decided_by.eq(decided_by.to_string()),
                team_join_requests::decided_at.eq(now),
                team_join_requests::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(db_err("team join request decide"))?;
        Ok(())
    }

    // ── Pages ────────────────────────────────────────────────────────────────

    /// Every live page in the team, ordered so a caller can build the tree in one pass: parents
    /// before children is not guaranteed, but siblings arrive in their manual order with ties
    /// broken on title.
    pub fn list_pages(&self, team_id: &str) -> Result<Vec<TeamPage>, ApiError> {
        let mut conn = self.conn()?;
        team_pages::table
            .filter(team_pages::team_id.eq(team_id))
            .filter(team_pages::deleted_at.is_null())
            .order((team_pages::sort_order.asc(), team_pages::title.asc()))
            .select(TeamPage::as_select())
            .load(&mut conn)
            .map_err(db_err("team pages list"))
    }

    pub fn find_page(&self, team_id: &str, page_id: &str) -> Result<Option<TeamPage>, ApiError> {
        let mut conn = self.conn()?;
        team_pages::table
            .filter(team_pages::team_id.eq(team_id))
            .filter(team_pages::id.eq(page_id))
            .filter(team_pages::deleted_at.is_null())
            .select(TeamPage::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team page find"))
    }

    pub fn find_home_page(&self, team_id: &str) -> Result<Option<TeamPage>, ApiError> {
        let mut conn = self.conn()?;
        team_pages::table
            .filter(team_pages::team_id.eq(team_id))
            .filter(team_pages::is_home.eq(1))
            .filter(team_pages::deleted_at.is_null())
            .select(TeamPage::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team home page find"))
    }

    pub fn page_slug_taken(&self, team_id: &str, slug: &str) -> Result<bool, ApiError> {
        let mut conn = self.conn()?;
        let count: i64 = team_pages::table
            .filter(team_pages::team_id.eq(team_id))
            .filter(team_pages::slug.eq(slug))
            .filter(team_pages::deleted_at.is_null())
            .count()
            .get_result(&mut conn)
            .map_err(db_err("team page slug check"))?;
        Ok(count > 0)
    }

    pub fn insert_page(&self, page: &NewTeamPage) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(team_pages::table)
            .values(page)
            .execute(&mut conn)
            .map_err(db_err("team page insert"))?;
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_page(
        &self,
        page_id: &str,
        title: Option<&str>,
        slug: Option<&str>,
        content_md: Option<&str>,
        icon: Option<Option<&str>>,
        cover_image: Option<Option<&str>>,
        parent_page_id: Option<Option<&str>>,
        sort_order: Option<i32>,
        published: Option<i32>,
        editor_id: &str,
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            macro_rules! set {
                ($col:expr, $value:expr) => {
                    if let Some(v) = $value {
                        diesel::update(team_pages::table.filter(team_pages::id.eq(page_id)))
                            .set($col.eq(v))
                            .execute(conn)?;
                    }
                };
            }
            set!(team_pages::title, title);
            set!(team_pages::slug, slug);
            set!(team_pages::content_md, content_md);
            set!(team_pages::icon, icon);
            set!(team_pages::cover_image, cover_image);
            set!(team_pages::parent_page_id, parent_page_id);
            set!(team_pages::sort_order, sort_order);
            set!(team_pages::published, published);
            diesel::update(team_pages::table.filter(team_pages::id.eq(page_id)))
                .set((
                    team_pages::last_edited_by.eq(editor_id),
                    team_pages::updated_at.eq(now),
                ))
                .execute(conn)?;
            Ok(())
        })
        .map_err(db_err("team page update"))?;
        Ok(())
    }

    /// The ids of a page's live children.
    pub fn child_page_ids(&self, page_id: &str) -> Result<Vec<String>, ApiError> {
        let mut conn = self.conn()?;
        team_pages::table
            .filter(team_pages::parent_page_id.eq(page_id))
            .filter(team_pages::deleted_at.is_null())
            .select(team_pages::id)
            .load(&mut conn)
            .map_err(db_err("team page children"))
    }

    /// Soft-delete a set of pages together — a page and its whole subtree, so a deleted parent
    /// never leaves its children reachable but orphaned in the tree.
    pub fn soft_delete_pages(
        &self,
        page_ids: &[String],
        now: NaiveDateTime,
    ) -> Result<(), ApiError> {
        let mut conn = self.conn()?;
        diesel::update(team_pages::table.filter(team_pages::id.eq_any(page_ids)))
            .set((
                team_pages::deleted_at.eq(now),
                team_pages::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(db_err("team page delete"))?;
        Ok(())
    }

    /// Full-text-ish search over a team's live pages, on title and body.
    ///
    /// A LIKE scan rather than the FTS index the rest of Drive search uses. A team's page count is
    /// in the hundreds, not the millions, and putting pages in the shared index is phase 7's job —
    /// it has to arrive together with team-scoped file and document results or the search box
    /// answers half a question.
    pub fn search_pages(&self, team_id: &str, query: &str) -> Result<Vec<TeamPage>, ApiError> {
        let mut conn = self.conn()?;
        let pattern = format!("%{}%", query.replace('%', "\\%").replace('_', "\\_"));
        team_pages::table
            .filter(team_pages::team_id.eq(team_id))
            .filter(team_pages::deleted_at.is_null())
            .filter(
                team_pages::title
                    .like(pattern.clone())
                    .escape('\\')
                    .or(team_pages::content_md.like(pattern).escape('\\')),
            )
            .order(team_pages::updated_at.desc())
            .select(TeamPage::as_select())
            .load(&mut conn)
            .map_err(db_err("team page search"))
    }

    // ── Page versions ────────────────────────────────────────────────────────

    pub fn list_page_versions(&self, page_id: &str) -> Result<Vec<TeamPageVersion>, ApiError> {
        let mut conn = self.conn()?;
        team_page_versions::table
            .filter(team_page_versions::page_id.eq(page_id))
            .order(team_page_versions::version_number.desc())
            .select(TeamPageVersion::as_select())
            .load(&mut conn)
            .map_err(db_err("team page versions list"))
    }

    pub fn find_page_version(
        &self,
        page_id: &str,
        version_id: &str,
    ) -> Result<Option<TeamPageVersion>, ApiError> {
        let mut conn = self.conn()?;
        team_page_versions::table
            .filter(team_page_versions::page_id.eq(page_id))
            .filter(team_page_versions::id.eq(version_id))
            .select(TeamPageVersion::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team page version find"))
    }

    /// Write a snapshot, numbering it one past the highest this page has ever had.
    ///
    /// The number comes from the maximum rather than from a count, so pruning old versions later
    /// cannot make a new version reuse a number an old one had — a version number in a URL keeps
    /// meaning the same snapshot.
    pub fn insert_page_version(
        &self,
        page_id: &str,
        title: &str,
        content_md: &str,
        label: Option<&str>,
        author_id: &str,
        author_name: &str,
        now: NaiveDateTime,
    ) -> Result<TeamPageVersion, ApiError> {
        let mut conn = self.conn()?;
        conn.transaction::<_, diesel::result::Error, _>(|conn| {
            let highest: Option<i32> = team_page_versions::table
                .filter(team_page_versions::page_id.eq(page_id))
                .select(diesel::dsl::max(team_page_versions::version_number))
                .first(conn)?;

            let version = NewTeamPageVersion {
                id: uuid::Uuid::new_v4().to_string(),
                page_id: page_id.to_string(),
                version_number: highest.unwrap_or(0) + 1,
                title: title.to_string(),
                content_md: content_md.to_string(),
                label: label.map(|s| s.to_string()),
                created_by: author_id.to_string(),
                created_by_name: author_name.to_string(),
                created_at: now,
            };
            diesel::insert_into(team_page_versions::table)
                .values(&version)
                .execute(conn)?;

            team_page_versions::table
                .filter(team_page_versions::id.eq(&version.id))
                .select(TeamPageVersion::as_select())
                .first(conn)
        })
        .map_err(db_err("team page version insert"))
    }

    // ── Activity ─────────────────────────────────────────────────────────────

    /// A team's activity, newest first.
    ///
    /// Read out of the shared `file_activity_log` rather than a table of its own: a team's writes
    /// are logged there with the team's id in `file_id` and `resource_type = 'team'`, so the
    /// retention, export and admin tooling that already covers activity covers this too. The pair
    /// of filters is what keeps a team's feed from picking up a file whose id happens to match.
    pub fn list_team_activity(
        &self,
        team_id: &str,
        limit: i64,
    ) -> Result<Vec<(String, String, String, Option<String>, NaiveDateTime)>, ApiError> {
        use crate::schema::file_activity_log as log;
        let mut conn = self.conn()?;
        log::table
            .filter(log::file_id.eq(team_id))
            .filter(log::resource_type.eq("team"))
            .order(log::created_at.desc())
            .limit(limit)
            .select((
                log::id,
                log::user_name,
                log::action,
                log::detail_json,
                log::created_at,
            ))
            .load(&mut conn)
            .map_err(db_err("team activity list"))
    }

    // ── Team file library ────────────────────────────────────────────────────

    /// The live files directly inside `folder_id` in this team, or at the team root when it is
    /// `None`.
    pub fn list_team_files(
        &self,
        team_id: &str,
        folder_id: Option<&str>,
    ) -> Result<Vec<FileRecord>, ApiError> {
        let mut conn = self.conn()?;
        let mut q = files::table
            .filter(files::team_id.eq(team_id))
            .filter(files::deleted_at.is_null())
            .into_boxed();
        q = match folder_id {
            Some(id) => q.filter(files::folder_id.eq(id.to_string())),
            None => q.filter(files::folder_id.is_null()),
        };
        q.order(files::name.asc())
            .select(FileRecord::as_select())
            .load(&mut conn)
            .map_err(db_err("team files list"))
    }

    pub fn list_team_folders(
        &self,
        team_id: &str,
        parent_id: Option<&str>,
    ) -> Result<Vec<FolderRecord>, ApiError> {
        let mut conn = self.conn()?;
        let mut q = folders::table
            .filter(folders::team_id.eq(team_id))
            .filter(folders::deleted_at.is_null())
            .into_boxed();
        q = match parent_id {
            Some(id) => q.filter(folders::parent_id.eq(id.to_string())),
            None => q.filter(folders::parent_id.is_null()),
        };
        q.order(folders::name.asc())
            .select(FolderRecord::as_select())
            .load(&mut conn)
            .map_err(db_err("team folders list"))
    }

    pub fn find_team_folder(
        &self,
        team_id: &str,
        folder_id: &str,
    ) -> Result<Option<FolderRecord>, ApiError> {
        let mut conn = self.conn()?;
        folders::table
            .filter(folders::team_id.eq(team_id))
            .filter(folders::id.eq(folder_id))
            .filter(folders::deleted_at.is_null())
            .select(FolderRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team folder find"))
    }

    /// Create a folder that belongs to the team rather than to the person creating it.
    ///
    /// `user_id` is still recorded — it is who made the folder — but it grants nothing here: the
    /// team's membership decides who may see it.
    pub fn insert_team_folder(
        &self,
        id: &str,
        team_id: &str,
        creator_id: &str,
        parent_id: Option<&str>,
        name: &str,
        now: NaiveDateTime,
    ) -> Result<FolderRecord, ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(folders::table)
            .values((
                folders::id.eq(id),
                folders::user_id.eq(creator_id),
                folders::team_id.eq(team_id),
                folders::parent_id.eq(parent_id),
                folders::name.eq(name),
                folders::created_at.eq(now),
                folders::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(db_err("team folder insert"))?;

        folders::table
            .filter(folders::id.eq(id))
            .select(FolderRecord::as_select())
            .first(&mut conn)
            .map_err(db_err("team folder fetch"))
    }

    /// Move an existing file into the team's library.
    ///
    /// This is how an upload lands in a team: the file is created by the ordinary upload path,
    /// which already handles the bytes, the encryption envelope, the thumbnail and the quota, and
    /// then it is claimed by the team. Re-implementing that path with a `team_id` threaded through
    /// it would be the parallel copy the success criteria rule out.
    pub fn claim_file_for_team(
        &self,
        file_id: &str,
        owner_id: &str,
        team_id: &str,
        folder_id: Option<&str>,
        now: NaiveDateTime,
    ) -> Result<Option<FileRecord>, ApiError> {
        let mut conn = self.conn()?;
        // Scoped to the caller's own untethered files: claiming is only ever the last step of that
        // caller's own upload, so a file already in a team — or belonging to someone else — is not
        // reachable through this.
        let updated = diesel::update(
            files::table
                .filter(files::id.eq(file_id))
                .filter(files::user_id.eq(owner_id))
                .filter(files::team_id.is_null())
                .filter(files::deleted_at.is_null()),
        )
        .set((
            files::team_id.eq(team_id),
            files::folder_id.eq(folder_id),
            files::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(db_err("team file claim"))?;

        if updated == 0 {
            return Ok(None);
        }

        files::table
            .filter(files::id.eq(file_id))
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team file fetch"))
    }

    /// A live file of the caller's own that is not yet in any team.
    ///
    /// The same set `claim_file_for_team` will act on, read first so the team's quota can be
    /// checked against the file's size before the move rather than after it.
    pub fn find_own_unclaimed_file(
        &self,
        file_id: &str,
        owner_id: &str,
    ) -> Result<Option<FileRecord>, ApiError> {
        let mut conn = self.conn()?;
        files::table
            .filter(files::id.eq(file_id))
            .filter(files::user_id.eq(owner_id))
            .filter(files::team_id.is_null())
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("unclaimed file find"))
    }

    pub fn find_team_file(
        &self,
        team_id: &str,
        file_id: &str,
    ) -> Result<Option<FileRecord>, ApiError> {
        let mut conn = self.conn()?;
        files::table
            .filter(files::team_id.eq(team_id))
            .filter(files::id.eq(file_id))
            .filter(files::deleted_at.is_null())
            .select(FileRecord::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team file find"))
    }

    pub fn trash_team_file(
        &self,
        team_id: &str,
        file_id: &str,
        now: NaiveDateTime,
    ) -> Result<usize, ApiError> {
        let mut conn = self.conn()?;
        diesel::update(
            files::table
                .filter(files::team_id.eq(team_id))
                .filter(files::id.eq(file_id))
                .filter(files::deleted_at.is_null()),
        )
        .set((files::deleted_at.eq(now), files::updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(db_err("team file trash"))
    }

    pub fn rename_team_file(
        &self,
        team_id: &str,
        file_id: &str,
        name: &str,
        now: NaiveDateTime,
    ) -> Result<usize, ApiError> {
        let mut conn = self.conn()?;
        diesel::update(
            files::table
                .filter(files::team_id.eq(team_id))
                .filter(files::id.eq(file_id))
                .filter(files::deleted_at.is_null()),
        )
        .set((files::name.eq(name), files::updated_at.eq(now)))
        .execute(&mut conn)
        .map_err(db_err("team file rename"))
    }

    // ── Transfers: moving and sharing a personal file (migration 00130) ───────

    /// How many people other than `mover` hold a grant on this file.
    ///
    /// Read *before* a move, and reported back, because the move is what makes those grants stop
    /// applying: `get_effective_role` consults team membership first and stops there, so a file
    /// that joins a team takes its shares out of circulation. The rows are left in place — they are
    /// inert, not wrong, and deleting them would take the file's history with them — but somebody
    /// is about to lose access to a file they could open this morning, and the mover should be told
    /// how many before rather than fielding the question after.
    pub fn count_other_permissions(&self, file_id: &str, mover: &str) -> Result<i64, ApiError> {
        let mut conn = self.conn()?;
        permissions::table
            .filter(permissions::resource_type.eq("file"))
            .filter(permissions::resource_id.eq(file_id))
            .filter(permissions::user_id.ne(mover))
            .count()
            .get_result(&mut conn)
            .map_err(db_err("file permission count"))
    }

    /// Lend a personal file to a team, or change the role it is already lent at.
    ///
    /// An upsert on `(team_id, file_id)` rather than an insert, because the unique index says a
    /// file is lent to a team once and re-sharing at a different role has to be an edit of that one
    /// row — two rows would make the answer depend on which came back first.
    pub fn upsert_file_share(
        &self,
        id: &str,
        team_id: &str,
        file_id: &str,
        role: &str,
        shared_by: &str,
        now: NaiveDateTime,
    ) -> Result<TeamFileShare, ApiError> {
        let mut conn = self.conn()?;
        diesel::insert_into(team_file_shares::table)
            .values((
                team_file_shares::id.eq(id),
                team_file_shares::team_id.eq(team_id),
                team_file_shares::file_id.eq(file_id),
                team_file_shares::role.eq(role),
                team_file_shares::shared_by.eq(shared_by),
                team_file_shares::created_at.eq(now),
                team_file_shares::updated_at.eq(now),
            ))
            .on_conflict((team_file_shares::team_id, team_file_shares::file_id))
            .do_update()
            .set((
                team_file_shares::role.eq(role),
                team_file_shares::shared_by.eq(shared_by),
                team_file_shares::updated_at.eq(now),
            ))
            .execute(&mut conn)
            .map_err(db_err("team file share upsert"))?;

        team_file_shares::table
            .filter(team_file_shares::team_id.eq(team_id))
            .filter(team_file_shares::file_id.eq(file_id))
            .select(TeamFileShare::as_select())
            .first(&mut conn)
            .map_err(db_err("team file share fetch"))
    }

    /// What has been lent to this team, newest first, with each file's current metadata.
    ///
    /// The join to `files` is an inner join with `deleted_at IS NULL` and `team_id IS NULL`, which
    /// makes three kinds of stale row invisible without a cleanup pass: the owner trashed the file,
    /// the owner later moved it into a team (where the team's own membership governs it and the
    /// share means nothing), or the row was orphaned. A share is a pointer at a file that is still
    /// somebody's personal file; when that stops being true the pointer stops resolving.
    /// The sharer's name is a *left* join: a share outlives the account that made it, and the row
    /// still says what the team may read.
    pub fn list_team_file_shares(
        &self,
        team_id: &str,
    ) -> Result<Vec<(TeamFileShare, FileRecord, Option<String>)>, ApiError> {
        let mut conn = self.conn()?;
        team_file_shares::table
            .inner_join(files::table.on(files::id.eq(team_file_shares::file_id)))
            .left_join(users::table.on(users::id.eq(team_file_shares::shared_by)))
            .filter(team_file_shares::team_id.eq(team_id))
            .filter(files::deleted_at.is_null())
            .filter(files::team_id.is_null())
            .order(team_file_shares::created_at.desc())
            .select((
                TeamFileShare::as_select(),
                FileRecord::as_select(),
                users::name.nullable(),
            ))
            .load(&mut conn)
            .map_err(db_err("team file shares list"))
    }

    /// The mirror image: which teams one file has been lent to, newest first.
    ///
    /// Asked by the file's own Share dialog, where teams sit beside the people in "who has access".
    /// Deleted teams are joined away for the reason the listing above joins away deleted files — a
    /// share is a pointer between two live rows — but an **archived** team is deliberately kept: it
    /// still holds the lend, and the owner taking it back is exactly what `unshare_file_from_team`
    /// lets them do while the team is archived.
    pub fn list_shares_for_file(
        &self,
        file_id: &str,
    ) -> Result<Vec<(TeamFileShare, Team)>, ApiError> {
        let mut conn = self.conn()?;
        team_file_shares::table
            .inner_join(teams::table.on(teams::id.eq(team_file_shares::team_id)))
            .filter(team_file_shares::file_id.eq(file_id))
            .filter(teams::deleted_at.is_null())
            .order(team_file_shares::created_at.desc())
            .select((TeamFileShare::as_select(), Team::as_select()))
            .load(&mut conn)
            .map_err(db_err("file team shares list"))
    }

    pub fn find_file_share(
        &self,
        team_id: &str,
        file_id: &str,
    ) -> Result<Option<TeamFileShare>, ApiError> {
        let mut conn = self.conn()?;
        team_file_shares::table
            .filter(team_file_shares::team_id.eq(team_id))
            .filter(team_file_shares::file_id.eq(file_id))
            .select(TeamFileShare::as_select())
            .first(&mut conn)
            .optional()
            .map_err(db_err("team file share find"))
    }

    pub fn delete_file_share(&self, team_id: &str, file_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.conn()?;
        diesel::delete(
            team_file_shares::table
                .filter(team_file_shares::team_id.eq(team_id))
                .filter(team_file_shares::file_id.eq(file_id)),
        )
        .execute(&mut conn)
        .map_err(db_err("team file share delete"))
    }

    // ── Administration (migration 00131) ─────────────────────────────────────

    /// Every live team with its true occupancy, for the admin console.
    ///
    /// One query, not one per team. The console's whole job here is "which team is about to run
    /// out?", which means every row needs a live figure — and computing that with
    /// [`Self::recalculate_storage`] per team would be two statements per row plus a write, on a
    /// page that exists to be scanned.
    ///
    /// Which is also why this **does not write the totals back**. The read is derived and correct
    /// as displayed; making an admin opening a list repair every team's cached counter would turn
    /// a page view into an unbounded write, and the counter is repaired on the read that actually
    /// depends on it (`get_team`) anyway.
    ///
    /// Raw SQL for the reason `recalculate_storage` gives: `diesel::dsl::sum` returns Numeric,
    /// which reaches Rust as a float, which is the wrong shape for byte counts past 2^53.
    pub fn list_teams_for_admin(
        &self,
        query: Option<&str>,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<AdminTeamRow>, ApiError> {
        use diesel::sql_types::{BigInt, Text};

        let mut conn = self.conn()?;
        let pattern = format!("%{}%", query.unwrap_or("").trim().to_lowercase());
        diesel::sql_query(
            "SELECT t.id            AS id, \
                    t.name          AS name, \
                    t.slug          AS slug, \
                    t.visibility    AS visibility, \
                    t.created_by    AS created_by, \
                    t.storage_limit_bytes AS storage_limit_bytes, \
                    t.created_at    AS created_at, \
                    (t.archived_at IS NOT NULL) AS archived, \
                    COALESCE((SELECT SUM(f.size_bytes) FROM files f \
                               WHERE f.team_id = t.id AND f.deleted_at IS NULL), 0) AS used_bytes, \
                    (SELECT COUNT(*) FROM team_members m WHERE m.team_id = t.id) AS member_count \
               FROM teams t \
              WHERE t.deleted_at IS NULL \
                AND (?1 = '%%' OR LOWER(t.name) LIKE ?1 OR LOWER(t.slug) LIKE ?1) \
              ORDER BY used_bytes DESC, t.name ASC \
              LIMIT ?2 OFFSET ?3",
        )
        .bind::<Text, _>(pattern)
        .bind::<BigInt, _>(limit)
        .bind::<BigInt, _>(offset)
        .load(&mut conn)
        .map_err(db_err("admin team list"))
    }

    /// Who owns each of these teams, as `(team_id, user_id, email, name)`.
    ///
    /// One query for the whole page rather than one per row, the same shape the console's user
    /// table uses for its storage column — a listing that costs a query per row is a listing that
    /// gets slower as the thing it monitors gets worse.
    ///
    /// A team can have several owners: the role is not a slot, and `remove_member` guards only
    /// against removing the *last* one. So this returns rows, not a map to a single owner, and the
    /// console renders however many there are. A team with **none** is also possible — the last
    /// owner's account can be deleted out from under it — and is exactly the state the transfer
    /// route exists to repair, so an empty list is a real answer rather than an error.
    pub fn list_owners_of_teams(
        &self,
        team_ids: &[String],
    ) -> Result<Vec<(String, String, String, String)>, ApiError> {
        if team_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.conn()?;
        team_members::table
            .filter(team_members::team_id.eq_any(team_ids))
            .filter(team_members::role.eq(Role::Owner.as_str()))
            .order(team_members::created_at.asc())
            .select((
                team_members::team_id,
                team_members::user_id,
                team_members::user_email,
                team_members::user_name,
            ))
            .load(&mut conn)
            .map_err(db_err("team owners list"))
    }

    /// How many live teams the same filter matches, so the console can page.
    pub fn count_teams_for_admin(&self, query: Option<&str>) -> Result<i64, ApiError> {
        let mut conn = self.conn()?;
        let pattern = format!("%{}%", query.unwrap_or("").trim().to_lowercase());
        let mut q = teams::table
            .filter(teams::deleted_at.is_null())
            .into_boxed();
        if pattern != "%%" {
            q = q.filter(
                teams::name
                    .like(pattern.clone())
                    .or(teams::slug.like(pattern)),
            );
        }
        q.count()
            .get_result(&mut conn)
            .map_err(db_err("admin team count"))
    }

    /// Set (or clear) a team's disk quota. `None` is unlimited.
    ///
    /// Separate from [`Self::update_team`], which is the route a team's own Owner takes: a team
    /// must not be able to raise its own limit, or it is not a limit. Nothing in the member-facing
    /// DTOs carries this field, and this method is reachable only from the admin surface.
    pub fn set_storage_limit(
        &self,
        team_id: &str,
        limit_bytes: Option<i64>,
        now: NaiveDateTime,
    ) -> Result<usize, ApiError> {
        let mut conn = self.conn()?;
        diesel::update(
            teams::table
                .filter(teams::id.eq(team_id))
                .filter(teams::deleted_at.is_null()),
        )
        .set((
            teams::storage_limit_bytes.eq(limit_bytes),
            teams::updated_at.eq(now),
        ))
        .execute(&mut conn)
        .map_err(db_err("team quota update"))
    }

    /// Drop every share of a file, whichever team it was lent to.
    ///
    /// Called when the file is moved into a team. A share says "this personal file of mine may be
    /// read by your team", and once the file is a team's own that sentence has no subject left: the
    /// owner it named no longer has any authority to lend it, and the listing would hide the rows
    /// anyway. Deleting is what makes moving a file into team A and out again — were that ever
    /// added — not silently restore a lend to team B that nobody has thought about since.
    pub fn delete_all_shares_of_file(&self, file_id: &str) -> Result<usize, ApiError> {
        let mut conn = self.conn()?;
        diesel::delete(team_file_shares::table.filter(team_file_shares::file_id.eq(file_id)))
            .execute(&mut conn)
            .map_err(db_err("team file shares delete"))
    }
}
