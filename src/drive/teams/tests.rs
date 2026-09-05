//! Service-level tests for Team Spaces (issue #185).
//!
//! These run against a real in-memory database with the real migrations, because most of what is
//! worth testing here is the interaction between a rule in the service and a constraint in the
//! schema — the single Home page, the last owner, the page tree. A mocked repository would assert
//! the service calls itself correctly and prove nothing about either.

use std::sync::Arc;

use diesel::prelude::*;
use diesel::r2d2::{ConnectionManager, Pool};
use diesel_migrations::MigrationHarness;

use super::dto::*;
use super::quota::DEFAULT_TEAM_QUOTA_BYTES;
use super::repository::{DbPool, TeamsRepository};
use super::roles::Role;
use super::service::{TeamsService, FLAG_TEAM_FILE_TRANSFERS, FLAG_TEAM_SPACES};
use crate::drive::activity::{repository::ActivityRepository, service::ActivityService};
use crate::drive::feature_flags::gate::FeatureGate;
use crate::drive::feature_flags::repository::FeatureFlagsRepository;
use crate::schema::{feature_flags, files, teams, users};
use crate::shared::AuthenticatedUser;

// ── Fixtures ─────────────────────────────────────────────────────────────────

struct Fixture {
    service: TeamsService,
    pool: DbPool,
}

fn user(id: &str, email: &str) -> AuthenticatedUser {
    AuthenticatedUser {
        user_id: id.to_string(),
        email: email.to_string(),
        token: String::new(),
        is_admin: false,
    }
}

impl Fixture {
    /// A stack with `teamSpaces` on, since a test that leaves it off is testing the gate rather
    /// than the feature. `gated_off` covers the other side.
    fn new() -> Self {
        let f = Self::gated_off();
        diesel::update(feature_flags::table.filter(feature_flags::key.eq(FLAG_TEAM_SPACES)))
            .set(feature_flags::enabled.eq(1))
            .execute(&mut f.pool.get().expect("conn"))
            .expect("enable flag");
        f
    }

    /// `teamSpaces` on *and* `teamFileTransfers` on — the stack the move and share routes need.
    ///
    /// A separate constructor rather than folding it into `new`, so that every test written before
    /// the second flag existed goes on running with it off and would catch a transfer route that
    /// forgot to ask for it.
    fn with_transfers() -> Self {
        let f = Self::new();
        f.set_flag(FLAG_TEAM_FILE_TRANSFERS, true);
        f
    }

    fn set_flag(&self, key: &str, on: bool) {
        diesel::update(feature_flags::table.filter(feature_flags::key.eq(key)))
            .set(feature_flags::enabled.eq(i32::from(on)))
            .execute(&mut self.pool.get().expect("conn"))
            .expect("set flag");
    }

    fn gated_off() -> Self {
        let manager = ConnectionManager::<SqliteConnection>::new(":memory:");
        let pool: DbPool = Pool::builder().max_size(1).build(manager).expect("pool");
        pool.get()
            .expect("conn")
            .run_pending_migrations(crate::MIGRATIONS)
            .expect("migrations");

        let service = TeamsService::new(
            Arc::new(TeamsRepository::new(pool.clone())),
            Arc::new(ActivityService::new(Arc::new(ActivityRepository::new(
                pool.clone(),
            )))),
            FeatureGate::new(Arc::new(FeatureFlagsRepository::new(pool.clone()))),
        );
        Fixture { service, pool }
    }

    /// Insert a user row. Adding someone to a team looks them up by email, so the invitee has to
    /// actually exist — and `teams.created_by` and `team_members.user_id` are real foreign keys,
    /// which SQLite enforces here, so every actor in a test needs a row too.
    fn add_user(&self, id: &str, email: &str, name: &str) {
        diesel::insert_or_ignore_into(users::table)
            .values((
                users::id.eq(id),
                users::email.eq(email),
                users::name.eq(name),
                users::password_hash.eq("x"),
                users::role.eq("user"),
            ))
            .execute(&mut self.pool.get().expect("conn"))
            .expect("insert user");
    }

    /// A file in the caller's own Drive, ready to be claimed into a team.
    fn add_file(&self, id: &str, owner: &str, name: &str, size: i64) {
        self.add_user(owner, &format!("{owner}@example.com"), owner);
        diesel::insert_into(files::table)
            .values((
                files::id.eq(id),
                files::user_id.eq(owner),
                files::name.eq(name),
                files::size_bytes.eq(size),
                files::mime_type.eq("text/plain"),
                files::storage_path.eq(format!("/tmp/{id}")),
            ))
            .execute(&mut self.pool.get().expect("conn"))
            .expect("insert file");
    }

    fn create_team(&self, name: &str, as_user: &AuthenticatedUser) -> TeamResponse {
        self.create_team_visible(name, None, as_user)
    }

    fn create_team_visible(
        &self,
        name: &str,
        visibility: Option<&str>,
        as_user: &AuthenticatedUser,
    ) -> TeamResponse {
        self.add_user(&as_user.user_id, &as_user.email, &as_user.email);
        self.service
            .create_team(
                CreateTeamRequest {
                    name: name.to_string(),
                    description: None,
                    avatar_color: None,
                    avatar_emoji: None,
                    visibility: visibility.map(str::to_string),
                },
                as_user,
            )
            .expect("create team")
    }

    /// A signed-in person who is in no team — the caller every discovery test needs.
    fn outsider(&self, id: &str) -> AuthenticatedUser {
        let email = format!("{id}@example.com");
        self.add_user(id, &email, id);
        user(id, &email)
    }
}

fn update_page_request() -> UpdatePageRequest {
    UpdatePageRequest {
        title: None,
        content_md: None,
        icon: None,
        cover_image: None,
        parent_page_id: None,
        sort_order: None,
        published: None,
        version_label: None,
    }
}

fn update_team_request() -> UpdateTeamRequest {
    UpdateTeamRequest {
        name: None,
        description: None,
        avatar_color: None,
        avatar_emoji: None,
        visibility: None,
        default_page_id: None,
        archived: None,
    }
}

// ── The gate ─────────────────────────────────────────────────────────────────

/// With the flag off the routes behave as though the feature does not exist — 404, not 403, so
/// probing team ids reveals nothing about what a deployment is about to ship.
#[test]
fn every_team_route_is_dark_while_the_flag_is_off() {
    let f = Fixture::gated_off();
    let owner = user("u1", "owner@example.com");

    let err = f.service.list_teams(&owner).expect_err("gated");
    assert_eq!(err.status, 404);

    let err = f
        .service
        .create_team(
            CreateTeamRequest {
                name: "Marketing".into(),
                description: None,
                avatar_color: None,
                avatar_emoji: None,
                visibility: None,
            },
            &owner,
        )
        .expect_err("gated");
    assert_eq!(err.status, 404);
}

/// The one flag governs the whole feature — pages, the file library and the activity feed
/// included. There is no state in which a team exists but its wiki does not.
#[test]
fn the_single_flag_governs_every_part_of_the_feature() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    // On: every surface answers.
    assert!(f.service.list_pages(&team.id, None, &owner).is_ok());
    assert!(f.service.list_library(&team.id, None, &owner).is_ok());
    assert!(f.service.list_activity(&team.id, &owner).is_ok());

    // Off: all of them go dark together, and so does the team itself.
    diesel::update(feature_flags::table.filter(feature_flags::key.eq(FLAG_TEAM_SPACES)))
        .set(feature_flags::enabled.eq(0))
        .execute(&mut f.pool.get().expect("conn"))
        .expect("disable");

    for status in [
        f.service.get_team(&team.id, &owner).expect_err("gated").status,
        f.service
            .list_pages(&team.id, None, &owner)
            .expect_err("gated")
            .status,
        f.service
            .list_library(&team.id, None, &owner)
            .expect_err("gated")
            .status,
        f.service.list_activity(&team.id, &owner).expect_err("gated").status,
        f.service.list_discoverable(&owner).expect_err("gated").status,
        f.service.join_team(&team.id, &owner).expect_err("gated").status,
    ] {
        assert_eq!(status, 404);
    }
}

/// The gate is read per request, not cached at startup — which is the whole reason these are rows
/// rather than environment variables.
#[test]
fn toggling_the_flag_takes_effect_without_a_restart() {
    let f = Fixture::gated_off();
    let owner = user("u1", "owner@example.com");
    f.add_user("u1", "owner@example.com", "Owner");

    assert_eq!(f.service.list_teams(&owner).expect_err("off").status, 404);

    diesel::update(feature_flags::table.filter(feature_flags::key.eq(FLAG_TEAM_SPACES)))
        .set(feature_flags::enabled.eq(1))
        .execute(&mut f.pool.get().expect("conn"))
        .expect("enable");

    // The same service instance, no rebuild, no restart.
    assert_eq!(f.service.list_teams(&owner).expect("on").total, 0);
}

// ── Phase 1: the Team object ─────────────────────────────────────────────────

#[test]
fn creating_a_team_makes_the_creator_its_owner() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(team.name, "Marketing");
    assert_eq!(team.slug, "marketing");
    assert_eq!(team.user_role, Role::Owner.as_str());
    assert_eq!(team.member_count, 1);
    assert!(!team.archived);
}

/// Phase 2's first deliverable, and a property the schema depends on: a team is never without a
/// Home page, not even between being created and first being opened.
#[test]
fn a_new_team_comes_with_a_home_page_it_opens_on() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let pages = f.service.list_pages(&team.id, None, &owner).expect("pages");
    assert_eq!(pages.total, 1);
    assert!(pages.pages[0].is_home);
    assert_eq!(pages.pages[0].title, "Home");

    assert_eq!(
        team.default_page_id.as_deref(),
        Some(pages.pages[0].id.as_str()),
        "the team should open on its Home page"
    );

    let home = f
        .service
        .get_page(&team.id, &pages.pages[0].id, &owner)
        .expect("home");
    assert!(home
        .content_md
        .expect("home has content")
        .contains("Welcome to Marketing"));
}

/// Two teams of the same name are allowed; two live teams with the same slug are not, because the
/// slug is what links point at.
#[test]
fn a_second_team_of_the_same_name_gets_its_own_slug() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    assert_eq!(f.create_team("Marketing", &owner).slug, "marketing");
    assert_eq!(f.create_team("Marketing", &owner).slug, "marketing-2");
}

#[test]
fn a_team_needs_a_name() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let err = f
        .service
        .create_team(
            CreateTeamRequest {
                name: "   ".into(),
                description: None,
                avatar_color: None,
                avatar_emoji: None,
                visibility: None,
            },
            &owner,
        )
        .expect_err("blank name");
    assert_eq!(err.status, 400);
}

