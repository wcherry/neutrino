use crate::shared::{init_logging, DbPool};
use actix_cors::Cors;
use actix_files;
use actix_web::{
    body::MessageBody,
    dev::{ServiceRequest, ServiceResponse},
    get,
    http::{
        header::{HeaderValue, CACHE_CONTROL},
        StatusCode,
    },
    middleware::{from_fn, Compress, Logger, Next, NormalizePath, TrailingSlash},
    web, App, Error, HttpResponse, HttpServer, Responder,
};
use diesel::r2d2::{ConnectionManager, CustomizeConnection, Error as R2D2Error, Pool};
use diesel::{RunQueryDsl, SqliteConnection};
use diesel_migrations::{embed_migrations, EmbeddedMigrations, MigrationHarness};
use serde_json::json;
use std::sync::Arc;
use tracing::{error, info};
use utoipa::OpenApi;
use utoipa_swagger_ui::SwaggerUi;

mod auth;
mod calendar;
mod config;
mod diagrams;
mod docs;
mod drive;
mod jobs;
mod links;
mod oauth;
mod photos;
mod schema;
mod search;
mod shared;
mod sheets;
mod slides;
mod themes;

pub const MIGRATIONS: EmbeddedMigrations = embed_migrations!("migrations");

// ── SQLite pool customizer (WAL + busy timeout) ──────────────────────────────

#[derive(Debug)]
struct SqliteConnectionInit;

impl CustomizeConnection<SqliteConnection, R2D2Error> for SqliteConnectionInit {
    fn on_acquire(&self, conn: &mut SqliteConnection) -> Result<(), R2D2Error> {
        diesel::sql_query("PRAGMA busy_timeout = 5000")
            .execute(conn)
            .map_err(R2D2Error::QueryError)?;
        diesel::sql_query("PRAGMA journal_mode = WAL")
            .execute(conn)
            .map_err(R2D2Error::QueryError)?;
        Ok(())
    }
}

fn create_db_pool(database_url: &str) -> Result<DbPool, String> {
    let manager = ConnectionManager::<SqliteConnection>::new(database_url);
    Pool::builder()
        .test_on_check_out(true)
        .connection_customizer(Box::new(SqliteConnectionInit))
        .build(manager)
        .map_err(|e| format!("Failed to create DB pool ({}): {}", database_url, e))
}

fn run_migrations(pool: &DbPool) -> Result<(), String> {
    let mut conn = pool
        .get()
        .map_err(|e| format!("Failed to get DB connection: {}", e))?;
    conn.run_pending_migrations(MIGRATIONS)
        .map_err(|e| format!("Failed to run migrations: {}", e))?;
    Ok(())
}

// ── Apple App Site Association ───────────────────────────────────────────────

/// The routing table iOS fetches to decide which Neutrino app opens a
/// `https://www.getneutrino.app/open/…` Universal Link.
///
/// Embedded rather than served from `web_dir` for three reasons, each of which is a silent
/// failure if got wrong:
///
/// * `actix_files::Files` does not serve hidden paths, so a file under `.well-known/` would fall
///   through to the SPA's `index.html` handler and Apple would be handed HTML.
/// * The document has no file extension, so the guessed content type would be
///   `application/octet-stream`. Apple requires `application/json`.
/// * It must never redirect. `NormalizePath` is configured `MergeOnly`, so this exact path is
///   returned as-is — but only because nothing rewrites it first.
///
/// The source of truth is `static/apple-app-site-association`. Editing the app id or path list
/// there means re-checking `NeutrinoAppLink.swift` in all three iOS repositories, which mint the
/// links these patterns have to match.
const APPLE_APP_SITE_ASSOCIATION: &str = include_str!("../static/apple-app-site-association");

#[get("/.well-known/apple-app-site-association")]
async fn apple_app_site_association() -> impl Responder {
    HttpResponse::Ok()
        .content_type("application/json")
        .body(APPLE_APP_SITE_ASSOCIATION)
}

// ── Health check ─────────────────────────────────────────────────────────────

#[get("/health")]
async fn health(pool: web::Data<DbPool>) -> impl Responder {
    let mut conn = match pool.get() {
        Ok(c) => c,
        Err(e) => {
            error!("Health check DB connection error: {:?}", e);
            return HttpResponse::ServiceUnavailable().json(json!({
                "error": { "code": "DB_UNAVAILABLE", "message": "Database connection unavailable" }
            }));
        }
    };
    match diesel::sql_query("SELECT 1").execute(&mut conn) {
        Ok(_) => HttpResponse::Ok().json(json!({"status": "ok"})),
        Err(e) => {
            error!("Health check DB query error: {:?}", e);
            HttpResponse::ServiceUnavailable().json(json!({
                "error": { "code": "DB_UNHEALTHY", "message": "Database health check failed" }
            }))
        }
    }
}

// ── Static web app ───────────────────────────────────────────────────────────

/// A year, and `immutable` so browsers skip revalidation entirely.
///
/// Only safe on URLs whose contents can never change. Next's `/_next/static/*` filenames embed a
/// hash of the file (or the build id), so a rebuild produces new URLs rather than new bytes at the
/// old ones — which is exactly the property this header requires.
const IMMUTABLE_CACHE_CONTROL: &str = "public, max-age=31536000, immutable";

/// Stamps [`IMMUTABLE_CACHE_CONTROL`] onto whatever it wraps.
///
/// Deliberately not `DefaultHeaders`: that would also stamp error responses, and a 404 cached for a
/// year is unrecoverable without a URL change. A missing asset during a rolling deploy is exactly
/// when that happens, so the status check is the point of this middleware, not incidental to it.
/// 304s are included because a cache that revalidates needs the freshness lifetime back.
async fn immutable_cache_control(
    req: ServiceRequest,
    next: Next<impl MessageBody>,
) -> Result<ServiceResponse<impl MessageBody>, Error> {
    let mut res = next.call(req).await?;
    if res.status().is_success() || res.status() == StatusCode::NOT_MODIFIED {
        res.headers_mut().insert(
            CACHE_CONTROL,
            HeaderValue::from_static(IMMUTABLE_CACHE_CONTROL),
        );
    }
    Ok(res)
}

/// The suffix Next appends to a route to name its React Server Component payload.
const RSC_PAYLOAD_SUFFIX: &str = ".txt";

/// Joins a request path onto the web root, refusing anything that could climb out of it.
///
/// The RSC fallback below resolves a path by hand, so `actix_files`' own traversal guard is not in
/// play for it. Anything but a plain segment is rejected outright rather than normalised away.
fn safe_join(root: &str, relative: &str) -> Option<std::path::PathBuf> {
    let mut path = std::path::PathBuf::from(root);
    for segment in relative.split('/') {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." || segment.contains('\\') || segment.contains('\0') {
            return None;
        }
        path.push(segment);
    }
    Some(path)
}

/// Where the export actually keeps the RSC payload the App Router just asked for, if anywhere.
///
/// `output: 'export'` with `trailingSlash: true` writes `/docs`' payload to `docs/index.txt`, but
/// the router strips the trailing slash before appending the suffix and asks for `/docs.txt` —
/// whatever `trailingSlash` says. So the direct hit is tried first (it is what `/index.txt` and any
/// future non-trailing-slash export would use) and the directory form second.
fn rsc_payload_path(web_dir: &str, request_path: &str) -> Option<std::path::PathBuf> {
    let direct = safe_join(web_dir, request_path).filter(|p| p.is_file());
    if direct.is_some() {
        return direct;
    }
    let route = request_path.strip_suffix(RSC_PAYLOAD_SUFFIX)?;
    safe_join(web_dir, &format!("{}/index{}", route, RSC_PAYLOAD_SUFFIX)).filter(|p| p.is_file())
}

/// Whether `web_dir` holds a built export to serve.
///
/// The index is what the SPA fallback hands out for every route, so a directory without one is not
/// a web build however many other files are in it.
fn web_app_present(web_dir: &str) -> bool {
    std::path::Path::new(web_dir).join("index.html").is_file()
}

