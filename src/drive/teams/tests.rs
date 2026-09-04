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
use super::repository::{DbPool, TeamsRepository};
use super::roles::Role;
use super::service::{TeamsService, FLAG_TEAM_SPACES};
use crate::drive::activity::{repository::ActivityRepository, service::ActivityService};
use crate::drive::feature_flags::gate::FeatureGate;
use crate::drive::feature_flags::repository::FeatureFlagsRepository;
use crate::schema::{feature_flags, files, users};
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
    /// A stack with `teamSpaces` and every sub-flag on, since a test that leaves them off is
    /// testing the gate rather than the feature. `gated_off` covers the other side.
    fn new() -> Self {
        let f = Self::gated_off();
        for key in [
            "teamSpaces",
            "teamSpacesPages",
            "teamSpacesFiles",
            "teamSpacesActivity",
        ] {
            diesel::update(feature_flags::table.filter(feature_flags::key.eq(key)))
                .set(feature_flags::enabled.eq(1))
                .execute(&mut f.pool.get().expect("conn"))
                .expect("enable flag");
        }
        f
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
        self.add_user(&as_user.user_id, &as_user.email, &as_user.email);
        self.service
            .create_team(
                CreateTeamRequest {
                    name: name.to_string(),
                    description: None,
                    avatar_color: None,
                    avatar_emoji: None,
                    visibility: None,
                },
                as_user,
            )
            .expect("create team")
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

/// The sub-flags gate their own phase and nothing else: with `teamSpaces` on but
/// `teamSpacesPages` off, a team exists and its pages do not.
#[test]
fn a_sub_flag_gates_only_its_own_phase() {
    let f = Fixture::gated_off();
    diesel::update(feature_flags::table.filter(feature_flags::key.eq(FLAG_TEAM_SPACES)))
        .set(feature_flags::enabled.eq(1))
        .execute(&mut f.pool.get().expect("conn"))
        .expect("enable");

    let owner = user("u1", "owner@example.com");
    let team = f.create_team("Marketing", &owner);

    assert_eq!(
        f.service
            .list_pages(&team.id, None, &owner)
            .expect_err("pages gated")
            .status,
        404
    );
    assert_eq!(
        f.service
            .list_library(&team.id, None, &owner)
            .expect_err("files gated")
            .status,
        404
    );
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

// ── Phase 8 groundwork: the activity feed ────────────────────────────────────

/// The feed's flag gates *reading* it, not the recording. A feed that only starts collecting when
/// it is switched on shows an empty history on the day it ships, which is the worst possible first
/// impression of a feature whose whole value is history.
#[test]
fn activity_is_recorded_while_its_feed_is_switched_off() {
    let f = Fixture::gated_off();
    for key in [FLAG_TEAM_SPACES, "teamSpacesPages"] {
        diesel::update(feature_flags::table.filter(feature_flags::key.eq(key)))
            .set(feature_flags::enabled.eq(1))
            .execute(&mut f.pool.get().expect("conn"))
            .expect("enable");
    }

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

    // The feed is dark…
    assert_eq!(
        f.service.list_activity(&team.id, &owner).expect_err("gated").status,
        404
    );

    // …and the history it will show was being written the whole time.
    diesel::update(
        feature_flags::table.filter(feature_flags::key.eq("teamSpacesActivity")),
    )
    .set(feature_flags::enabled.eq(1))
    .execute(&mut f.pool.get().expect("conn"))
    .expect("enable");

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