/// The central access rule: a team a caller has no role in is indistinguishable from one that does
/// not exist. 403 would confirm it exists.
#[test]
fn a_non_member_cannot_tell_a_team_apart_from_one_that_does_not_exist() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let stranger = user("u2", "stranger@example.com");
    let team = f.create_team("Marketing", &owner);

    let err = f.service.get_team(&team.id, &stranger).expect_err("hidden");
    assert_eq!(err.status, 404);

    let missing = f
        .service
        .get_team("no-such-team", &stranger)
        .expect_err("missing");
    assert_eq!(
        (err.status, err.message),
        (missing.status, missing.message),
        "a hidden team and a missing one must be indistinguishable"
    );

    assert_eq!(f.service.list_teams(&stranger).expect("list").total, 0);
}

/// Being a Neutrino administrator is authority over the deployment, not membership of every team
/// on it.
#[test]
fn an_administrator_is_not_a_member_of_every_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let mut admin = user("u2", "admin@example.com");
    admin.is_admin = true;
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service.get_team(&team.id, &admin).expect_err("hidden").status,
        404
    );
}

#[test]
fn renaming_a_team_does_not_move_it() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let renamed = f
        .service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                name: Some("Growth".into()),
                ..update_team_request()
            },
            &owner,
        )
        .expect("rename");

    assert_eq!(renamed.name, "Growth");
    assert_eq!(
        renamed.slug, "marketing",
        "the slug is what links point at, so a rename must not break them"
    );
}

/// Archiving is the pause button: reads keep working, writes stop, and the team comes back.
#[test]
fn an_archived_team_is_read_only_until_it_is_restored() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(true),
                ..update_team_request()
            },
            &owner,
        )
        .expect("archive");

    assert!(f.service.get_team(&team.id, &owner).expect("read").archived);
    assert_eq!(
        f.service
            .create_page(
                &team.id,
                CreatePageRequest {
                    title: "Notes".into(),
                    parent_page_id: None,
                    content_md: None,
                    icon: None,
                },
                &owner,
            )
            .expect_err("archived is read-only")
            .status,
        403
    );

    let restored = f
        .service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(false),
                ..update_team_request()
            },
            &owner,
        )
        .expect("restore");
    assert!(!restored.archived);
    assert!(f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Notes".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .is_ok());
}

#[test]
fn a_deleted_team_leaves_the_list_and_frees_its_slug() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    f.service.delete_team(&team.id, &owner).expect("delete");
    assert_eq!(f.service.list_teams(&owner).expect("list").total, 0);
    assert_eq!(
        f.service.get_team(&team.id, &owner).expect_err("gone").status,
        404
    );
    assert_eq!(f.create_team("Marketing", &owner).slug, "marketing");
}

// ── Phase 6: roles ───────────────────────────────────────────────────────────

#[test]
fn only_an_owner_can_delete_a_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let admin = user("u2", "admin@example.com");
    f.add_user("u2", "admin@example.com", "Admin");
    let team = f.create_team("Marketing", &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "admin@example.com".into(),
                role: "admin".into(),
            },
            &owner,
        )
        .expect("add admin");

    assert_eq!(
        f.service.delete_team(&team.id, &admin).expect_err("refused").status,
        403
    );
    assert!(f.service.delete_team(&team.id, &owner).is_ok());
}

#[test]
fn a_contributor_can_write_a_page_but_not_delete_one() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let contributor = user("u2", "c@example.com");
    f.add_user("u2", "c@example.com", "Cass");
    let team = f.create_team("Marketing", &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "c@example.com".into(),
                role: "contributor".into(),
            },
            &owner,
        )
        .expect("add contributor");

    let page = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Roadmap".into(),
                parent_page_id: None,
                content_md: Some("draft".into()),
                icon: None,
            },
            &contributor,
        )
        .expect("contributor can create");

    assert!(f
        .service
        .update_page(
            &team.id,
            &page.id,
            UpdatePageRequest {
                content_md: Some("revised".into()),
                ..update_page_request()
            },
            &contributor,
        )
        .is_ok());

    assert_eq!(
        f.service
            .delete_page(&team.id, &page.id, &contributor)
            .expect_err("refused")
            .status,
        403
    );
}

#[test]
fn a_viewer_writes_nothing() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let viewer = user("u2", "v@example.com");
    f.add_user("u2", "v@example.com", "Val");
    let team = f.create_team("Marketing", &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "v@example.com".into(),
                role: "viewer".into(),
            },
            &owner,
        )
        .expect("add viewer");

    assert!(f.service.get_team(&team.id, &viewer).is_ok());
    assert_eq!(
        f.service
            .create_page(
                &team.id,
                CreatePageRequest {
                    title: "x".into(),
                    parent_page_id: None,
                    content_md: None,
                    icon: None,
                },
                &viewer,
            )
            .expect_err("refused")
            .status,
        403
    );
}

/// An Admin inviting an Owner would be granting more authority than they hold, and could then be
/// removed by the person they promoted.
#[test]
fn an_admin_cannot_mint_an_owner() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let admin = user("u2", "admin@example.com");
    f.add_user("u2", "admin@example.com", "Admin");
    f.add_user("u3", "new@example.com", "New");
    let team = f.create_team("Marketing", &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "admin@example.com".into(),
                role: "admin".into(),
            },
            &owner,
        )
        .expect("add admin");

    assert_eq!(
        f.service
            .add_member(
                &team.id,
                AddMemberRequest {
                    email: "new@example.com".into(),
                    role: "owner".into(),
                },
                &admin,
            )
            .expect_err("refused")
            .status,
        403
    );
}

/// A team with no owner can never be deleted, renamed or handed on again.
#[test]
fn the_last_owner_cannot_be_demoted_or_removed() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service
            .update_member(
                &team.id,
                "u1",
                UpdateMemberRequest {
                    role: "viewer".into()
                },
                &owner,
            )
            .expect_err("refused")
            .status,
        409
    );
    assert_eq!(
        f.service.remove_member(&team.id, "u1", &owner).expect_err("refused").status,
        409
    );
}

/// Leaving is not managing permissions, so a Viewer — who can manage nothing — can still leave.
#[test]
fn anyone_can_leave_a_team_they_are_in() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let viewer = user("u2", "v@example.com");
    f.add_user("u2", "v@example.com", "Val");
    let team = f.create_team("Marketing", &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "v@example.com".into(),
                role: "viewer".into(),
            },
            &owner,
        )
        .expect("add viewer");

    assert!(f.service.remove_member(&team.id, "u2", &viewer).is_ok());
    assert_eq!(
        f.service.get_team(&team.id, &viewer).expect_err("gone").status,
        404
    );
}

#[test]
fn an_unknown_role_is_rejected_rather_than_defaulted() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    f.add_user("u2", "x@example.com", "X");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service
            .add_member(
                &team.id,
                AddMemberRequest {
                    email: "x@example.com".into(),
                    role: "superuser".into(),
                },
                &owner,
            )
            .expect_err("refused")
            .status,
        400
    );
}

#[test]
fn inviting_an_address_with_no_account_says_so() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service
            .add_member(
                &team.id,
                AddMemberRequest {
                    email: "nobody@example.com".into(),
                    role: "viewer".into(),
                },
                &owner,
            )
            .expect_err("refused")
            .status,
        404
    );
}

// ── Phases 2–3: pages ────────────────────────────────────────────────────────

#[test]
fn pages_nest_and_the_tree_is_reported_flat_with_parents() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let parent = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Meetings".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("parent");
    let child = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "2026".into(),
                parent_page_id: Some(parent.id.clone()),
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("child");

    assert_eq!(child.parent_page_id.as_deref(), Some(parent.id.as_str()));
    let listed = f.service.list_pages(&team.id, None, &owner).expect("list");
    assert_eq!(listed.total, 3, "Home plus the two new pages");
    assert!(
        listed.pages.iter().all(|p| p.content_md.is_none()),
        "a list response must not carry every page's whole body"
    );
}

/// A cycle satisfies every foreign key, and would make both the sidebar's tree walk and the
/// recursive delete spin forever.
#[test]
fn a_page_cannot_be_moved_inside_its_own_subtree() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let parent = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Meetings".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("parent");
    let child = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "2026".into(),
                parent_page_id: Some(parent.id.clone()),
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("child");

    for (page, new_parent) in [(&parent, &child), (&parent, &parent)] {
        assert_eq!(
            f.service
                .update_page(
                    &team.id,
                    &page.id,
                    UpdatePageRequest {
                        parent_page_id: Some(Some(new_parent.id.clone())),
                        ..update_page_request()
                    },
                    &owner,
                )
                .expect_err("cycle refused")
                .status,
            400
        );
    }
}

#[test]
fn deleting_a_page_takes_its_subpages_with_it() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let parent = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Meetings".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("parent");
    f.service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "2026".into(),
                parent_page_id: Some(parent.id.clone()),
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("child");

    f.service
        .delete_page(&team.id, &parent.id, &owner)
        .expect("delete");
    let listed = f.service.list_pages(&team.id, None, &owner).expect("list");
    assert_eq!(listed.total, 1, "only Home should be left");
}

/// The partial unique index guarantees a live team has exactly one Home page, and the rest of the
/// code is allowed to rely on that.
#[test]
fn the_home_page_cannot_be_deleted_or_nested() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    let home_id = team.default_page_id.clone().expect("home");

    let other = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Roadmap".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("page");

    assert_eq!(
        f.service.delete_page(&team.id, &home_id, &owner).expect_err("refused").status,
        400
    );
    assert_eq!(
        f.service
            .update_page(
                &team.id,
                &home_id,
                UpdatePageRequest {
                    parent_page_id: Some(Some(other.id)),
                    ..update_page_request()
                },
                &owner,
            )
            .expect_err("refused")
            .status,
        400
    );
}

/// A version records what the page *was*, so the history is a list of states the page has held.
#[test]
fn changing_a_page_body_records_what_it_replaced() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let page = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Roadmap".into(),
                parent_page_id: None,
                content_md: Some("first".into()),
                icon: None,
            },
            &owner,
        )
        .expect("page");

    f.service
        .update_page(
            &team.id,
            &page.id,
            UpdatePageRequest {
                content_md: Some("second".into()),
                version_label: Some("After review".into()),
                ..update_page_request()
            },
            &owner,
        )
        .expect("edit");

    let versions = f
        .service
        .list_page_versions(&team.id, &page.id, &owner)
        .expect("versions");
    assert_eq!(versions.total, 1);
    assert_eq!(versions.versions[0].version_number, 1);
    assert_eq!(versions.versions[0].label.as_deref(), Some("After review"));

    let snapshot = f
        .service
        .get_page_version(&team.id, &page.id, &versions.versions[0].id, &owner)
        .expect("version");
    assert_eq!(snapshot.content_md.as_deref(), Some("first"));
}

/// A rename is not an edit of the body, and a version per rename would bury the edits worth
/// finding.
#[test]
fn renaming_a_page_does_not_record_a_version() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let page = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Roadmap".into(),
                parent_page_id: None,
                content_md: Some("body".into()),
                icon: None,
            },
            &owner,
        )
        .expect("page");

    f.service
        .update_page(
            &team.id,
            &page.id,
            UpdatePageRequest {
                title: Some("Plan".into()),
                ..update_page_request()
            },
            &owner,
        )
        .expect("rename");

    assert_eq!(
        f.service
            .list_page_versions(&team.id, &page.id, &owner)
            .expect("versions")
            .total,
        0
    );
}