/// Serves the statically exported Next.js app out of `web_dir`.
///
/// Two mounts, because they want opposite caching. `/_next/static` is content-hashed and cached
/// forever; everything else (`index.html` above all) must be revalidated every time, or a deploy
/// never reaches a returning visitor. The hashed mount is registered first so it wins, and it has
/// no SPA fallback: a missing asset must 404 rather than be answered with `index.html`, both
/// because HTML in a `<script>` tag is a confusing failure and because the fallback's 200 would
/// otherwise be cached for a year under a URL that will never hold anything else.
///
/// The default handler has the same rule for a `.txt` it cannot place, and for a bigger reason.
/// Those are the RSC payloads the App Router fetches to move between routes *without* reloading the
/// page, and the router only accepts one under an RSC or `text/plain` content type — hand it
/// `index.html` and it silently abandons the client-side navigation and sets `location.href`
/// instead. Since `/docs.txt` is a miss against an export written as `docs/index.txt`, that was
/// *every* navigation in a deployed build: a full page load each time, which is issue #165. It
/// showed up as a Takeout import dying on an app switch — the import is all in-page JavaScript, so
/// a reload throws it away — but nothing else in memory survived either, and the run's
/// `beforeunload` warning was the only reason anyone saw it happen.
///
/// Returns a closure because `App` is rebuilt per worker thread and `configure` takes `FnOnce`.
///
/// Mounts nothing at all when `web_dir` does not exist, which is the normal state under
/// `cargo dev`: there the Next dev server owns the UI on its own port and only proxies `/api` here,
/// so the export this serves is never built. Registering the mounts anyway made `actix_files` log
/// `Specified path is not a directory` at ERROR for every request that reached them — an error per
/// request, for a directory nothing was supposed to be reading. Whether the app is being served is
/// reported once at startup instead; see the caller.
fn configure_web_app(web_dir: &str) -> impl FnOnce(&mut web::ServiceConfig) {
    let hashed_assets_dir = format!("{}/_next/static", web_dir);
    let index = format!("{}/index.html", web_dir);
    let present = web_app_present(web_dir);
    let web_dir = web_dir.to_owned();
    let fallback_dir = web_dir.clone();

    move |cfg: &mut web::ServiceConfig| {
        if !present {
            return;
        }
        cfg.service(
            web::scope("/_next/static")
                .wrap(from_fn(immutable_cache_control))
                .service(
                    actix_files::Files::new("", hashed_assets_dir)
                        .use_last_modified(true)
                        .use_etag(true),
                ),
        )
        .service(
            actix_files::Files::new("/", web_dir)
                .index_file("index.html")
                .use_last_modified(true)
                .use_etag(true)
                // Client-side routing: unknown paths are app routes, not missing files.
                .default_handler(web::get().to(move |req: actix_web::HttpRequest| {
                    let index = index.clone();
                    let web_dir = fallback_dir.clone();
                    async move {
                        let path = req.path();
                        if path.ends_with(RSC_PAYLOAD_SUFFIX) {
                            return match rsc_payload_path(&web_dir, path) {
                                Some(payload) => actix_files::NamedFile::open(&payload)
                                    .map_err(actix_web::error::ErrorNotFound),
                                None => Err(actix_web::error::ErrorNotFound(
                                    "no server component payload for this route",
                                )),
                            };
                        }
                        actix_files::NamedFile::open(&index)
                            .map_err(actix_web::error::ErrorNotFound)
                    }
                })),
        );
    }
}

