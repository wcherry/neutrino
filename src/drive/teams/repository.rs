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
use crate::drive::filesystem::model::FolderRecord;
use crate::drive::storage::model::FileRecord;
use crate::schema::{files, folders, team_members, team_page_versions, team_pages, teams, users};
use crate::shared::ApiError;

pub type DbPool = Pool<ConnectionManager<SqliteConnection>>;

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
}