/// Restoring the wrong version must not destroy what it replaced.
#[test]
fn restoring_a_version_records_the_one_it_replaced() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let page = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Roadmap".into(),
                parent_page_id: None,
                content_md: Some("first".into()),
                icon: None,
            },
            &owner,
        )
        .expect("page");
    f.service
        .update_page(
            &team.id,
            &page.id,
            UpdatePageRequest {
                content_md: Some("second".into()),
                ..update_page_request()
            },
            &owner,
        )
        .expect("edit");

    let v1 = f
        .service
        .list_page_versions(&team.id, &page.id, &owner)
        .expect("versions")
        .versions
        .remove(0);

    let restored = f
        .service
        .restore_page_version(&team.id, &page.id, &v1.id, &owner)
        .expect("restore");
    assert_eq!(restored.content_md.as_deref(), Some("first"));

    let versions = f
        .service
        .list_page_versions(&team.id, &page.id, &owner)
        .expect("versions");
    assert_eq!(versions.total, 2, "the restore records what it replaced");
    let newest = f
        .service
        .get_page_version(&team.id, &page.id, &versions.versions[0].id, &owner)
        .expect("newest");
    assert_eq!(newest.content_md.as_deref(), Some("second"));
}

#[test]
fn duplicating_a_page_copies_its_body_and_is_never_the_home_page() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    let home_id = team.default_page_id.clone().expect("home");

    let copy = f
        .service
        .duplicate_page(&team.id, &home_id, &owner)
        .expect("duplicate");
    assert_eq!(copy.title, "Home (copy)");
    assert!(!copy.is_home);
    assert!(copy
        .content_md
        .expect("body")
        .contains("Welcome to Marketing"));
}

#[test]
fn page_search_matches_title_and_body_within_the_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    let other = f.create_team("Engineering", &owner);

    f.service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Q3 Roadmap".into(),
                parent_page_id: None,
                content_md: Some("Hiring plan for the quarter".into()),
                icon: None,
            },
            &owner,
        )
        .expect("page");
    f.service
        .create_page(
            &other.id,
            CreatePageRequest {
                title: "Q3 Roadmap".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("page in the other team");

    let by_title = f
        .service
        .list_pages(&team.id, Some("roadmap"), &owner)
        .expect("search");
    assert_eq!(by_title.total, 1, "search must not cross team boundaries");

    let by_body = f
        .service
        .list_pages(&team.id, Some("Hiring"), &owner)
        .expect("search");
    assert_eq!(by_body.total, 1);
}

/// A page id from one team must not be readable through another team the caller does belong to.
#[test]
fn a_page_is_only_reachable_through_its_own_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let a = f.create_team("Marketing", &owner);
    let b = f.create_team("Engineering", &owner);

    let page = f
        .service
        .create_page(
            &a.id,
            CreatePageRequest {
                title: "Secret".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("page");

    assert_eq!(
        f.service.get_page(&b.id, &page.id, &owner).expect_err("hidden").status,
        404
    );
}

// ── Phase 4: the file library ────────────────────────────────────────────────

#[test]
fn a_file_claimed_by_a_team_appears_in_its_library_and_moves_its_meter() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 2048);

    let claimed = f
        .service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: None,
            },
            &owner,
        )
        .expect("claim");
    assert_eq!(claimed.name, "Budget.xlsx");

    let library = f.service.list_library(&team.id, None, &owner).expect("library");
    assert_eq!(library.files.len(), 1);
    assert_eq!(library.storage_used_bytes, 2048);
}

#[test]
fn a_team_folder_scopes_the_library_listing() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let folder = f
        .service
        .create_library_folder(
            &team.id,
            CreateTeamFolderRequest {
                name: "Contracts".into(),
                parent_id: None,
            },
            &owner,
        )
        .expect("folder");

    f.add_file("file-1", "u1", "Deal.pdf", 10);
    f.service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: Some(folder.id.clone()),
            },
            &owner,
        )
        .expect("claim");

    let root = f.service.list_library(&team.id, None, &owner).expect("root");
    assert_eq!(root.folders.len(), 1);
    assert_eq!(root.files.len(), 0, "the file is inside the folder");

    let inside = f
        .service
        .list_library(&team.id, Some(&folder.id), &owner)
        .expect("folder");
    assert_eq!(inside.files.len(), 1);
}

/// Claiming reaches only the caller's own untethered files, so a file already in a team — or
/// somebody else's — cannot be pulled across by id.
#[test]
fn claiming_cannot_take_a_file_that_is_not_the_callers_to_move() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let other = user("u2", "other@example.com");
    f.add_user("u2", "other@example.com", "Other");
    let team = f.create_team("Marketing", &owner);
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "other@example.com".into(),
                role: "editor".into(),
            },
            &owner,
        )
        .expect("add editor");

    f.add_file("file-1", "u1", "Private.txt", 10);

    assert_eq!(
        f.service
            .claim_file(
                &team.id,
                ClaimFileRequest {
                    file_id: "file-1".into(),
                    folder_id: None,
                },
                &other,
            )
            .expect_err("not theirs")
            .status,
        404
    );
}

#[test]
fn a_contributor_can_add_a_file_but_not_delete_one() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let contributor = user("u2", "c@example.com");
    f.add_user("u2", "c@example.com", "Cass");
    let team = f.create_team("Marketing", &owner);
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "c@example.com".into(),
                role: "contributor".into(),
            },
            &owner,
        )
        .expect("add contributor");

    f.add_file("file-1", "u2", "Notes.txt", 10);
    f.service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: None,
            },
            &contributor,
        )
        .expect("contributor can upload");

    assert_eq!(
        f.service
            .trash_library_file(&team.id, "file-1", &contributor)
            .expect_err("refused")
            .status,
        403
    );
    assert!(f.service.trash_library_file(&team.id, "file-1", &owner).is_ok());
}

#[test]
fn trashing_a_team_file_takes_its_bytes_off_the_team_meter() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Big.bin", 5000);

    f.service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: None,
            },
            &owner,
        )
        .expect("claim");
    f.service
        .trash_library_file(&team.id, "file-1", &owner)
        .expect("trash");

    let library = f.service.list_library(&team.id, None, &owner).expect("library");
    assert_eq!(library.files.len(), 0);
    assert_eq!(library.storage_used_bytes, 0);
}

/// A team's files are the team's, so they must not appear in the uploader's own Drive — the
/// scoping added to `filesystem`/`storage` in migration 00128's wake.
#[test]
fn a_team_file_leaves_the_uploaders_my_drive() {
    use crate::drive::filesystem::repository::FilesystemRepository;
    use crate::shared::ListQueryParams;

    let all = ListQueryParams {
        limit: None,
        offset: None,
        order_by: None,
        direction: None,
    };

    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 10);
    f.add_file("file-2", "u1", "Personal.txt", 10);

    let fs = FilesystemRepository::new(f.pool.clone());
    let listed = fs
        .list_files_in_folder("u1", None, &all, None)
        .expect("my drive");
    assert_eq!(listed.len(), 2, "both files start in My Drive");

    f.service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: None,
            },
            &owner,
        )
        .expect("claim");

    let listed = fs
        .list_files_in_folder("u1", None, &all, None)
        .expect("my drive");
    assert_eq!(
        listed.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(),
        vec!["Personal.txt"],
        "the claimed file belongs to the team now"
    );
}

/// Team membership is what lets another member read a team's file, through the same effective-role
/// check every other Drive read already goes through.
#[test]
fn team_membership_grants_a_drive_role_over_the_teams_files() {
    use crate::drive::permissions::repository::PermissionsRepository;

    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    f.add_user("u2", "v@example.com", "Val");
    let team = f.create_team("Marketing", &owner);
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "v@example.com".into(),
                role: "viewer".into(),
            },
            &owner,
        )
        .expect("add viewer");

    f.add_file("file-1", "u1", "Budget.xlsx", 10);
    f.service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: None,
            },
            &owner,
        )
        .expect("claim");

    let perms = PermissionsRepository::new(f.pool.clone());
    assert_eq!(
        perms.get_file_team_id("file-1").expect("team id").as_deref(),
        Some(team.id.as_str())
    );
    assert_eq!(
        perms.find_team_role(&team.id, "u2").expect("role").as_deref(),
        Some("viewer")
    );
    assert_eq!(perms.find_team_role(&team.id, "u3").expect("role"), None);
}

// ── Disk quota and its administration ────────────────────────────────────────

/// The migration's backfill and the Rust constant are two copies of one number, and this is what
/// stops them drifting. It runs the real migrations, so a change to either without the other fails
/// here rather than as a team that was created with one limit and backfilled to another.
#[test]
fn the_backfilled_quota_matches_the_constant() {
    let f = Fixture::gated_off();
    // Before taking the connection: the test pool holds exactly one, and `add_user` wants it.
    f.add_user("u1", "owner@example.com", "Owner");
    let mut conn = f.pool.get().expect("conn");

    // A team from before the backfill — inserted with no limit, as 00126 through 00130 left them.
    diesel::insert_into(teams::table)
        .values((
            teams::id.eq("legacy"),
            teams::name.eq("Legacy"),
            teams::slug.eq("legacy"),
            teams::visibility.eq("private"),
            teams::created_by.eq("u1"),
        ))
        .execute(&mut conn)
        .expect("insert legacy team");

    // Re-run the backfill statement exactly as 00131 writes it. If the constant moves and the
    // migration does not, these disagree.
    diesel::sql_query(
        "UPDATE teams SET storage_limit_bytes = 10737418240 \
          WHERE storage_limit_bytes IS NULL AND deleted_at IS NULL",
    )
    .execute(&mut conn)
    .expect("backfill");

    let limit: Option<i64> = teams::table
        .filter(teams::id.eq("legacy"))
        .select(teams::storage_limit_bytes)
        .first(&mut conn)
        .expect("read limit");
    assert_eq!(
        limit,
        Some(DEFAULT_TEAM_QUOTA_BYTES),
        "migration 00131's backfill and DEFAULT_TEAM_QUOTA_BYTES must be the same number"
    );
}

/// A new team starts with a limit rather than unlimited, because a team that begins with no quota
/// never acquires one by itself.
#[test]
fn a_new_team_is_created_with_the_default_quota() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(team.storage_limit_bytes, Some(DEFAULT_TEAM_QUOTA_BYTES));
    assert_eq!(team.storage_used_bytes, 0);
}

/// The figure the Settings page reads is recomputed on the read, so a counter that has drifted —
/// a file purged or restored through the ordinary Drive routes, which do not touch it — is
/// repaired rather than displayed wrong for ever.
#[test]
fn reading_a_team_repairs_a_drifted_storage_counter() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 2048);
    f.service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect("move");

    // Corrupt the cached counter behind the service's back, as a purge elsewhere would.
    diesel::update(teams::table.filter(teams::id.eq(&team.id)))
        .set(teams::storage_used_bytes.eq(999_999_i64))
        .execute(&mut f.pool.get().expect("conn"))
        .expect("corrupt counter");

    let read = f.service.get_team(&team.id, &owner).expect("get");
    assert_eq!(read.storage_used_bytes, 2048, "the read should self-heal");
}