// ── Entrypoint ────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    // `dotenv()` searches *upward* from the process's working directory, so
    // which file it finds depends on where the binary was started — from
    // outside the repo it walks straight past the repo's `.env` and loads
    // whatever `.env` sits higher up, a home directory's included. Reporting
    // the file it settled on turns "the app is ignoring my .env" into a
    // question with an answer on the first line of the log. Printed rather than
    // logged because logging is configured from what this loads.
    match dotenvy::dotenv() {
        Ok(path) => println!("Loaded environment from {}", path.display()),
        Err(_) => println!(
            "No .env found from {}; using the environment as it stands",
            std::env::current_dir()
                .map(|d| d.display().to_string())
                .unwrap_or_else(|_| "the working directory".to_string()),
        ),
    }

    let config = config::Config::from_env().unwrap_or_else(|e| {
        eprintln!("Configuration error: {}", e);
        std::process::exit(1);
    });

    let _log_guard = init_logging(&config.log_level, config.log_path.clone());

    info!("Starting Neutrino unified service");

    // ── Unified database pool ────────────────────────────────────────────────

    let pool = create_db_pool(&config.database_url).unwrap_or_else(|e| {
        error!("{}", e);
        std::process::exit(1);
    });
    run_migrations(&pool).unwrap_or_else(|e| {
        error!("Database migrations: {}", e);
        std::process::exit(1);
    });

    info!("All database migrations applied");

    // ── Shared token service ──────────────────────────────────────────────────

    let token_service = Arc::new(shared::auth::tokens::TokenService::new_with_expiry(
        config.jwt_secret.clone(),
        config.jwt_access_expiry_secs,
        config.jwt_refresh_expiry_secs,
    ));
    let guest_token_service = Arc::new(shared::auth::tokens::TokenService::new_with_expiry(
        config.jwt_secret.clone(),
        3600,
        0,
    ));

    // ── Auth service ─────────────────────────────────────────────────────────

    use auth::repository::AuthRepository;
    use auth::service::AuthService;

    let auth_repo = Arc::new(AuthRepository::new(pool.clone()));
    // The workspace password rules. Shared between the admin routes that write
    // them and the auth service that enforces them, so a policy change takes
    // effect on the next password without a restart.
    let password_policy_repo = Arc::new(
        auth::password_policy::PasswordPolicyRepository::new(pool.clone()),
    );
    let auth_service = Arc::new(AuthService::new(
        auth_repo.clone(),
        token_service.clone(),
        password_policy_repo.clone(),
    ));
    let password_policy_state = web::Data::new(auth::password_policy::api::PasswordPolicyState {
        repo: password_policy_repo,
    });
    // `auth_state` is built further down, once the Drive filesystem service it
    // needs to seed a new account's folders exists.

    // ── Key vault (wrapped E2EE identity keys) ───────────────────────────────

    use auth::keyvault::repository::KeyVaultRepository;
    use auth::keyvault::service::KeyVaultService;

    let key_vault_repo = Arc::new(KeyVaultRepository::new(pool.clone()));
    let key_vault_service = Arc::new(KeyVaultService::new(key_vault_repo, auth_repo.clone()));
    let key_vault_state = web::Data::new(auth::keyvault::api::KeyVaultApiState {
        key_vault_service: key_vault_service.clone(),
    });

    // ── OAuth service ─────────────────────────────────────────────────────────

    use oauth::repository::OauthRepository;
    use oauth::service::OauthService;

    let oauth_repo = Arc::new(OauthRepository::new(pool.clone()));
    let oauth_service = Arc::new(OauthService::new(
        oauth_repo,
        auth_repo.clone(),
        token_service.clone(),
    ));
    let oauth_state = web::Data::new(oauth::api::OauthApiState {
        oauth_service: oauth_service.clone(),
    });

    // ── Calendar service ─────────────────────────────────────────────────────

    use calendar::attachments::repository::AttachmentsRepository;
    use calendar::attachments::service::AttachmentsService;
    use calendar::connections::repository::ConnectionsRepository;
    use calendar::connections::service::ConnectionsService;
    use calendar::events::attendees::AttendeesRepository;
    use calendar::events::repository::EventsRepository;
    use calendar::events::service::EventsService;
    use calendar::reminders::repository::RemindersRepository;
    use calendar::reminders::service::RemindersService;
    use calendar::tasks::repository::TasksRepository;
    use calendar::tasks::service::TasksService;

    // ── Calendar service ─────────────────────────────────────────────────────

    let cal_attendees_repo = Arc::new(AttendeesRepository::new(pool.clone()));
    let cal_events_repo = Arc::new(EventsRepository::new(pool.clone()));
    let cal_events_service = Arc::new(EventsService::new(
        cal_events_repo.clone(),
        cal_attendees_repo,
    ));
    let cal_events_state = web::Data::new(calendar::events::api::EventsApiState {
        events_service: cal_events_service,
    });

    let cal_reminders_repo = Arc::new(RemindersRepository::new(pool.clone()));
    let cal_reminders_service = Arc::new(RemindersService::new(cal_reminders_repo.clone()));
    let cal_reminders_state = web::Data::new(calendar::reminders::api::RemindersApiState {
        reminders_service: cal_reminders_service,
    });

    let cal_attachments_repo = Arc::new(AttachmentsRepository::new(pool.clone()));
    let cal_attachments_service = Arc::new(AttachmentsService::new(cal_attachments_repo));
    let cal_attachments_state = web::Data::new(calendar::attachments::api::AttachmentsApiState {
        attachments_service: cal_attachments_service,
    });

    let cal_connections_repo = Arc::new(ConnectionsRepository::new(pool.clone()));
    let cal_connections_service = Arc::new(ConnectionsService::new(
        cal_connections_repo,
        cal_events_repo,
        config.oauth.clone(),
    ));
    let cal_connections_state = web::Data::new(calendar::connections::api::ConnectionsApiState {
        connections_service: cal_connections_service,
    });

    let cal_tasks_repo = Arc::new(TasksRepository::new(pool.clone()));
    let cal_tasks_service = Arc::new(TasksService::new(cal_tasks_repo));
    let cal_tasks_state = web::Data::new(calendar::tasks::api::TasksApiState {
        tasks_service: cal_tasks_service,
    });

    // Reminder engine background worker
    let engine_repo = cal_reminders_repo.clone();
    tokio::spawn(async move {
        calendar::reminder_engine::run(engine_repo, 60).await;
    });

    // ── Drive service ─────────────────────────────────────────────────────────

    use drive::access_requests::repository::AccessRequestsRepository;
    use drive::access_requests::service::AccessRequestsService;
    use drive::activity::repository::ActivityRepository;
    use drive::activity::service::ActivityService;
    use drive::admin::service::AdminDashboardService;
    use drive::comments::repository::CommentsRepository;
    use drive::comments::service::CommentsService;
    use drive::encryption::repository::EncryptionRepository;
    use drive::encryption::service::EncryptionService;
    use drive::feature_flags::repository::FeatureFlagsRepository;
    use drive::filesystem::repository::FilesystemRepository;
    use drive::filesystem::service::FilesystemService;
    use jobs::repository::JobsRepository;
    use jobs::service::JobsService;
    use drive::notifications::hub::NotificationHub;
    use drive::notifications::repository::NotificationsRepository;
    use drive::notifications::service::{NotificationService, SmtpConfig};
    use drive::permissions::repository::PermissionsRepository;
    use drive::permissions::service::PermissionsService;
    use drive::security::repository::SecurityRepository;
    use drive::security::service::SecurityService;
    use drive::service_registry::repository::ServiceRegistrationRepository;
    use drive::service_registry::ServiceRegistry;
    use drive::shared_drives::repository::SharedDrivesRepository;
    use drive::shared_drives::service::SharedDrivesService;
    use drive::sharing::repository::SharingRepository;
    use drive::sharing::service::SharingService;
    use drive::storage::repository::StorageRepository;
    use drive::storage::service::StorageService;
    use drive::storage::store::LocalFileStore;
    use drive::tags::repository::TagsRepository;
    use drive::tags::service::TagsService;
    use drive::workspace::repository::WorkspaceRepository;
    use drive::workspace::service::WorkspaceService;

    let file_store = Arc::new(
        LocalFileStore::new(&config.storage_path).unwrap_or_else(|e| {
            error!("{}", e);
            std::process::exit(1);
        }),
    );

    // Bring an older store onto the one-directory-per-file layout. Runs to
    // completion before the server binds: a request served against a
    // half-converted store would read a file whose bytes are mid-move.
    // Self-detecting and idempotent, so a converted store pays one query.
    drive::storage::layout::migrate_to_file_directories(&pool, &file_store);

    // Reap upload staging files that never committed. `TempUpload` cleans up
    // every abort the process survives; this catches what it can't — a crash
    // or a kill mid-upload — so orphans can't accumulate indefinitely. Runs
    // once at boot and then on an interval.
    {
        let sweep_store = file_store.clone();
        let max_age = std::time::Duration::from_secs(config.temp_max_age_secs);
        let interval_secs = config.temp_sweep_interval_secs;
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
            loop {
                // First tick is immediate, so boot gets a sweep.
                interval.tick().await;
                let store = sweep_store.clone();
                // Blocking directory walk over potentially thousands of files
                // — keep it off the async worker threads.
                let report = match tokio::task::spawn_blocking(move || {
                    store.sweep_temp_files(max_age)
                })
                .await
                {
                    Ok(report) => report,
                    Err(e) => {
                        error!("Temp sweep task failed: {:?}", e);
                        continue;
                    }
                };
                if report.removed > 0 || report.failed > 0 {
                    info!(
                        "Temp sweep: removed {} staging files ({} bytes), {} in flight, {} failed",
                        report.removed, report.bytes_freed, report.skipped, report.failed
                    );
                }
            }
        });
    }

    let drive_fonts_repo = Arc::new(drive::fonts::repository::FontsRepository::new(pool.clone()));
    let drive_fonts_service = Arc::new(drive::fonts::service::FontsService::new(
        drive_fonts_repo,
        file_store.clone(),
    ));

    let drive_workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
    let drive_workspace_service = Arc::new(WorkspaceService::new(drive_workspace_repo));

    let drive_encryption_repo = Arc::new(EncryptionRepository::new(pool.clone()));

    let notification_hub = Arc::new(NotificationHub::new());

    let smtp_config = if let (Ok(host), Ok(port_str), Ok(user_s), Ok(pass), Ok(from)) = (
        std::env::var("SMTP_HOST"),
        std::env::var("SMTP_PORT"),
        std::env::var("SMTP_USER"),
        std::env::var("SMTP_PASS"),
        std::env::var("SMTP_FROM"),
    ) {
        port_str.parse::<u16>().ok().map(|port| SmtpConfig {
            host,
            port,
            user: user_s,
            pass,
            from,
        })
    } else {
        None
    };

    let drive_notifications_repo = Arc::new(NotificationsRepository::new(pool.clone()));
    let drive_notification_service = Arc::new(NotificationService::new(
        drive_notifications_repo,
        smtp_config,
        notification_hub.clone(),
    ));

    let drive_permissions_repo = Arc::new(PermissionsRepository::new(pool.clone()));
    let drive_permissions_service = Arc::new(PermissionsService::new(
        drive_permissions_repo.clone(),
        drive_workspace_service.clone(),
        drive_encryption_repo.clone(),
        auth_service.clone(),
    ));
    let drive_permissions_state = web::Data::new(drive::permissions::api::PermissionsApiState {
        permissions_service: drive_permissions_service.clone(),
        notification_service: drive_notification_service.clone(),
        storage_repo: Arc::new(StorageRepository::new(pool.clone())),
        fs_repo: Arc::new(FilesystemRepository::new(pool.clone())),
    });

    let drive_jobs_repo = Arc::new(JobsRepository::new(pool.clone()));
    let drive_jobs_service = Arc::new(JobsService::new(
        drive_jobs_repo,
        config.storage_path.clone(),
        config.jobs_per_worker,
    ));
    let drive_worker_secret_data = web::Data::new(jobs::api::WorkerSecretData(
        config.worker_secret.clone(),
    ));

    let drive_storage_repo = Arc::new(StorageRepository::new(pool.clone()));
    let drive_storage_service = Arc::new(StorageService::new(
        drive_storage_repo,
        file_store.clone(),
        drive_permissions_service.clone(),
    ));

    let drive_tags_repo = Arc::new(TagsRepository::new(pool.clone()));
    let drive_tags_service = Arc::new(TagsService::new(
        drive_tags_repo,
        drive_permissions_service.clone(),
    ));
    let drive_tags_state = web::Data::new(drive::tags::api::TagsApiState {
        tags_service: drive_tags_service.clone(),
    });

    let drive_fs_repo = Arc::new(FilesystemRepository::new(pool.clone()));

    let drive_storage_state = web::Data::new(drive::storage::api::StorageApiState {
        storage_service: drive_storage_service.clone(),
        permissions_service: drive_permissions_service.clone(),
        tags_service: drive_tags_service.clone(),
        filesystem_repo: drive_fs_repo.clone(),
        max_upload_bytes: config.max_upload_bytes,
    });
    let drive_fs_service = Arc::new(FilesystemService::new(
        drive_fs_repo.clone(),
        file_store,
        drive_permissions_service.clone(),
    ));
    let drive_fs_state = web::Data::new(drive::filesystem::api::FilesystemApiState {
        filesystem_service: drive_fs_service.clone(),
        filesystem_repo: drive_fs_repo.clone(),
        permissions_repo: drive_permissions_repo.clone(),
    });

    // Registration seeds the new account's default folders, so auth needs the
    // filesystem service — hence this sitting below it rather than beside the
    // other auth wiring above.
    let auth_state = web::Data::new(auth::api::AuthApiState {
        auth_service: auth_service.clone(),
        filesystem_service: drive_fs_service,
    });

    let drive_sharing_repo = Arc::new(SharingRepository::new(pool.clone()));
    let drive_sharing_service = Arc::new(SharingService::new(
        drive_sharing_repo,
        drive_permissions_service.clone(),
        drive_workspace_service,
        guest_token_service.clone(),
    ));
    let drive_sharing_state = web::Data::new(drive::sharing::api::SharingApiState {
        sharing_service: drive_sharing_service,
        token_service: guest_token_service.clone(),
    });

    let drive_access_requests_repo = Arc::new(AccessRequestsRepository::new(pool.clone()));
    let drive_access_requests_service = Arc::new(AccessRequestsService::new(
        drive_access_requests_repo,
        drive_permissions_repo,
        drive_permissions_service.clone(),
    ));
    let drive_access_requests_state =
        web::Data::new(drive::access_requests::api::AccessRequestsApiState {
            service: drive_access_requests_service,
        });

    let drive_notifications_state =
        web::Data::new(drive::notifications::api::NotificationsApiState {
            notification_service: drive_notification_service.clone(),
            hub: notification_hub.clone(),
            token_service: token_service.clone(),
        });

    let drive_activity_repo = Arc::new(ActivityRepository::new(pool.clone()));
    let drive_activity_service = Arc::new(ActivityService::new(drive_activity_repo));

    let drive_comments_repo = Arc::new(CommentsRepository::new(pool.clone()));
    let drive_comments_service = Arc::new(CommentsService::new(
        drive_comments_repo,
        drive_notification_service.clone(),
        drive_activity_service.clone(),
        drive_permissions_service.clone(),
    ));
    let drive_comments_state = web::Data::new(drive::comments::api::CommentsApiState {
        comments_service: drive_comments_service,
    });

    let drive_jobs_state = web::Data::new(jobs::api::JobsApiState {
        jobs_service: drive_jobs_service.clone(),
        storage_service: drive_storage_service.clone(),
    });

    let drive_shared_drives_repo = Arc::new(SharedDrivesRepository::new(pool.clone()));
    let drive_shared_drives_service = Arc::new(SharedDrivesService::new(drive_shared_drives_repo));
    let drive_shared_drives_state =
        web::Data::new(drive::shared_drives::api::SharedDrivesApiState {
            service: drive_shared_drives_service,
        });

    let drive_security_repo = Arc::new(SecurityRepository::new(pool.clone()));
    let drive_security_service = Arc::new(SecurityService::new(drive_security_repo, pool.clone()));
    let drive_security_state = web::Data::new(drive::security::api::SecurityApiState {
        service: drive_security_service,
    });

    let drive_encryption_service = Arc::new(EncryptionService::new(
        drive_encryption_repo.clone(),
        drive_permissions_service.clone(),
    ));
    let drive_encryption_state = web::Data::new(drive::encryption::api::EncryptionApiState {
        encryption_service: drive_encryption_service,
    });

    let drive_service_registry_repo = Arc::new(ServiceRegistrationRepository::new(pool.clone()));
    let drive_service_registry = ServiceRegistry::new(drive_service_registry_repo);
    let drive_service_registry_state =
        web::Data::new(drive::service_registry::api::ServiceRegistryState {
            registry: drive_service_registry.clone(),
        });

    let drive_admin_svc = Arc::new(AdminDashboardService::new(config.storage_path.clone()));
    let drive_admin_state = web::Data::new(drive::admin::api::AdminDashboardState {
        service: drive_admin_svc,
        service_registry: drive_service_registry,
    });

    let drive_feature_flags_repo = Arc::new(FeatureFlagsRepository::new(pool.clone()));
    let drive_feature_flags_state = web::Data::new(drive::feature_flags::api::FeatureFlagsState {
        repo: drive_feature_flags_repo,
    });

    let drive_version_retention_state =
        web::Data::new(drive::version_retention::api::VersionRetentionState {
            repo: Arc::new(drive::version_retention::repository::VersionRetentionRepository::new(
                pool.clone(),
            )),
        });

    let drive_fonts_state = web::Data::new(drive::fonts::api::FontsApiState {
        service: drive_fonts_service,
    });

    // Storage-increase requests (issue #144). Approving one writes the user's
    // quota, which the storage service owns, so it is borrowed here rather than
    // duplicated.
    let drive_quota_requests_state =
        web::Data::new(drive::quota_requests::api::QuotaRequestsState {
            repo: Arc::new(drive::quota_requests::repository::QuotaRequestsRepository::new(
                pool.clone(),
            )),
            storage_service: drive_storage_service.clone(),
        });

    // Drive background jobs processor
    let drive_jobs_bg = drive_jobs_service.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(5));
        loop {
            interval.tick().await;
            drive_jobs_bg.process_background_tasks().await;
        }
    });

    // ── Docs service ─────────────────────────────────────────────────────────

    use crate::shared::drive_client::DriveClient;
    use docs::collab::repository::CollabRepository;
    use docs::collab::state::CollabState;

    let docs_collab_repo = web::Data::new(Arc::new(CollabRepository::new(pool.clone())));
    let docs_collab_state = web::Data::new(Arc::new(CollabState::new()));

    // ── Shared file events (WS "this file changed" relay) ───────────────────────
    // Was three copies of this exact primitive (notes/sheets/slides presence);
    // this is the one shared instance. Notes is the only caller so far — see
    // agent_docs/notes-links-roadmap.md Phase 2.

    let drive_client_for_file_events = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let file_events_state =
        web::Data::new(Arc::new(shared::file_events::state::FileEventsState::new()));
    let file_events_drive_data = web::Data::new(drive_client_for_file_events);

    // ── Links service ─────────────────────────────────────────────────────────

    use links::repository::LinksRepository;
    use links::service::LinksService;

    let drive_client_for_links = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let links_repo = Arc::new(LinksRepository::new(pool.clone()));
    let links_service = Arc::new(LinksService::new(links_repo, drive_client_for_links));
    let links_state = web::Data::new(links::api::LinksApiState { links_service });

    // ── AI ────────────────────────────────────────────────────────────────────
    //
    // One client, shared by every app's AI features and by the generic `/ai/complete` route
    // behind the ones with no server-side logic of their own. It holds no key: the provider and
    // API key arrive with each request, from the browser, where Settings → AI Assistant put them.

    let ai_client = Arc::new(shared::AiClient::new());
    let ai_state = web::Data::new(shared::ai::api::AiApiState {
        client: ai_client.clone(),
    });

    // ── Photos service ────────────────────────────────────────────────────────

    use photos::albums::repository::AlbumsRepository;
    use photos::albums::service::AlbumsService;
    use photos::faces::repository::FacesRepository;
    use photos::faces::service::FacesService;
    use photos::learning::repository::LearningRepository;
    use photos::learning::service::LearningService;
    use photos::persons::repository::PersonsRepository;
    use photos::persons::service::PersonsService;
    use photos::photos::repository::PhotosRepository;
    use photos::photos::service::PhotosService;
    use photos::suggestions::repository::SuggestionsRepository as PhotosSuggestionsRepository;
    use photos::suggestions::service::SuggestionsService as PhotosSuggestionsService;

    let drive_client_for_photos = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));

    let photos_photos_repo = Arc::new(PhotosRepository::new(pool.clone()));
    let photos_albums_repo = Arc::new(AlbumsRepository::new(pool.clone()));
    let photos_faces_repo = Arc::new(FacesRepository::new(pool.clone()));
    let photos_persons_repo = Arc::new(PersonsRepository::new(pool.clone()));
    let photos_suggestions_repo = Arc::new(PhotosSuggestionsRepository::new(pool.clone()));
    let photos_learning_repo = Arc::new(LearningRepository::new(pool.clone()));

    let photos_service = Arc::new(PhotosService::new(
        photos_photos_repo.clone(),
        drive_client_for_photos,
        config.drive_base_url.clone(),
        config.worker_secret.clone(),
    ));
    // Empty the photo trash on the schedule the clients promise the user.
    //
    // Neutrino Photos counts down to `PhotosService::TRASH_RETENTION_DAYS` on every trashed
    // thumbnail; without this the count reached zero and the item stayed, which made the countdown
    // a statement nothing in the system made true. Hourly rather than on a timer per item: the
    // window is measured in days, so an hour of slack is invisible, and a sweep is one indexed
    // query when there is nothing to do.
    {
        let purge_service = photos_service.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(std::time::Duration::from_secs(3600));
            loop {
                // First tick is immediate, so a restart catches up on anything that expired while
                // the process was down.
                interval.tick().await;
                let service = purge_service.clone();
                match tokio::task::spawn_blocking(move || service.purge_expired_trash()).await {
                    Ok(Ok(_)) => {}
                    Ok(Err(e)) => error!("Trash purge failed: {:?}", e),
                    Err(e) => error!("Trash purge task failed: {:?}", e),
                }
            }
        });
    }

    let photos_albums_service = Arc::new(AlbumsService::new(
        photos_albums_repo,
        photos_photos_repo.clone(),
    ));
    let photos_faces_service = Arc::new(FacesService::new(
        photos_faces_repo.clone(),
        photos_photos_repo.clone(),
        drive_jobs_service.clone(),
    ));
    let photos_persons_service = Arc::new(PersonsService::new(
        photos_persons_repo.clone(),
        photos_suggestions_repo.clone(),
    ));
    let photos_suggestions_service = Arc::new(PhotosSuggestionsService::new(
        photos_suggestions_repo,
        photos_faces_repo.clone(),
        photos_persons_repo.clone(),
        photos_learning_repo.clone(),
    ));
    let photos_learning_service = Arc::new(LearningService::new(
        photos_learning_repo,
        photos_persons_repo,
        photos_suggestions_service.repo.clone(),
    ));

    let photos_state = web::Data::new(photos::photos::api::PhotosApiState {
        photos_service: photos_service.clone(),
    });
    let photos_albums_state = web::Data::new(photos::albums::api::AlbumsApiState {
        albums_service: photos_albums_service.clone(),
        photos_service: photos_service.clone(),
    });
    let photos_faces_state = web::Data::new(photos::faces::api::FacesApiState {
        faces_service: photos_faces_service,
    });
    let photos_persons_state = web::Data::new(photos::persons::api::PersonsApiState {
        persons_service: photos_persons_service,
        photos_service: photos_service.clone(),
        albums_service: photos_albums_service,
    });
    let photos_suggestions_state = web::Data::new(photos::suggestions::api::SuggestionsApiState {
        suggestions_service: photos_suggestions_service,
    });
    let photos_ai_service = Arc::new(photos::ai::service::PhotosAIService::new(ai_client.clone()));
    let photos_ai_state = web::Data::new(photos::ai::api::PhotosAIState {
        ai_service: photos_ai_service,
    });

    // Background learning reprocessing
    let photos_learning_bg = photos_learning_service.clone();
    tokio::spawn(async move {
        let interval_secs = std::env::var("REPROCESS_INTERVAL_SECS")
            .ok()
            .and_then(|s| s.parse().ok())
            .unwrap_or(1800u64);
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(interval_secs));
        interval.tick().await;
        loop {
            interval.tick().await;
            if let Err(e) = photos_learning_bg.process_all_pending() {
                tracing::error!("Background learning reprocessing error: {:?}", e);
            }
        }
    });

    // ── Sheets service ────────────────────────────────────────────────────────

    use sheets::named_ranges::repository::NamedRangesRepository;
    use sheets::named_ranges::service::NamedRangesService;

    let drive_client_for_sheets = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));

    let sheets_named_ranges_repo = Arc::new(NamedRangesRepository::new(pool.clone()));
    let sheets_named_ranges_service = Arc::new(NamedRangesService::new(
        sheets_named_ranges_repo,
        drive_client_for_sheets,
    ));
    let sheets_named_ranges_state =
        web::Data::new(sheets::named_ranges::api::NamedRangesApiState {
            service: sheets_named_ranges_service,
        });

    let sheets_ai_service = Arc::new(sheets::ai::service::SheetsAIService::new(ai_client.clone()));
    let sheets_ai_state = web::Data::new(sheets::ai::api::SheetsAIApiState {
        ai_service: sheets_ai_service,
    });

    let sheets_presence_state = web::Data::new(Arc::new(
        sheets::presence::state::SheetPresenceState::new(),
    ));

    // Drawings have no service of their own: a drawing is a Drive file with
    // `application/x-neutrino-drawing` as its mime type, served entirely by the
    // generic drive endpoints.

    // ── Slides service ────────────────────────────────────────────────────────

    use slides::slides::repository::SlidesRepository;
    use slides::slides::service::SlidesService;

    let slides_slides_repo = Arc::new(SlidesRepository::new(pool.clone()));
    let slides_service = Arc::new(SlidesService::new(slides_slides_repo));
    let slides_state = web::Data::new(slides::slides::api::SlidesApiState { slides_service });

    let slides_ai_service = Arc::new(slides::ai::service::SlidesAIService::new(ai_client.clone()));
    let slides_ai_state = web::Data::new(slides::ai::api::SlidesAIApiState {
        ai_service: slides_ai_service,
    });

    let slides_presence_state = web::Data::new(Arc::new(
        slides::presence::state::SlidePresenceState::new(),
    ));

    // ── Diagrams service ──────────────────────────────────────────────────────

    use diagrams::collab::repository::DiagramCollabRepository;
    use diagrams::collab::state::DiagramCollabState;
    use diagrams::diagrams::repository::DiagramsRepository;
    use diagrams::diagrams::service::DiagramsService;

    let drive_client_for_diagrams = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let diagrams_repo = Arc::new(DiagramsRepository::new(pool.clone()));
    let diagrams_service = Arc::new(DiagramsService::new(
        diagrams_repo,
        drive_client_for_diagrams,
    ));
    let diagrams_state =
        web::Data::new(diagrams::diagrams::api::DiagramsApiState { diagrams_service });
    let diagrams_collab_repo = web::Data::new(Arc::new(DiagramCollabRepository::new(pool.clone())));
    let diagrams_collab_state = web::Data::new(Arc::new(DiagramCollabState::new()));

    let diagrams_ai_service =
        Arc::new(diagrams::ai::service::DiagramsAIService::new(ai_client.clone()));
    let diagrams_ai_state = web::Data::new(diagrams::ai::api::DiagramsAIApiState {
        ai_service: diagrams_ai_service,
    });

    use diagrams::private_library::repository::PrivateLibraryRepository;
    use diagrams::private_library::service::PrivateLibraryService;
    use drive::private_store::PrivateStore;

    let private_store = Arc::new(
        PrivateStore::new(std::path::Path::new(&config.storage_path))
            .unwrap_or_else(|e| panic!("Failed to init private store: {}", e)),
    );
    let private_lib_repo = Arc::new(PrivateLibraryRepository::new(pool.clone()));
    let private_lib_service = Arc::new(PrivateLibraryService::new(
        private_lib_repo,
        private_store.clone(),
    ));
    let private_lib_state =
        web::Data::new(diagrams::private_library::api::PrivateLibraryApiState {
            service: private_lib_service,
        });

    // ── Key files ─────────────────────────────────────────────────────────────
    //
    // Retired identity keys, stored per user in the same private store as the
    // diagram libraries and the search snapshots. Wired here rather than beside
    // the other drive services because that is where the store is built.

    use drive::key_files::service::KeyFileService;

    let key_files_state = web::Data::new(drive::key_files::api::KeyFilesApiState {
        service: Arc::new(KeyFileService::new(
            private_store.clone(),
            drive_encryption_repo.clone(),
        )),
    });

    // ── Themes service ────────────────────────────────────────────────────────

    use themes::repository::CustomThemesRepository;
    use themes::service::CustomThemesService;

    let themes_repo = Arc::new(CustomThemesRepository::new(pool.clone()));
    let themes_service = Arc::new(CustomThemesService::new(themes_repo));
    let themes_state = web::Data::new(themes::api::ThemesApiState {
        service: themes_service,
    });

    // ── Search index sync ─────────────────────────────────────────────────────
    //
    // No server-side search: this only stores the encrypted index snapshot a
    // client uploads so its other devices can restore it. Shares the private
    // store with the diagram library — the blob is machinery, not a Drive file.

    use search::repository::SearchSnapshotRepository;
    use search::service::SearchSnapshotService;

    let search_snapshot_repo = Arc::new(SearchSnapshotRepository::new(pool.clone()));
    let search_snapshot_service = Arc::new(SearchSnapshotService::new(
        search_snapshot_repo,
        private_store.clone(),
    ));
    let search_state = web::Data::new(search::api::SearchApiState {
        service: search_snapshot_service,
    });

    // ── HTTP server ───────────────────────────────────────────────────────────

    let token_service_data = web::Data::new(token_service.clone());

    // Use the primary (drive) pool for the health check endpoint
    let primary_pool_data = web::Data::new(pool.clone());

    let bind_addr = format!("0.0.0.0:{}", config.port);
    let max_upload_bytes = config.max_upload_bytes as usize;
    let web_dir = config.web_dir.clone();

    // ── Combined OpenAPI spec ─────────────────────────────────────────────────

    #[derive(OpenApi)]
    #[openapi(
        info(
            title = "Neutrino API",
            version = "0.1.0",
            description = "The HTTP API of a self-hosted, end-to-end encrypted productivity suite. \
One Rust binary serves everything below and the exported frontend; a second binary runs the \
background jobs under the `drive-jobs` tag.\n\n\
Almost every app — Notes, Docs, Sheets, Slides, Diagrams, Drawings and Photos — stores its content as \
an ordinary Drive file, so uploads, downloads, sharing, trash and quota are handled once under the \
`storage`, `filesystem`, `permissions` and `sharing` tags rather than per app. What each app-specific \
tag adds is only what is particular to it.\n\n\
User content is encrypted in the browser before it is uploaded. Bodies that cross this API are \
therefore ciphertext the server cannot read: per-file data keys live under `drive-encryption`, the \
identity keys that open them under `auth-keyvault` and `drive-key-files`, and search runs client-side \
against an encrypted index synced through `search`.\n\n\
Requests authenticate with a bearer access token from `POST /api/v1/auth/login`. WebSocket endpoints \
cannot send headers, so they take the same token as a `token` query parameter. Endpoints marked \
admin-only require an account with the admin role; the routes under `/api/v1/internal` and the \
`drive-jobs` worker routes authenticate service-to-service and are not meant for browser clients."
        ),
        tags()
    )]
    struct NeutrinoApiDoc;

    let openapi = {
        let mut doc = NeutrinoApiDoc::openapi();
        doc.merge(auth::api::AuthApiDoc::openapi());
        doc.merge(auth::keyvault::api::KeyVaultApiDoc::openapi());
        doc.merge(calendar::events::api::EventsApiDoc::openapi());
        doc.merge(calendar::reminders::api::RemindersApiDoc::openapi());
        doc.merge(calendar::attachments::api::AttachmentsApiDoc::openapi());
        doc.merge(calendar::connections::api::ConnectionsApiDoc::openapi());
        doc.merge(calendar::tasks::api::TasksApiDoc::openapi());
        doc.merge(docs::collab::api::CollabApiDoc::openapi());
        doc.merge(drive::access_requests::api::AccessRequestsApiDoc::openapi());
        doc.merge(drive::admin::api::AdminApiDoc::openapi());
        doc.merge(drive::feature_flags::api::FeatureFlagsApiDoc::openapi());
        doc.merge(drive::version_retention::api::VersionRetentionApiDoc::openapi());
        doc.merge(drive::quota_requests::api::QuotaRequestsApiDoc::openapi());
        doc.merge(auth::password_policy::api::PasswordPolicyApiDoc::openapi());
        doc.merge(drive::fonts::api::FontsApiDoc::openapi());
        doc.merge(drive::comments::api::CommentsApiDoc::openapi());
        doc.merge(drive::encryption::api::EncryptionApiDoc::openapi());
        doc.merge(drive::filesystem::api::FilesystemApiDoc::openapi());
        doc.merge(drive::key_files::api::KeyFilesApiDoc::openapi());
        doc.merge(jobs::api::JobsApiDoc::openapi());
        doc.merge(drive::notifications::api::NotificationsApiDoc::openapi());
        doc.merge(drive::permissions::api::PermissionsApiDoc::openapi());
        doc.merge(drive::security::api::SecurityApiDoc::openapi());
        doc.merge(drive::service_registry::api::ServiceRegistryApiDoc::openapi());
        doc.merge(drive::shared_drives::api::SharedDrivesApiDoc::openapi());
        doc.merge(drive::sharing::api::SharingApiDoc::openapi());
        doc.merge(drive::storage::api::StorageApiDoc::openapi());
        doc.merge(drive::tags::api::TagsApiDoc::openapi());
        doc.merge(shared::file_events::api::FileEventsApiDoc::openapi());
        doc.merge(shared::ai::api::AiApiDoc::openapi());
        doc.merge(links::api::LinksApiDoc::openapi());
        doc.merge(photos::albums::api::AlbumsApiDoc::openapi());
        doc.merge(photos::faces::api::FacesApiDoc::openapi());
        doc.merge(photos::persons::api::PersonsApiDoc::openapi());
        doc.merge(photos::photos::api::PhotosApiDoc::openapi());
        doc.merge(photos::suggestions::api::SuggestionsApiDoc::openapi());
        doc.merge(photos::ai::api::PhotosAIApiDoc::openapi());
        doc.merge(sheets::named_ranges::api::NamedRangesApiDoc::openapi());
        doc.merge(sheets::ai::api::SheetsAIApiDoc::openapi());
        doc.merge(sheets::presence::api::SheetsPresenceApiDoc::openapi());
        doc.merge(slides::slides::api::SlidesApiDoc::openapi());
        doc.merge(slides::ai::api::SlidesAIApiDoc::openapi());
        doc.merge(slides::presence::api::SlidesPresenceApiDoc::openapi());
        doc.merge(diagrams::diagrams::api::DiagramsApiDoc::openapi());
        doc.merge(diagrams::collab::api::DiagramsCollabApiDoc::openapi());
        doc.merge(diagrams::private_library::api::PrivateLibraryApiDoc::openapi());
        doc.merge(diagrams::ai::api::DiagramsAIApiDoc::openapi());
        doc.merge(oauth::api::OauthApiDoc::openapi());
        doc.merge(themes::api::ThemesApiDoc::openapi());
        doc.merge(search::api::SearchApiDoc::openapi());
        doc
    };

    info!("Listening on {}", bind_addr);

    // Said once here rather than per request. Under `cargo dev` the absence is
    // expected — the Next dev server owns the UI and proxies only `/api` here —
    // so it is not a warning; in a deployment it is the one line that explains
    // why the site is 404ing while the API answers.
    if web_app_present(&web_dir) {
        info!("Serving the web app from {}", web_dir);
    } else {
        info!(
            "No web build at {} — serving the API only. Run `cargo web` to build it, \
             or ignore this under `cargo dev`, where the Next dev server serves the app.",
            web_dir
        );
    }

    HttpServer::new(move || {
        App::new()
            // Shared app data
            .app_data(web::PayloadConfig::new(max_upload_bytes))
            .app_data(primary_pool_data.clone())
            .app_data(token_service_data.clone())
            // Auth
            .app_data(auth_state.clone())
            .app_data(key_vault_state.clone())
            // OAuth
            .app_data(oauth_state.clone())
            // Calendar
            .app_data(cal_events_state.clone())
            .app_data(cal_reminders_state.clone())
            .app_data(cal_attachments_state.clone())
            .app_data(cal_connections_state.clone())
            .app_data(cal_tasks_state.clone())
            // Docs
            .app_data(docs_collab_repo.clone())
            .app_data(docs_collab_state.clone())
            // Drive
            .app_data(drive_storage_state.clone())
            .app_data(drive_fs_state.clone())
            .app_data(drive_permissions_state.clone())
            .app_data(drive_sharing_state.clone())
            .app_data(drive_access_requests_state.clone())
            .app_data(drive_jobs_state.clone())
            .app_data(drive_worker_secret_data.clone())
            .app_data(drive_notifications_state.clone())
            .app_data(drive_comments_state.clone())
            .app_data(drive_shared_drives_state.clone())
            .app_data(drive_security_state.clone())
            .app_data(drive_tags_state.clone())
            .app_data(drive_encryption_state.clone())
            .app_data(key_files_state.clone())
            .app_data(drive_service_registry_state.clone())
            .app_data(drive_admin_state.clone())
            .app_data(drive_feature_flags_state.clone())
            .app_data(drive_version_retention_state.clone())
            .app_data(drive_fonts_state.clone())
            .app_data(drive_quota_requests_state.clone())
            .app_data(password_policy_state.clone())
            // File events (shared)
            .app_data(file_events_state.clone())
            .app_data(file_events_drive_data.clone())
            // Links
            .app_data(links_state.clone())
            // AI
            .app_data(ai_state.clone())
            // Photos
            .app_data(photos_state.clone())
            .app_data(photos_albums_state.clone())
            .app_data(photos_faces_state.clone())
            .app_data(photos_persons_state.clone())
            .app_data(photos_suggestions_state.clone())
            .app_data(photos_ai_state.clone())
            // Drawing
            // Sheets
            .app_data(sheets_named_ranges_state.clone())
            .app_data(sheets_ai_state.clone())
            .app_data(sheets_presence_state.clone())
            // Slides
            .app_data(slides_state.clone())
            .app_data(slides_ai_state.clone())
            .app_data(slides_presence_state.clone())
            // Diagrams
            .app_data(diagrams_state.clone())
            .app_data(diagrams_collab_repo.clone())
            .app_data(diagrams_collab_state.clone())
            .app_data(diagrams_ai_state.clone())
            .app_data(private_lib_state.clone())
            // Themes
            .app_data(themes_state.clone())
            // Search
            .app_data(search_state.clone())
            // Middleware — actix runs these in reverse registration order, so `Compress` sits
            // innermost. That is on purpose: `Cors` still decorates the 406 it returns for an
            // unsupported `Accept-Encoding`, and `Logger` reports bytes actually put on the wire.
            .wrap(Compress::default())
            .wrap(NormalizePath::new(TrailingSlash::MergeOnly))
            .wrap(Logger::default())
            .wrap(Cors::permissive())
            // Swagger UI
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}").url("/api-docs/openapi.json", openapi.clone()),
            )
            // Health
            .service(health)
            // Universal Links. Registered ahead of the static web app below, which would
            // otherwise answer this path with index.html.
            .service(apple_app_site_association)
            // All /api/v1 routes in a single scope — multiple scopes with the same
            // prefix cause actix-web to route only to the first-registered one.
            .service(
                web::scope("/api/v1")
                    .configure(auth::api::configure)
                    .configure(oauth::api::configure)
                    .configure(drive::feature_flags::api::configure_public)
                    .configure(drive::fonts::api::configure_public)
                    .configure(themes::api::configure)
                    .configure(search::api::configure)
                    .configure(calendar::configure)
                    .configure(docs::configure)
                    .configure(drive::configure)
                    // Drive public sharing
                    .configure(drive::sharing::api::configure_public)
                    // Background jobs
                    .configure(jobs::api::configure)
                    // Admin routes under /admin
                    .service(
                        web::scope("/admin")
                            .configure(drive::security::api::configure)
                            .configure(drive::admin::api::configure)
                            .configure(drive::feature_flags::api::configure_admin)
                            .configure(drive::version_retention::api::configure_admin)
                            .configure(drive::quota_requests::api::configure_admin)
                            .configure(auth::password_policy::api::configure_admin)
                            .configure(drive::fonts::api::configure_admin),
                    )
                    // Internal routes
                    .service(
                        web::scope("/internal").configure(drive::service_registry::api::configure),
                    )
                    // File events (shared)
                    .configure(shared::file_events::api::configure)
                    // Links
                    .configure(links::api::configure)
                    // AI — the provider-agnostic completion route
                    .configure(shared::ai::api::configure)
                    // Photos
                    .configure(photos::photos::api::configure_photos)
                    .configure(photos::albums::api::configure_albums)
                    .configure(photos::faces::api::configure_faces)
                    .configure(photos::persons::api::configure_persons)
                    .configure(photos::suggestions::api::configure_suggestions)
                    .configure(photos::ai::api::configure)
                    // Drawing
                    // Sheets
                    .configure(sheets::named_ranges::api::configure)
                    .configure(sheets::ai::api::configure)
                    .configure(sheets::presence::api::configure)
                    // Slides
                    .configure(slides::slides::api::configure)
                    .configure(slides::ai::api::configure)
                    .configure(slides::presence::api::configure)
                    // Diagrams
                    .configure(diagrams::configure),
            )
            // Static web app — registered last so API routes take priority.
            .configure(configure_web_app(&web_dir))
    })
    .bind(&bind_addr)?
    .run()
    .await
}

// ── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use actix_web::test;

    /// Everything about Universal Links fails silently: a wrong content type, a redirect, or a
    /// missing app id all look exactly like "Safari opened instead", which is also the correct
    /// behaviour when the app is not installed. These assertions are the only place that
    /// distinguishes the two before a device does.
    mod apple_app_site_association {
        use super::*;

        async fn get() -> actix_web::dev::ServiceResponse {
            let app = test::init_service(App::new().service(apple_app_site_association)).await;
            let req = test::TestRequest::get()
                .uri("/.well-known/apple-app-site-association")
                .to_request();
            test::call_service(&app, req).await
        }

        #[actix_web::test]
        async fn is_served_at_the_well_known_path() {
            assert_eq!(get().await.status(), 200);
        }

        /// Apple requires `application/json`. The document has no file extension, so nothing
        /// infers this for us.
        #[actix_web::test]
        async fn is_served_as_json() {
            let resp = get().await;
            let content_type = resp
                .headers()
                .get("content-type")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            assert!(
                content_type.starts_with("application/json"),
                "expected application/json, got {content_type:?}"
            );
        }

        /// A redirect — including the trailing-slash kind a normalising middleware would add —
        /// makes Apple discard the document.
        #[actix_web::test]
        async fn does_not_redirect() {
            assert!(!get().await.status().is_redirection());
        }

        #[actix_web::test]
        async fn is_parseable_json() {
            let body: serde_json::Value = test::read_body_json(get().await).await;
            assert!(body.get("applinks").is_some(), "missing applinks key");
        }

        /// The three claims the iOS apps depend on. `NeutrinoAppLink.swift` mints
        /// `/open/<kind>/<id>` links in each repository; if a pattern here stops matching, those
        /// links open Safari instead of the app, and nothing reports it.
        #[actix_web::test]
        async fn claims_a_path_for_each_shipping_app() {
            let body: serde_json::Value = test::read_body_json(get().await).await;
            let details = body["applinks"]["details"]
                .as_array()
                .expect("applinks.details must be an array");

            for (app_id, path) in [
                ("46KWJJ63FU.com.neutrino.notes", "/open/note/*"),
                ("46KWJJ63FU.com.neutrino.docs", "/open/doc/*"),
                ("46KWJJ63FU.com.neutrino.drive", "/open/file/*"),
            ] {
                let entry = details
                    .iter()
                    .find(|d| {
                        d["appIDs"]
                            .as_array()
                            .is_some_and(|ids| ids.iter().any(|id| id == app_id))
                    })
                    .unwrap_or_else(|| panic!("no entry for {app_id}"));

                let claims_path = entry["components"]
                    .as_array()
                    .is_some_and(|cs| cs.iter().any(|c| c["/"] == path));
                assert!(claims_path, "{app_id} does not claim {path}");
            }
        }

        /// Two apps claiming the same pattern makes routing a coin flip, and the AASA document is
        /// the only place that constraint exists.
        #[actix_web::test]
        async fn no_path_is_claimed_twice() {
            let body: serde_json::Value = test::read_body_json(get().await).await;
            let mut seen: Vec<String> = Vec::new();
            for detail in body["applinks"]["details"].as_array().unwrap() {
                for component in detail["components"].as_array().unwrap() {
                    let path = component["/"].as_str().unwrap().to_string();
                    assert!(!seen.contains(&path), "{path} is claimed more than once");
                    seen.push(path);
                }
            }
        }
    }

    /// Asset delivery is invisible when it regresses: the app still works, it just gets slower for
    /// everyone, and nothing fails. These assertions are the only thing standing between a
    /// refactor of the service registration and a silent return to uncompressed, uncached assets.
    mod static_web_app {
        use super::*;
        use actix_web::http::header;

        /// Scratch web root that removes itself; the project has no `tempfile` dependency.
        struct TestWebDir(std::path::PathBuf);

        impl TestWebDir {
            /// A miniature Next.js static export: one hashed chunk, one index.
            fn new() -> Self {
                let path =
                    std::env::temp_dir().join(format!("neutrino-web-dir-{}", uuid::Uuid::new_v4()));
                let hashed = path.join("_next/static/chunks");
                std::fs::create_dir_all(&hashed).expect("temp dir");
                // Long enough that compression has something to work with.
                std::fs::write(
                    hashed.join("main-abc123.js"),
                    "console.log('x');\n".repeat(200),
                )
                .expect("chunk");
                std::fs::write(path.join("index.html"), "<!doctype html><title>app</title>")
                    .expect("index");
                // What `output: 'export'` with `trailingSlash: true` writes for a route: the page
                // and the RSC payload the router fetches to navigate to it without a reload.
                std::fs::create_dir_all(path.join("docs")).expect("route dir");
                std::fs::write(
                    path.join("docs/index.html"),
                    "<!doctype html><title>docs</title>",
                )
                .expect("route page");
                std::fs::write(path.join("docs/index.txt"), "3:I[\"docs\"]\n").expect("payload");
                std::fs::write(path.join("index.txt"), "3:I[\"home\"]\n").expect("root payload");
                TestWebDir(path)
            }

            fn as_str(&self) -> &str {
                self.0.to_str().expect("utf-8 temp path")
            }
        }

        impl Drop for TestWebDir {
            fn drop(&mut self) {
                let _ = std::fs::remove_dir_all(&self.0);
            }
        }

        macro_rules! get {
            ($dir:expr, $uri:expr $(, $header:expr)*) => {{
                let app = test::init_service(
                    App::new()
                        .wrap(Compress::default())
                        .configure(configure_web_app($dir.as_str())),
                )
                .await;
                let req = test::TestRequest::get()
                    .uri($uri)
                    $(.insert_header($header))*
                    .to_request();
                test::call_service(&app, req).await
            }};
        }

        fn header_of<B>(resp: &ServiceResponse<B>, name: header::HeaderName) -> String {
            resp.headers()
                .get(name)
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_owned()
        }

        #[actix_web::test]
        async fn serves_hashed_assets() {
            let dir = TestWebDir::new();
            let resp = get!(dir, "/_next/static/chunks/main-abc123.js");
            assert_eq!(resp.status(), 200);
        }

        /// A directory with no export in it is the normal state under
        /// `cargo dev`, where the Next dev server owns the UI and only `/api`
        /// is proxied here. Mounting `actix_files` over it anyway logged
        /// `Specified path is not a directory` at ERROR for every request that
        /// reached it — an error per request about a directory nothing was
        /// meant to be reading.
        #[actix_web::test]
        async fn mounts_nothing_when_there_is_no_web_build() {
            struct Missing(String);
            impl Missing {
                fn as_str(&self) -> &str {
                    &self.0
                }
            }
            let dir = Missing(
                std::env::temp_dir()
                    .join(format!("neutrino-absent-{}", uuid::Uuid::new_v4()))
                    .to_str()
                    .expect("utf-8 temp path")
                    .to_owned(),
            );

            for uri in ["/", "/some/client/route", "/_next/static/chunks/main.js"] {
                assert_eq!(
                    get!(dir, uri).status(),
                    404,
                    "{uri} should fall through to a plain 404",
                );
            }
        }

        /// An empty directory is not a web build either: the SPA fallback hands
        /// out `index.html` for every route, so without one there is nothing to
        /// serve and the mounts would only produce the same per-request errors.
        #[actix_web::test]
        async fn an_empty_directory_is_not_a_web_build() {
            let path =
                std::env::temp_dir().join(format!("neutrino-empty-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&path).expect("temp dir");
            assert!(!web_app_present(path.to_str().expect("utf-8 temp path")));
            let _ = std::fs::remove_dir_all(&path);
        }

        #[actix_web::test]
        async fn caches_hashed_assets_forever() {
            let dir = TestWebDir::new();
            let resp = get!(dir, "/_next/static/chunks/main-abc123.js");
            assert_eq!(
                header_of(&resp, header::CACHE_CONTROL),
                IMMUTABLE_CACHE_CONTROL
            );
        }

        /// `index.html` holds the URLs of every hashed asset. Cache it and a deploy never reaches
        /// anyone who has visited before.
        #[actix_web::test]
        async fn does_not_cache_the_app_shell() {
            let dir = TestWebDir::new();
            for uri in ["/", "/index.html", "/some/client/route"] {
                let resp = get!(dir, uri);
                assert_eq!(resp.status(), 200, "{uri}");
                assert_eq!(header_of(&resp, header::CACHE_CONTROL), "", "{uri}");
            }
        }

        /// A missing hashed asset must not be answered with the SPA fallback: the 200 would be
        /// cached for a year, and HTML in a `<script>` tag is a baffling way to fail.
        #[actix_web::test]
        async fn missing_hashed_asset_is_a_404() {
            let dir = TestWebDir::new();
            let resp = get!(dir, "/_next/static/chunks/never-built.js");
            assert_eq!(resp.status(), 404);
            assert_eq!(header_of(&resp, header::CACHE_CONTROL), "");
        }

        #[actix_web::test]
        async fn compresses_assets_when_the_client_asks() {
            let dir = TestWebDir::new();
            let resp = get!(
                dir,
                "/_next/static/chunks/main-abc123.js",
                (header::ACCEPT_ENCODING, "gzip")
            );
            assert_eq!(header_of(&resp, header::CONTENT_ENCODING), "gzip");
            // Without this, a shared cache may serve the compressed bytes to a client that
            // cannot read them.
            assert_eq!(
                header_of(&resp, header::VARY).to_lowercase(),
                "accept-encoding"
            );
        }

        #[actix_web::test]
        async fn leaves_responses_alone_when_the_client_cannot_decompress() {
            let dir = TestWebDir::new();
            let resp = get!(dir, "/_next/static/chunks/main-abc123.js");
            assert_eq!(header_of(&resp, header::CONTENT_ENCODING), "");
        }

        /// The whole of issue #165. The App Router asks for `/docs.txt`; the export wrote
        /// `docs/index.txt`. Answer the miss with `index.html` and the router abandons the
        /// client-side navigation and reloads the page, taking a running Takeout import — and
        /// everything else the app held in memory — with it.
        #[actix_web::test]
        async fn serves_the_rsc_payload_a_route_is_navigated_by() {
            let dir = TestWebDir::new();
            let resp = get!(dir, "/docs.txt");
            assert_eq!(resp.status(), 200);
            assert!(
                header_of(&resp, header::CONTENT_TYPE).starts_with("text/plain"),
                "the router rejects a payload that is not text/plain or RSC"
            );
            let body = test::read_body(resp).await;
            assert_eq!(body, "3:I[\"docs\"]\n".as_bytes());
        }

        /// The root's payload, and any future export that stops using `trailingSlash`, are already
        /// at the path asked for — the directory form must not be the only one that resolves.
        #[actix_web::test]
        async fn serves_a_directly_addressed_rsc_payload() {
            let dir = TestWebDir::new();
            for uri in ["/index.txt", "/docs/index.txt"] {
                let resp = get!(dir, uri);
                assert_eq!(resp.status(), 200, "{uri}");
            }
        }

        /// A payload the export never wrote — a dynamic route, a stale URL from a previous deploy —
        /// must 404 rather than fall through to the SPA. HTML under a payload URL is the failure
        /// this whole handler exists to avoid.
        #[actix_web::test]
        async fn unresolvable_rsc_payload_is_a_404() {
            let dir = TestWebDir::new();
            let resp = get!(dir, "/never/exported.txt");
            assert_eq!(resp.status(), 404);
        }

        /// The RSC branch joins paths itself, so it does not inherit `actix_files`' traversal guard.
        #[actix_web::test]
        async fn rsc_payload_cannot_escape_the_web_root() {
            let dir = TestWebDir::new();
            let outside = dir.0.parent().expect("temp root").join("outside.txt");
            std::fs::write(&outside, "secret").expect("bait");
            let resp = get!(dir, "/../outside.txt");
            assert_ne!(resp.status(), 200);
            let _ = std::fs::remove_file(&outside);
        }
    }

    /// Six endpoints upgrade to WebSocket, and browsers send `Accept-Encoding` on the handshake
    /// like any other request. Compressing a 101 would break all of them at once, in a way no
    /// unit test of those handlers would notice — the app-wide `Compress` is not visible from
    /// there. Pins the guarantee so an actix upgrade cannot quietly withdraw it.
    #[actix_web::test]
    async fn compress_leaves_protocol_upgrades_alone() {
        use actix_web::http::header;

        let app = test::init_service(App::new().wrap(Compress::default()).route(
            "/ws",
            web::get().to(|| async {
                HttpResponse::SwitchingProtocols()
                    .insert_header(("upgrade", "websocket"))
                    .body("frame bytes, not a payload to encode")
            }),
        ))
        .await;
        let req = test::TestRequest::get()
            .uri("/ws")
            .insert_header((header::ACCEPT_ENCODING, "gzip, deflate, br"))
            .to_request();
        let resp = test::call_service(&app, req).await;

        assert_eq!(resp.status(), StatusCode::SWITCHING_PROTOCOLS);
        assert!(resp.headers().get(header::CONTENT_ENCODING).is_none());
    }
}