/// The listing is the console's whole reason to exist: which team is closest to full.
#[test]
fn the_admin_listing_orders_teams_by_how_full_they_are() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let small = f.create_team("Small", &owner);
    let big = f.create_team("Big", &owner);

    f.add_file("file-1", "u1", "Little.txt", 10);
    f.add_file("file-2", "u1", "Large.bin", 5000);
    f.service
        .move_file_into_team(&small.id, move_request("file-1"), &owner)
        .expect("move");
    f.service
        .move_file_into_team(&big.id, move_request("file-2"), &owner)
        .expect("move");

    let list = f.service.admin_list_teams(None, 50, 0).expect("list");
    assert_eq!(list.total, 2);
    assert_eq!(list.teams[0].id, big.id, "fullest first");
    assert_eq!(list.teams[0].storage_used_bytes, 5000);
    assert_eq!(
        list.teams[0].storage_remaining_bytes,
        Some(DEFAULT_TEAM_QUOTA_BYTES - 5000)
    );
    assert_eq!(list.teams[1].storage_used_bytes, 10);
    assert!(!list.teams[0].over_quota);
    assert_eq!(list.teams[0].member_count, 1);
}

/// The listing computes occupancy from the file rows, so it is right even when the cached counter
/// is not — an administrator diagnosing a full disk must not be shown the stale number.
#[test]
fn the_admin_listing_does_not_trust_the_cached_counter() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 2048);
    f.service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect("move");

    diesel::update(teams::table.filter(teams::id.eq(&team.id)))
        .set(teams::storage_used_bytes.eq(0_i64))
        .execute(&mut f.pool.get().expect("conn"))
        .expect("corrupt counter");

    let list = f.service.admin_list_teams(None, 50, 0).expect("list");
    assert_eq!(list.teams[0].storage_used_bytes, 2048);
}

#[test]
fn the_admin_listing_filters_and_pages() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    f.create_team("Marketing", &owner);
    f.create_team("Design", &owner);
    f.create_team("Engineering", &owner);

    let filtered = f
        .service
        .admin_list_teams(Some("desi"), 50, 0)
        .expect("filtered");
    assert_eq!(filtered.total, 1);
    assert_eq!(filtered.teams[0].name, "Design");

    // `total` is every match, not the page — otherwise the console cannot render a pager.
    let page = f.service.admin_list_teams(None, 2, 0).expect("page");
    assert_eq!(page.total, 3);
    assert_eq!(page.teams.len(), 2);
    let rest = f.service.admin_list_teams(None, 2, 2).expect("rest");
    assert_eq!(rest.teams.len(), 1);
}

/// A page size arriving from a URL is a number, not a promise. An unbounded one is an unbounded
/// query, and a zero or negative one is a listing that returns nothing for no stated reason.
#[test]
fn the_admin_listing_clamps_its_page_size() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    for name in ["A", "B", "C"] {
        f.create_team(name, &owner);
    }

    assert_eq!(
        f.service.admin_list_teams(None, 100_000, 0).expect("huge").teams.len(),
        3
    );
    assert_eq!(
        f.service.admin_list_teams(None, 0, 0).expect("zero").teams.len(),
        1,
        "a page size of zero is clamped up to one, not down to nothing"
    );
    assert_eq!(
        f.service.admin_list_teams(None, 50, -5).expect("negative offset").teams.len(),
        3
    );
}

/// A deleted team is gone from the console as well as from its members' lists.
#[test]
fn a_deleted_team_is_not_in_the_admin_listing() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.service.delete_team(&team.id, &owner).expect("delete");

    assert_eq!(f.service.admin_list_teams(None, 50, 0).expect("list").total, 0);
}

#[test]
fn an_administrator_can_set_and_clear_a_teams_quota() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let raised = f
        .service
        .admin_set_team_quota(
            &team.id,
            SetTeamQuotaRequest {
                storage_limit_bytes: Some(50_000),
            },
            "admin-1",
        )
        .expect("raise");
    assert_eq!(raised.storage_limit_bytes, Some(50_000));
    assert_eq!(raised.storage_remaining_bytes, Some(50_000));

    // `null` is unlimited, and it is a choice rather than an absence.
    let unlimited = f
        .service
        .admin_set_team_quota(
            &team.id,
            SetTeamQuotaRequest {
                storage_limit_bytes: None,
            },
            "admin-1",
        )
        .expect("unlimited");
    assert_eq!(unlimited.storage_limit_bytes, None);
    assert_eq!(unlimited.storage_remaining_bytes, None);

    // And the team sees it, since the member-facing DTO reads the same column.
    assert_eq!(
        f.service.get_team(&team.id, &owner).expect("get").storage_limit_bytes,
        None
    );
}

/// The change lands in the team's own activity feed. An administrator changing what a team may
/// store is something that happened *to* the team, and finding out by hitting the limit is worse
/// than finding out by reading the feed.
#[test]
fn a_quota_change_is_logged_where_the_team_can_see_it() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    f.service
        .admin_set_team_quota(
            &team.id,
            SetTeamQuotaRequest {
                storage_limit_bytes: Some(1234),
            },
            "admin-1",
        )
        .expect("set");

    let feed = f.service.list_activity(&team.id, &owner).expect("activity");
    let entry = feed
        .entries
        .iter()
        .find(|e| e.action == "team.quota_changed")
        .expect("the change should be in the feed");
    assert_eq!(entry.detail.as_ref().expect("detail")["to"], 1234);
}

/// Lowering a limit below what a team already holds is allowed and deletes nothing. It is the only
/// way to say "this team has grown too far" without the sentence meaning "delete some of their
/// work": the files stay, and the next one is refused.
#[test]
fn a_lowered_quota_keeps_the_files_and_refuses_the_next_one() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 5000);
    f.service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect("move");

    let lowered = f
        .service
        .admin_set_team_quota(
            &team.id,
            SetTeamQuotaRequest {
                storage_limit_bytes: Some(100),
            },
            "admin-1",
        )
        .expect("lower");
    assert!(lowered.over_quota);
    assert_eq!(
        lowered.storage_remaining_bytes,
        Some(0),
        "no room left, rather than a negative number"
    );

    // The file is still there.
    assert_eq!(
        f.service.list_library(&team.id, None, &owner).expect("library").files.len(),
        1
    );

    // And the next one is refused.
    f.add_file("file-2", "u1", "Another.txt", 1);
    assert_eq!(
        f.service
            .move_file_into_team(&team.id, move_request("file-2"), &owner)
            .expect_err("over quota")
            .status,
        413
    );
}

/// A team's own Owner cannot raise its quota — a limit a team can lift is not a limit. There is no
/// field for it on `UpdateTeamRequest` and this asserts the write path stays that way.
#[test]
fn a_team_owner_cannot_change_their_own_quota() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                name: Some("Renamed".into()),
                ..update_team_request()
            },
            &owner,
        )
        .expect("rename");

    assert_eq!(
        f.service.get_team(&team.id, &owner).expect("get").storage_limit_bytes,
        Some(DEFAULT_TEAM_QUOTA_BYTES),
        "nothing a team's own Owner can send should move its limit"
    );
}

#[test]
fn a_negative_quota_is_refused() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let err = f
        .service
        .admin_set_team_quota(
            &team.id,
            SetTeamQuotaRequest {
                storage_limit_bytes: Some(-1),
            },
            "admin-1",
        )
        .expect_err("negative");
    assert_eq!(err.status, 400);
}

/// An archived team can still have its quota changed. Archiving pauses the team's own writes, and
/// a deployment's storage policy is not one of the team's writes.
#[test]
fn an_archived_teams_quota_can_still_be_set() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(true),
                ..update_team_request()
            },
            &owner,
        )
        .expect("archive");

    let updated = f
        .service
        .admin_set_team_quota(
            &team.id,
            SetTeamQuotaRequest {
                storage_limit_bytes: Some(4096),
            },
            "admin-1",
        )
        .expect("set on an archived team");
    assert!(updated.archived);
    assert_eq!(updated.storage_limit_bytes, Some(4096));
}

/// The admin routes are behind `teamSpaces` like everything else here: with the flag off no team
/// can exist, so a console listing them is a page about nothing, and a 404 keeps the rule that a
/// gated feature is invisible rather than merely refused.
#[test]
fn the_admin_routes_are_behind_the_flag() {
    let f = Fixture::gated_off();

    assert_eq!(
        f.service.admin_list_teams(None, 50, 0).expect_err("gated").status,
        404
    );
    assert_eq!(
        f.service
            .admin_set_team_quota(
                "any-team",
                SetTeamQuotaRequest {
                    storage_limit_bytes: Some(1),
                },
                "admin-1",
            )
            .expect_err("gated")
            .status,
        404
    );
    assert_eq!(
        f.service
            .admin_set_team_owner(
                "any-team",
                SetTeamOwnerRequest {
                    email: "someone@example.com".into(),
                },
                "admin-1",
            )
            .expect_err("gated")
            .status,
        404
    );
    assert_eq!(
        f.service
            .admin_set_team_archived(
                "any-team",
                SetTeamArchivedRequest { archived: true },
                "admin-1",
            )
            .expect_err("gated")
            .status,
        404
    );
    assert_eq!(
        f.service
            .admin_delete_team("any-team", "admin-1")
            .expect_err("gated")
            .status,
        404
    );
}

// ── Administering a team from outside it ─────────────────────────────────────

/// Ownership is not a slot, so the console shows however many Owners a team has — including none.
#[test]
fn the_admin_listing_names_the_teams_owners() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "second@example.com", "Second Owner");
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "second@example.com".into(),
                role: "owner".into(),
            },
            &owner,
        )
        .expect("add second owner");

    let list = f.service.admin_list_teams(None, 50, 0).expect("list");
    let owners = &list.teams[0].owners;
    assert_eq!(owners.len(), 2);
    assert!(owners.iter().any(|o| o.user_id == "u1"));
    assert!(owners.iter().any(|o| o.name == "Second Owner"));

    // Members who are not Owners are counted, not listed.
    assert_eq!(list.teams[0].member_count, 2);
}

/// A team whose only Owner has been removed has none, and that is a real state rather than an
/// error — it is the one the transfer route exists to repair.
#[test]
fn a_team_with_no_owner_lists_none_rather_than_failing() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    // Reach past the service's last-owner guard, which is the point: this state is reachable in
    // production by the Owner's *account* being deleted, not by anyone calling remove_member.
    diesel::delete(
        crate::schema::team_members::table.filter(crate::schema::team_members::team_id.eq(&team.id)),
    )
    .execute(&mut f.pool.get().expect("conn"))
    .expect("orphan the team");

    let list = f.service.admin_list_teams(None, 50, 0).expect("list");
    assert!(list.teams[0].owners.is_empty());
}

/// The transfer is a transfer: the named person becomes Owner and the previous Owner is demoted to
/// Admin — not removed, so the change is one click back.
#[test]
fn transferring_ownership_demotes_the_previous_owner_to_admin() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "new@example.com", "New Owner");

    let updated = f
        .service
        .admin_set_team_owner(
            &team.id,
            SetTeamOwnerRequest {
                email: "new@example.com".into(),
            },
            "admin-1",
        )
        .expect("transfer");

    assert_eq!(updated.owners.len(), 1);
    assert_eq!(updated.owners[0].user_id, "u2");

    let members = f.service.list_members(&team.id, &owner).expect("members");
    let previous = members
        .members
        .iter()
        .find(|m| m.user_id == "u1")
        .expect("the previous owner is still a member");
    assert_eq!(previous.role, "admin", "demoted, not removed");
}

/// The new Owner does not have to be in the team already — that is the whole point when the
/// previous one has left.
#[test]
fn ownership_can_be_given_to_someone_outside_the_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u9", "outsider@example.com", "Outsider");

    let updated = f
        .service
        .admin_set_team_owner(
            &team.id,
            SetTeamOwnerRequest {
                email: "outsider@example.com".into(),
            },
            "admin-1",
        )
        .expect("transfer");

    assert_eq!(updated.owners[0].user_id, "u9");
    assert_eq!(updated.member_count, 2, "they were added as a member");
}

/// The case only this route can fix: a team with no Owner gets one.
#[test]
fn an_ownerless_team_can_be_given_an_owner() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "rescuer@example.com", "Rescuer");
    diesel::delete(
        crate::schema::team_members::table.filter(crate::schema::team_members::team_id.eq(&team.id)),
    )
    .execute(&mut f.pool.get().expect("conn"))
    .expect("orphan the team");

    let updated = f
        .service
        .admin_set_team_owner(
            &team.id,
            SetTeamOwnerRequest {
                email: "rescuer@example.com".into(),
            },
            "admin-1",
        )
        .expect("rescue");

    assert_eq!(updated.owners.len(), 1);
    assert_eq!(updated.owners[0].user_id, "u2");
}

/// Handing a team to the person who already owns it changes nothing, rather than demoting them on
/// the way to promoting them.
#[test]
fn transferring_to_the_existing_owner_leaves_them_the_owner() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let updated = f
        .service
        .admin_set_team_owner(
            &team.id,
            SetTeamOwnerRequest {
                email: "owner@example.com".into(),
            },
            "admin-1",
        )
        .expect("no-op transfer");

    assert_eq!(updated.owners.len(), 1);
    assert_eq!(updated.owners[0].user_id, "u1");
    assert_eq!(updated.member_count, 1);
}

/// An email nobody has is a 404, not an invitation. A team owned by an address no account has
/// claimed is the same ownerless state this route exists to end.
#[test]
fn ownership_cannot_be_given_to_an_address_with_no_account() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service
            .admin_set_team_owner(
                &team.id,
                SetTeamOwnerRequest {
                    email: "nobody@example.com".into(),
                },
                "admin-1",
            )
            .expect_err("no such account")
            .status,
        404
    );
    assert_eq!(
        f.service
            .admin_set_team_owner(
                &team.id,
                SetTeamOwnerRequest { email: "  ".into() },
                "admin-1",
            )
            .expect_err("blank")
            .status,
        400
    );
}

/// An archived team can still be handed over: archiving pauses the team's own writes, and deciding
/// who is answerable for it is not one of them — a team frozen with no owner would have nobody able
/// to unfreeze it.
#[test]
fn an_archived_team_can_still_be_handed_over() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "new@example.com", "New Owner");
    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(true),
                ..update_team_request()
            },
            &owner,
        )
        .expect("archive");

    let updated = f
        .service
        .admin_set_team_owner(
            &team.id,
            SetTeamOwnerRequest {
                email: "new@example.com".into(),
            },
            "admin-1",
        )
        .expect("transfer on an archived team");
    assert!(updated.archived);
    assert_eq!(updated.owners[0].user_id, "u2");
}

#[test]
fn an_administrator_can_archive_and_restore_a_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    let archived = f
        .service
        .admin_set_team_archived(&team.id, SetTeamArchivedRequest { archived: true }, "admin-1")
        .expect("archive");
    assert!(archived.archived);
    // The team feels it: its own writes are refused.
    assert_eq!(
        f.service
            .create_page(
                &team.id,
                CreatePageRequest {
                    title: "Notes".into(),
                    parent_page_id: None,
                    content_md: None,
                    icon: None,
                },
                &owner,
            )
            .expect_err("archived")
            .status,
        403
    );

    let restored = f
        .service
        .admin_set_team_archived(&team.id, SetTeamArchivedRequest { archived: false }, "admin-1")
        .expect("restore");
    assert!(!restored.archived);
    assert!(f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Notes".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .is_ok());
}

/// Sending the state it already has is a no-op that writes no audit entry — a feed full of
/// "archived an archived team" is a feed nobody reads.
#[test]
fn archiving_an_already_archived_team_logs_nothing() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    f.service
        .admin_set_team_archived(&team.id, SetTeamArchivedRequest { archived: true }, "admin-1")
        .expect("archive");
    f.service
        .admin_set_team_archived(&team.id, SetTeamArchivedRequest { archived: true }, "admin-1")
        .expect("archive again");

    let feed = f.service.list_activity(&team.id, &owner).expect("activity");
    assert_eq!(
        feed.entries.iter().filter(|e| e.action == "team.archived").count(),
        1,
        "the second request should have been a no-op"
    );
}

/// Deleting takes the team out of the console and out of its members' lists. Soft, so the row and
/// everything cascading off it survive — but nothing here lists a deleted team, deliberately.
#[test]
fn an_administrator_can_delete_a_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    f.service.admin_delete_team(&team.id, "admin-1").expect("delete");

    assert_eq!(f.service.admin_list_teams(None, 50, 0).expect("list").total, 0);
    assert_eq!(f.service.list_teams(&owner).expect("member list").total, 0);
    assert_eq!(
        f.service.get_team(&team.id, &owner).expect_err("gone").status,
        404
    );
}

/// The case the member-facing route cannot serve: `delete_team` requires an Owner, and an
/// ownerless team has none.
#[test]
fn an_ownerless_team_can_still_be_deleted_by_an_administrator() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    diesel::delete(
        crate::schema::team_members::table.filter(crate::schema::team_members::team_id.eq(&team.id)),
    )
    .execute(&mut f.pool.get().expect("conn"))
    .expect("orphan the team");

    // The member route is now unreachable for everyone — nobody has a role in this team.
    assert_eq!(
        f.service.delete_team(&team.id, &owner).expect_err("no role").status,
        404
    );
    f.service.admin_delete_team(&team.id, "admin-1").expect("admin delete");
    assert_eq!(f.service.admin_list_teams(None, 50, 0).expect("list").total, 0);
}

#[test]
fn administering_a_team_that_does_not_exist_is_a_404() {
    let f = Fixture::new();

    for status in [
        f.service
            .admin_set_team_owner(
                "no-such-team",
                SetTeamOwnerRequest {
                    email: "owner@example.com".into(),
                },
                "admin-1",
            )
            .expect_err("gone")
            .status,
        f.service
            .admin_set_team_archived(
                "no-such-team",
                SetTeamArchivedRequest { archived: true },
                "admin-1",
            )
            .expect_err("gone")
            .status,
        f.service
            .admin_delete_team("no-such-team", "admin-1")
            .expect_err("gone")
            .status,
    ] {
        assert_eq!(status, 404);
    }
}

/// Every administrator action lands in the team's own feed, where its members can see it. Being
/// told is the difference between a team that knows an administrator acted and one that discovers
/// it by hitting the consequence.
#[test]
fn every_admin_action_is_recorded_in_the_teams_feed() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "new@example.com", "New Owner");

    f.service
        .admin_set_team_owner(
            &team.id,
            SetTeamOwnerRequest {
                email: "new@example.com".into(),
            },
            "admin-1",
        )
        .expect("transfer");
    f.service
        .admin_set_team_archived(&team.id, SetTeamArchivedRequest { archived: true }, "admin-1")
        .expect("archive");

    // Read as the new owner: the previous one is an Admin now and can still see the team, but
    // reading as whoever holds it is the more honest check.
    let reader = user("u2", "new@example.com");
    let feed = f.service.list_activity(&team.id, &reader).expect("activity");
    let actions: Vec<&str> = feed.entries.iter().map(|e| e.action.as_str()).collect();
    assert!(actions.contains(&"team.owner_transferred"), "{actions:?}");
    assert!(actions.contains(&"team.archived"), "{actions:?}");
    // And the entry says it came from outside the team, not from a member.
    let transfer = feed
        .entries
        .iter()
        .find(|e| e.action == "team.owner_transferred")
        .expect("entry");
    assert_eq!(transfer.actor, "administrator");
}

// ── Transfers: moving and sharing a personal file ────────────────────────────

fn move_request(file_id: &str) -> MoveFileIntoTeamRequest {
    MoveFileIntoTeamRequest {
        file_id: file_id.into(),
        folder_id: None,
    }
}

fn share_request(file_id: &str, role: Option<&str>) -> ShareFileWithTeamRequest {
    ShareFileWithTeamRequest {
        file_id: file_id.into(),
        role: role.map(str::to_string),
    }
}

/// The second flag is a switch of its own: with Team Spaces fully on and this off, the team is
/// there, its library is there, and the two routes that reach into My Drive are not.
#[test]
fn transfers_are_dark_while_only_team_spaces_is_on() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 10);

    // Team Spaces itself is unaffected.
    assert!(f.service.list_library(&team.id, None, &owner).is_ok());

    for status in [
        f.service
            .move_file_into_team(&team.id, move_request("file-1"), &owner)
            .expect_err("gated")
            .status,
        f.service
            .share_file_with_team(&team.id, share_request("file-1", None), &owner)
            .expect_err("gated")
            .status,
        f.service
            .list_shared_files(&team.id, &owner)
            .expect_err("gated")
            .status,
        f.service
            .unshare_file_from_team(&team.id, "file-1", &owner)
            .expect_err("gated")
            .status,
    ] {
        assert_eq!(status, 404, "a gated-off transfer route must be invisible");
    }
}

/// `teamSpaces` is checked first, so a deployment with only the transfer flag on is
/// indistinguishable from one with neither — no route starts answering differently for a real team
/// id while Team Spaces is switched off.
#[test]
fn the_transfer_flag_alone_turns_nothing_on() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 10);
    f.set_flag(FLAG_TEAM_SPACES, false);

    let err = f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect_err("gated");
    assert_eq!(err.status, 404);
}

#[test]
fn moving_a_personal_file_puts_it_in_the_team_and_moves_the_meter() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 2048);

    let moved = f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect("move");
    assert_eq!(moved.file.name, "Budget.xlsx");
    assert_eq!(moved.shares_no_longer_applied, 0);

    let library = f.service.list_library(&team.id, None, &owner).expect("library");
    assert_eq!(library.files.len(), 1);
    assert_eq!(library.storage_used_bytes, 2048);
}

/// The move reports what it costs. Every upload writes its uploader an `owner` permission row and
/// each share writes another, and all of them stop applying the moment the file is a team's — so
/// the count is the number of people about to lose access, and the mover is told before rather
/// than after.
#[test]
fn a_move_reports_the_shares_it_makes_inert() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 10);
    f.add_user("u2", "other@example.com", "Other");
    f.add_user("u3", "third@example.com", "Third");

    use crate::drive::permissions::repository::PermissionsRepository;
    let perms = PermissionsRepository::new(f.pool.clone());
    for (id, user_id) in [("p1", "u1"), ("p2", "u2"), ("p3", "u3")] {
        perms
            .upsert_permission(&crate::drive::permissions::model::NewPermissionRecord {
                id,
                resource_type: "file",
                resource_id: "file-1",
                user_id,
                role: if user_id == "u1" { "owner" } else { "editor" },
                granted_by: "u1",
                user_email: "",
                user_name: "",
            })
            .expect("grant");
    }

    let moved = f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect("move");
    assert_eq!(
        moved.shares_no_longer_applied, 2,
        "the mover's own grant is not one of the losses"
    );
}

/// A move reaches only the caller's own untethered files, exactly as a claim does — a file already
/// in a team, or somebody else's, cannot be pulled across by id.
#[test]
fn a_move_cannot_take_a_file_that_is_not_the_callers() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u2", "Someone else's.txt", 10);

    let err = f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect_err("not the caller's");
    assert_eq!(err.status, 404);

    // And a file already in this team cannot be moved into it again.
    f.add_file("file-2", "u1", "Mine.txt", 10);
    f.service
        .move_file_into_team(&team.id, move_request("file-2"), &owner)
        .expect("first move");
    let err = f
        .service
        .move_file_into_team(&team.id, move_request("file-2"), &owner)
        .expect_err("already a team's");
    assert_eq!(err.status, 404);
}

/// A Viewer reads the team and writes nothing to it, and a file appearing in the library is a
/// write however it got there.
#[test]
fn a_viewer_can_neither_move_nor_share_into_a_team() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let viewer = user("u2", "viewer@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "viewer@example.com", "Viewer");
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "viewer@example.com".into(),
                role: "viewer".into(),
            },
            &owner,
        )
        .expect("add viewer");
    f.add_file("file-1", "u2", "Notes.txt", 10);

    assert_eq!(
        f.service
            .move_file_into_team(&team.id, move_request("file-1"), &viewer)
            .expect_err("viewer")
            .status,
        403
    );
    assert_eq!(
        f.service
            .share_file_with_team(&team.id, share_request("file-1", None), &viewer)
            .expect_err("viewer")
            .status,
        403
    );
}

/// A Contributor adds but does not remove, and both of these add.
#[test]
fn a_contributor_can_move_and_share() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let contributor = user("u2", "contrib@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "contrib@example.com", "Contrib");
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "contrib@example.com".into(),
                role: "contributor".into(),
            },
            &owner,
        )
        .expect("add contributor");

    f.add_file("file-1", "u2", "Draft.md", 10);
    f.add_file("file-2", "u2", "Lent.md", 10);
    assert!(f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &contributor)
        .is_ok());
    assert!(f
        .service
        .share_file_with_team(&team.id, share_request("file-2", None), &contributor)
        .is_ok());
}

/// A team a caller is not in does not exist, transfers included — the 404 rule does not soften for
/// a route that happens to be about the caller's own file.
#[test]
fn a_non_member_cannot_move_a_file_into_a_team() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    let stranger = f.outsider("u9");
    f.add_file("file-1", "u9", "Mine.txt", 10);

    let err = f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &stranger)
        .expect_err("not a member");
    assert_eq!(err.status, 404);
}

#[test]
fn a_move_is_refused_when_the_team_has_no_room() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    diesel::update(teams::table.filter(teams::id.eq(&team.id)))
        .set(teams::storage_limit_bytes.eq(Some(100_i64)))
        .execute(&mut f.pool.get().expect("conn"))
        .expect("set limit");

    f.add_file("file-1", "u1", "Huge.bin", 500);
    let err = f
        .service
        .move_file_into_team(&team.id, move_request("file-1"), &owner)
        .expect_err("over quota");
    assert_eq!(err.status, 413);

    // Refused before anything moved: the file is still the caller's to move.
    assert!(f
        .service
        .list_library(&team.id, None, &owner)
        .expect("library")
        .files
        .is_empty());
}

/// An archived team is read-only for everyone, and a move is a write to it.
#[test]
fn an_archived_team_accepts_neither_a_move_nor_a_share() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(true),
                ..update_team_request()
            },
            &owner,
        )
        .expect("archive");
    f.add_file("file-1", "u1", "Budget.xlsx", 10);

    assert_eq!(
        f.service
            .move_file_into_team(&team.id, move_request("file-1"), &owner)
            .expect_err("archived")
            .status,
        403
    );
    assert_eq!(
        f.service
            .share_file_with_team(&team.id, share_request("file-1", None), &owner)
            .expect_err("archived")
            .status,
        403
    );
}

/// A share leaves the file exactly where it was. That is the whole difference from a move, and it
/// is what makes a share revocable: the file never stopped being the sharer's.
#[test]
fn sharing_lends_a_file_without_moving_it() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Roadmap.md", 64);

    let share = f
        .service
        .share_file_with_team(&team.id, share_request("file-1", Some("editor")), &owner)
        .expect("share");
    assert_eq!(share.role, "editor");
    assert_eq!(share.name, "Roadmap.md");

    // Still in My Drive: not in the team's library, and not counted against the team's meter.
    let library = f.service.list_library(&team.id, None, &owner).expect("library");
    assert!(library.files.is_empty());
    assert_eq!(library.storage_used_bytes, 0);

    use crate::drive::permissions::repository::PermissionsRepository;
    let perms = PermissionsRepository::new(f.pool.clone());
    assert_eq!(perms.get_file_team_id("file-1").expect("team id"), None);

    let shared = f.service.list_shared_files(&team.id, &owner).expect("list");
    assert_eq!(shared.total, 1);
    assert_eq!(shared.files[0].file_id, "file-1");
    assert_eq!(shared.files[0].shared_by, "u1");
}

/// Sharing again edits the one row rather than adding a second, so the team's access to a file has
/// exactly one answer and it is not decided by row order.
#[test]
fn re_sharing_changes_the_role_rather_than_adding_a_second_share() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Roadmap.md", 10);

    f.service
        .share_file_with_team(&team.id, share_request("file-1", Some("viewer")), &owner)
        .expect("share");
    f.service
        .share_file_with_team(&team.id, share_request("file-1", Some("editor")), &owner)
        .expect("re-share");

    let shared = f.service.list_shared_files(&team.id, &owner).expect("list");
    assert_eq!(shared.total, 1);
    assert_eq!(shared.files[0].role, "editor");
}

/// `owner` is a real Drive role and the one a share will not grant: lending a file to a team is not
/// handing every member the authority to give it away.
#[test]
fn a_share_will_not_grant_ownership_or_an_unknown_role() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Roadmap.md", 10);

    for role in ["owner", "commenter", "", "Editor"] {
        let err = f
            .service
            .share_file_with_team(&team.id, share_request("file-1", Some(role)), &owner)
            .expect_err("bad role");
        assert_eq!(err.status, 400, "role {role:?} should be rejected");
    }

    // The default, when none is named, is the one that cannot surprise anybody.
    let share = f
        .service
        .share_file_with_team(&team.id, share_request("file-1", None), &owner)
        .expect("default role");
    assert_eq!(share.role, "viewer");
}

/// A file that has since been trashed, or moved into a team, drops out of the listing rather than
/// rendering as a row pointing at nothing. There is no cleanup pass; the join is the cleanup.
#[test]
fn a_shared_file_that_stops_being_personal_leaves_the_listing() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    let other = f.create_team("Design", &owner);
    f.add_file("file-1", "u1", "Roadmap.md", 10);

    f.service
        .share_file_with_team(&team.id, share_request("file-1", None), &owner)
        .expect("share");
    assert_eq!(
        f.service.list_shared_files(&team.id, &owner).expect("list").total,
        1
    );

    // Moving it into another team takes it out of the sharer's hands entirely.
    f.service
        .move_file_into_team(&other.id, move_request("file-1"), &owner)
        .expect("move");
    assert_eq!(
        f.service.list_shared_files(&team.id, &owner).expect("list").total,
        0
    );
}

/// The owner can take a lend back at any time; so can a team admin, because a team decides what
/// appears on its own Files page. Nobody else can, including the team's other content editors.
#[test]
fn only_the_sharer_or_a_team_admin_can_unshare() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let editor = user("u2", "editor@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "editor@example.com", "Editor");
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "editor@example.com".into(),
                role: "editor".into(),
            },
            &owner,
        )
        .expect("add editor");

    f.add_file("file-1", "u1", "Roadmap.md", 10);
    f.service
        .share_file_with_team(&team.id, share_request("file-1", None), &owner)
        .expect("share");

    // An Editor has every authority over the team's *content* and none over someone's personal
    // file, so this is the one file operation in a team they cannot perform.
    assert_eq!(
        f.service
            .unshare_file_from_team(&team.id, "file-1", &editor)
            .expect_err("editor")
            .status,
        403
    );

    // The sharer can.
    f.service
        .unshare_file_from_team(&team.id, "file-1", &owner)
        .expect("unshare");
    assert_eq!(
        f.service.list_shared_files(&team.id, &owner).expect("list").total,
        0
    );
}

/// An admin can turn down a file lent by somebody else.
#[test]
fn a_team_admin_can_remove_a_file_someone_else_shared() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let contributor = user("u2", "contrib@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_user("u2", "contrib@example.com", "Contrib");
    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "contrib@example.com".into(),
                role: "contributor".into(),
            },
            &owner,
        )
        .expect("add contributor");

    f.add_file("file-1", "u2", "Draft.md", 10);
    f.service
        .share_file_with_team(&team.id, share_request("file-1", None), &contributor)
        .expect("share");

    f.service
        .unshare_file_from_team(&team.id, "file-1", &owner)
        .expect("admin removes it");
    assert_eq!(
        f.service.list_shared_files(&team.id, &owner).expect("list").total,
        0
    );
}

/// An archived team must not be able to hold on to somebody's personal file — archiving is the
/// pause button for the team's own content, not a lock on other people's.
#[test]
fn a_lend_can_be_taken_back_from_an_archived_team() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Roadmap.md", 10);
    f.service
        .share_file_with_team(&team.id, share_request("file-1", None), &owner)
        .expect("share");
    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(true),
                ..update_team_request()
            },
            &owner,
        )
        .expect("archive");

    f.service
        .unshare_file_from_team(&team.id, "file-1", &owner)
        .expect("unshare from an archived team");
}

/// A member who is not in the team sees nothing, and a stranger unsharing gets the same 404 as for
/// a team that never existed.
#[test]
fn shares_are_invisible_outside_the_team() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    let stranger = f.outsider("u9");
    f.add_file("file-1", "u1", "Roadmap.md", 10);
    f.service
        .share_file_with_team(&team.id, share_request("file-1", None), &owner)
        .expect("share");

    assert_eq!(
        f.service
            .list_shared_files(&team.id, &stranger)
            .expect_err("stranger")
            .status,
        404
    );
    assert_eq!(
        f.service
            .unshare_file_from_team(&team.id, "file-1", &stranger)
            .expect_err("stranger")
            .status,
        404
    );
}

/// Moving a file into a team drops every lend of it, because "this personal file of mine may be
/// read by your team" has no subject left once the file is a team's.
#[test]
fn moving_a_file_into_a_team_ends_its_lends_to_other_teams() {
    let f = Fixture::with_transfers();
    let owner = user("u1", "owner@example.com");
    let lender = f.create_team("Design", &owner);
    let destination = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Roadmap.md", 10);

    f.service
        .share_file_with_team(&lender.id, share_request("file-1", None), &owner)
        .expect("share");
    f.service
        .move_file_into_team(&destination.id, move_request("file-1"), &owner)
        .expect("move");

    // Gone from the row, not merely hidden by the listing's join.
    assert!(f
        .service
        .list_shared_files(&lender.id, &owner)
        .expect("list")
        .files
        .is_empty());
    let repo = TeamsRepository::new(f.pool.clone());
    assert!(repo
        .find_file_share(&lender.id, "file-1")
        .expect("find")
        .is_none());
}

// ── Phase 8 groundwork: the activity feed ────────────────────────────────────

/// Every team write is logged as it happens, so the feed has a history from the first team that
/// was created rather than from whenever someone first opened it.
#[test]
fn the_feed_carries_the_writes_that_came_before_it_was_read() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);
    f.service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Roadmap".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("page");

    let feed = f.service.list_activity(&team.id, &owner).expect("feed");
    let actions: Vec<&str> = feed.entries.iter().map(|e| e.action.as_str()).collect();
    assert!(actions.contains(&"team.created"), "{actions:?}");
    assert!(actions.contains(&"team.page_created"), "{actions:?}");
}

/// One team's feed must not carry another's, even for someone in both.
#[test]
fn a_teams_feed_is_scoped_to_that_team() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let a = f.create_team("Marketing", &owner);
    let b = f.create_team("Engineering", &owner);

    f.service
        .create_page(
            &b.id,
            CreatePageRequest {
                title: "Only in B".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &owner,
        )
        .expect("page");

    let feed = f.service.list_activity(&a.id, &owner).expect("feed");
    assert!(
        feed.entries
            .iter()
            .all(|e| e.detail.as_ref().and_then(|d| d.get("page")).is_none()),
        "team A's feed picked up team B's page"
    );
    assert_eq!(
        feed.entries.iter().filter(|e| e.action == "team.created").count(),
        1
    );
}

/// A non-member cannot read a team's feed, for the same reason they cannot read anything else
/// about it.
#[test]
fn a_non_member_cannot_read_the_feed() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let stranger = user("u2", "stranger@example.com");
    f.add_user("u2", "stranger@example.com", "Stranger");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service.list_activity(&team.id, &stranger).expect_err("hidden").status,
        404
    );
}

/// The permission leak the team check closes by running *first*.
///
/// Every upload writes its uploader an `owner` permission row. Without the team check taking
/// precedence, a file claimed into a team would leave whoever pressed upload as its Drive owner —
/// able to reshare the team's file outside the team, and holding an authority over it the team's
/// own Owner does not have.
#[test]
fn a_teams_file_is_governed_by_the_team_not_by_a_leftover_personal_grant() {
    use crate::drive::permissions::model::NewPermissionRecord;
    use crate::drive::permissions::repository::PermissionsRepository;

    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    f.add_user("u2", "outsider@example.com", "Outsider");
    let team = f.create_team("Marketing", &owner);
    f.add_file("file-1", "u1", "Budget.xlsx", 10);

    let perms = PermissionsRepository::new(f.pool.clone());
    // What the upload path writes: the uploader owns their own file.
    perms
        .upsert_permission(&NewPermissionRecord {
            id: "perm-1",
            resource_type: "file",
            resource_id: "file-1",
            user_id: "u1",
            role: "owner",
            granted_by: "u1",
            user_email: "owner@example.com",
            user_name: "Owner",
        })
        .expect("owner grant");
    // And a share made before the file joined the team.
    perms
        .upsert_permission(&NewPermissionRecord {
            id: "perm-2",
            resource_type: "file",
            resource_id: "file-1",
            user_id: "u2",
            role: "editor",
            granted_by: "u1",
            user_email: "outsider@example.com",
            user_name: "Outsider",
        })
        .expect("share");

    f.service
        .claim_file(
            &team.id,
            ClaimFileRequest {
                file_id: "file-1".into(),
                folder_id: None,
            },
            &owner,
        )
        .expect("claim");

    // Both grants are still in the table…
    assert!(perms
        .find_permission("file", "file-1", "u1")
        .expect("find")
        .is_some());
    assert!(perms
        .find_permission("file", "file-1", "u2")
        .expect("find")
        .is_some());

    // …and neither is what decides access any more. The team's id is on the row, which is what
    // `get_effective_role` reads before it reads a grant.
    assert_eq!(
        perms.get_file_team_id("file-1").expect("team").as_deref(),
        Some(team.id.as_str())
    );
    // The outsider is in no team, so the team lookup answers for them: no role.
    assert_eq!(perms.find_team_role(&team.id, "u2").expect("role"), None);
    // The uploader's authority is now their team role — editor, not owner.
    assert_eq!(
        perms.find_team_role(&team.id, "u1").expect("role").as_deref(),
        Some("owner"),
        "they are the team's owner; the Drive role that maps to is checked in permissions::service"
    );
}

// ── Visibility, discovery and joining ────────────────────────────────────────
//
// `visibility` answers two questions at once: can a non-member find this team, and what may they
// do about it. The tests below walk all three values against both questions, because the field
// spent its first draft being validated and stored and never once read — every team behaved as
// private whatever the column said, and the Settings dropdown promised otherwise.

/// The whole model in one test: what each visibility does for someone outside the team.
#[test]
fn visibility_decides_who_can_find_a_team_and_how_they_get_in() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let outsider = f.outsider("u2");

    let private = f.create_team_visible("Private", Some("private"), &owner);
    let org = f.create_team_visible("Org", Some("organization"), &owner);
    let invite = f.create_team_visible("Invite", Some("invite_only"), &owner);

    let found = f.service.list_discoverable(&outsider).expect("discover");
    let names: Vec<&str> = found.teams.iter().map(|t| t.name.as_str()).collect();

    assert!(
        !names.contains(&"Private"),
        "a private team must not be discoverable"
    );
    assert_eq!(names, vec!["Invite", "Org"], "sorted by name");

    // And what each one offers, decided by the server rather than by the client guessing.
    let action = |name: &str| {
        found
            .teams
            .iter()
            .find(|t| t.name == name)
            .map(|t| t.join_action.clone())
            .expect("team in list")
    };
    assert_eq!(action("Org"), "join");
    assert_eq!(action("Invite"), "request");

    // The private team is still 404 on every ordinary route, unchanged by any of this.
    assert_eq!(
        f.service.get_team(&private.id, &outsider).expect_err("404").status,
        404
    );
    // …and so are the two discoverable ones. Discovery is confined to its own endpoint and does
    // not open up the members' view of a team.
    for t in [&org, &invite] {
        assert_eq!(
            f.service.get_team(&t.id, &outsider).expect_err("404").status,
            404,
            "discoverable is not the same as readable"
        );
    }
}

/// Anyone can add themselves to an organization team, and they land as a Viewer.
#[test]
fn an_organization_team_is_joined_by_adding_yourself() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let joiner = f.outsider("u2");
    let team = f.create_team_visible("Org", Some("organization"), &owner);

    let member = f.service.join_team(&team.id, &joiner).expect("join");
    assert_eq!(member.role, Role::Viewer.as_str());
    assert_eq!(member.user_id, "u2");

    // They are in: the team now resolves for them, and shows in their own list.
    let seen = f.service.get_team(&team.id, &joiner).expect("now a member");
    assert_eq!(seen.user_role, "viewer");
    assert_eq!(seen.member_count, 2);
    assert_eq!(f.service.list_teams(&joiner).expect("list").total, 1);

    // And it drops out of what is left to discover.
    assert_eq!(
        f.service.list_discoverable(&joiner).expect("discover").total,
        0
    );
}

/// Least privilege: joining reads, it does not write. The alternative — Contributor by default —
/// would mean making a team discoverable silently granted write access to the whole deployment.
#[test]
fn joining_grants_the_least_authority_there_is() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let joiner = f.outsider("u2");
    let team = f.create_team_visible("Org", Some("organization"), &owner);
    f.service.join_team(&team.id, &joiner).expect("join");

    let err = f
        .service
        .create_page(
            &team.id,
            CreatePageRequest {
                title: "Mine now".into(),
                parent_page_id: None,
                content_md: None,
                icon: None,
            },
            &joiner,
        )
        .expect_err("a viewer writes nothing");
    assert_eq!(err.status, 403);

    // Reading is exactly what they came for, and that works.
    assert!(f.service.list_pages(&team.id, None, &joiner).is_ok());
}

/// An invite-only team cannot be walked into, even though it can be found.
#[test]
fn an_invite_only_team_refuses_a_self_serve_join() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let outsider = f.outsider("u2");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);

    let err = f.service.join_team(&team.id, &outsider).expect_err("refused");
    // 403 rather than 404: they can already see this team in Discover, so there is nothing left to
    // conceal — only something they may not do.
    assert_eq!(err.status, 403);
    assert!(
        err.message.contains("Request access"),
        "the refusal should say what to do instead, got {:?}",
        err.message
    );
}

/// A private team cannot be joined *or* discovered, and says only "not found" to either.
#[test]
fn a_private_team_is_not_joinable_and_does_not_admit_to_existing() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let outsider = f.outsider("u2");
    let team = f.create_team_visible("Private", Some("private"), &owner);

    for status in [
        f.service.join_team(&team.id, &outsider).expect_err("404").status,
        f.service
            .request_access(&team.id, RequestAccessRequest { message: None }, &outsider)
            .expect_err("404")
            .status,
    ] {
        assert_eq!(
            status, 404,
            "a private team answers exactly as an absent one does"
        );
    }
}

/// The full request → approve path, and the membership it produces.
#[test]
fn a_request_is_answered_by_an_admin_and_admits_the_requester() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let asker = f.outsider("u2");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);

    let request = f
        .service
        .request_access(
            &team.id,
            RequestAccessRequest {
                message: Some("  I'm on the launch  ".into()),
            },
            &asker,
        )
        .expect("request");
    assert_eq!(request.status, "pending");
    assert_eq!(
        request.message.as_deref(),
        Some("I'm on the launch"),
        "trimmed"
    );

    // Asking is not joining.
    assert_eq!(
        f.service.get_team(&team.id, &asker).expect_err("not yet").status,
        404
    );

    // The owner sees it queued.
    let queue = f
        .service
        .list_join_requests(&team.id, None, &owner)
        .expect("queue");
    assert_eq!(queue.total, 1);
    assert_eq!(queue.requests[0].email, "u2@example.com");

    let member = f
        .service
        .approve_join_request(
            &team.id,
            &request.id,
            ApproveJoinRequestRequest { role: None },
            &owner,
        )
        .expect("approve");
    assert_eq!(member.role, Role::Viewer.as_str());

    // In the team, and out of the queue.
    assert!(f.service.get_team(&team.id, &asker).is_ok());
    assert_eq!(
        f.service
            .list_join_requests(&team.id, None, &owner)
            .expect("queue")
            .total,
        0
    );
    assert_eq!(
        f.service
            .list_join_requests(&team.id, Some("approved"), &owner)
            .expect("queue")
            .total,
        1
    );
}

/// An approval can name the role, so an admin need not admit-then-promote in two steps.
#[test]
fn an_approval_can_name_the_role_it_admits_them_in() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let asker = f.outsider("u2");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);
    let request = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect("request");

    let member = f
        .service
        .approve_join_request(
            &team.id,
            &request.id,
            ApproveJoinRequestRequest {
                role: Some("editor".into()),
            },
            &owner,
        )
        .expect("approve");
    assert_eq!(member.role, "editor");
}

/// The escalation rule from `add_member` applies to the other route in as well — otherwise an
/// Admin could mint an Owner by approving a request rather than by inviting.
#[test]
fn an_admin_cannot_approve_someone_into_ownership() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let admin = f.outsider("u2");
    let asker = f.outsider("u3");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "u2@example.com".into(),
                role: "admin".into(),
            },
            &owner,
        )
        .expect("add admin");
    let request = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect("request");

    let err = f
        .service
        .approve_join_request(
            &team.id,
            &request.id,
            ApproveJoinRequestRequest {
                role: Some("owner".into()),
            },
            &admin,
        )
        .expect_err("escalation");
    assert_eq!(err.status, 403);
}

/// A declined request is kept as answered, which is what stops the same person filling the queue
/// again the next day with nothing to say they were already turned down.
#[test]
fn a_declined_request_is_remembered_rather_than_deleted() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let asker = f.outsider("u2");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);
    let request = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect("request");

    f.service
        .decline_join_request(&team.id, &request.id, &owner)
        .expect("decline");

    assert_eq!(
        f.service
            .list_join_requests(&team.id, None, &owner)
            .expect("queue")
            .total,
        0,
        "out of the pending queue"
    );
    let declined = f
        .service
        .list_join_requests(&team.id, Some("declined"), &owner)
        .expect("queue");
    assert_eq!(declined.total, 1);
    assert_eq!(declined.requests[0].decided_by.as_deref(), Some("u1"));
    assert!(declined.requests[0].decided_at.is_some());

    // They are not in the team, and the team is discoverable again — a decline is not a ban, and
    // asking a second time is allowed.
    assert_eq!(
        f.service.get_team(&team.id, &asker).expect_err("no").status,
        404
    );
    assert!(f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .is_ok());
}

/// One open request per person per team — the partial unique index in 00129, enforced with a
/// legible error rather than a constraint violation.
#[test]
fn a_second_request_while_one_is_open_is_refused() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let asker = f.outsider("u2");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);

    f.service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect("first");
    let err = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect_err("second");
    assert_eq!(err.status, 409);

    // And Discover says so rather than offering the button again.
    let found = f.service.list_discoverable(&asker).expect("discover");
    assert_eq!(found.teams[0].join_action, "requested");
}

/// Answering a request is admitting someone, so it takes the same authority as inviting them.
#[test]
fn an_ordinary_member_cannot_see_or_answer_the_queue() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let editor = f.outsider("u2");
    let asker = f.outsider("u3");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);

    f.service
        .add_member(
            &team.id,
            AddMemberRequest {
                email: "u2@example.com".into(),
                role: "editor".into(),
            },
            &owner,
        )
        .expect("add editor");
    let request = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect("request");

    // An Editor has every authority over content and none over membership.
    assert_eq!(
        f.service
            .list_join_requests(&team.id, None, &editor)
            .expect_err("403")
            .status,
        403
    );
    assert_eq!(
        f.service
            .approve_join_request(
                &team.id,
                &request.id,
                ApproveJoinRequestRequest { role: None },
                &editor
            )
            .expect_err("403")
            .status,
        403
    );

    // And a complete outsider gets 404 — the queue does not confirm the team exists.
    let stranger = f.outsider("u4");
    assert_eq!(
        f.service
            .list_join_requests(&team.id, None, &stranger)
            .expect_err("404")
            .status,
        404
    );
}

/// Findable is not the same as joinable: an archived team refuses every write, so admitting
/// someone would hand them a room they cannot act in.
#[test]
fn an_archived_team_is_neither_discoverable_nor_joinable() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let outsider = f.outsider("u2");
    let team = f.create_team_visible("Org", Some("organization"), &owner);

    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                archived: Some(true),
                ..update_team_request()
            },
            &owner,
        )
        .expect("archive");

    assert_eq!(
        f.service.list_discoverable(&outsider).expect("discover").total,
        0
    );
    assert_eq!(
        f.service.join_team(&team.id, &outsider).expect_err("no").status,
        409
    );
}

/// Joining something you are already in is a 409 rather than a second membership row.
#[test]
fn joining_twice_is_refused() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let joiner = f.outsider("u2");
    let team = f.create_team_visible("Org", Some("organization"), &owner);

    f.service.join_team(&team.id, &joiner).expect("join");
    assert_eq!(
        f.service.join_team(&team.id, &joiner).expect_err("again").status,
        409
    );
    // The owner is a member too, and gets the same answer.
    assert_eq!(
        f.service.join_team(&team.id, &owner).expect_err("own team").status,
        409
    );
}

/// There is nothing to request when anyone may simply join, so asking is a 400 rather than a row
/// in a queue nobody will ever look at.
#[test]
fn requesting_access_to_an_open_team_is_refused_as_pointless() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let outsider = f.outsider("u2");
    let team = f.create_team_visible("Org", Some("organization"), &owner);

    let err = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &outsider)
        .expect_err("pointless");
    assert_eq!(err.status, 400);
}

/// A request already answered cannot be answered again, whichever way it went.
#[test]
fn a_request_can_only_be_answered_once() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let asker = f.outsider("u2");
    let team = f.create_team_visible("Invite", Some("invite_only"), &owner);
    let request = f
        .service
        .request_access(&team.id, RequestAccessRequest { message: None }, &asker)
        .expect("request");

    f.service
        .decline_join_request(&team.id, &request.id, &owner)
        .expect("decline");

    assert_eq!(
        f.service
            .decline_join_request(&team.id, &request.id, &owner)
            .expect_err("twice")
            .status,
        409
    );
    assert_eq!(
        f.service
            .approve_join_request(
                &team.id,
                &request.id,
                ApproveJoinRequestRequest { role: None },
                &owner
            )
            .expect_err("already declined")
            .status,
        409
    );
}

/// A request id from another team cannot be answered through this team's route, even by someone
/// entitled to answer requests in both.
#[test]
fn a_request_from_another_team_cannot_be_answered_here() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let asker = f.outsider("u2");
    let a = f.create_team_visible("A", Some("invite_only"), &owner);
    let b = f.create_team_visible("B", Some("invite_only"), &owner);

    let request = f
        .service
        .request_access(&a.id, RequestAccessRequest { message: None }, &asker)
        .expect("request");

    assert_eq!(
        f.service
            .approve_join_request(
                &b.id,
                &request.id,
                ApproveJoinRequestRequest { role: None },
                &owner
            )
            .expect_err("wrong team")
            .status,
        404
    );
    // And the request is untouched by the attempt.
    assert_eq!(
        f.service
            .list_join_requests(&a.id, None, &owner)
            .expect("queue")
            .total,
        1
    );
}

/// Opening a team up is a security-relevant change, so it gets its own entry in the feed rather
/// than being folded into a generic "settings updated".
#[test]
fn changing_visibility_is_recorded_in_the_activity_feed() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let team = f.create_team_visible("Team", Some("private"), &owner);

    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                visibility: Some("organization".into()),
                ..update_team_request()
            },
            &owner,
        )
        .expect("open it up");

    let feed = f.service.list_activity(&team.id, &owner).expect("feed");
    let entry = feed
        .entries
        .iter()
        .find(|e| e.action == "team.visibility_changed")
        .expect("visibility change recorded");
    let detail = entry.detail.as_ref().expect("detail");
    assert_eq!(detail["from"], "private");
    assert_eq!(detail["to"], "organization");
}

/// Turning a team private takes it out of Discover for everyone who has not already joined; the
/// people already in it stay in. Archiving-like reversibility, not a purge.
#[test]
fn making_a_team_private_hides_it_without_removing_anyone() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let joiner = f.outsider("u2");
    let stranger = f.outsider("u3");
    let team = f.create_team_visible("Org", Some("organization"), &owner);
    f.service.join_team(&team.id, &joiner).expect("join");

    f.service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                visibility: Some("private".into()),
                ..update_team_request()
            },
            &owner,
        )
        .expect("close it");

    assert_eq!(
        f.service.list_discoverable(&stranger).expect("discover").total,
        0
    );
    assert_eq!(
        f.service.join_team(&team.id, &stranger).expect_err("gone").status,
        404
    );
    // The person who joined while it was open keeps what they had.
    assert!(f.service.get_team(&team.id, &joiner).is_ok());
}

/// An unknown visibility is refused on the way in rather than stored and puzzled over later.
#[test]
fn an_unknown_visibility_is_rejected() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    f.add_user("u1", "owner@example.com", "Owner");

    let err = f
        .service
        .create_team(
            CreateTeamRequest {
                name: "Team".into(),
                description: None,
                avatar_color: None,
                avatar_emoji: None,
                visibility: Some("public".into()),
            },
            &owner,
        )
        .expect_err("unknown");
    assert_eq!(err.status, 400);

    let team = f.create_team("Team", &owner);
    let err = f
        .service
        .update_team(
            &team.id,
            UpdateTeamRequest {
                visibility: Some("world".into()),
                ..update_team_request()
            },
            &owner,
        )
        .expect_err("unknown");
    assert_eq!(err.status, 400);
}

/// A team is private unless it says otherwise, so an existing deployment gains no discoverable
/// teams by upgrading.
#[test]
fn a_team_is_private_by_default() {
    let f = Fixture::new();
    let owner = user("u1", "owner@example.com");
    let outsider = f.outsider("u2");

    let team = f.create_team("Unspecified", &owner);
    assert_eq!(team.visibility, "private");
    assert_eq!(
        f.service.list_discoverable(&outsider).expect("discover").total,
        0
    );
}
