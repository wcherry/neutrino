use crate::shared::{init_logging, DbPool};
use actix_cors::Cors;
use actix_files;
use actix_web::{
    get, middleware::Logger, middleware::NormalizePath, middleware::TrailingSlash, web, App,
    HttpResponse, HttpServer, Responder,
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
mod drawing;
mod drive;
mod jobs;
mod notes;
mod oauth;
mod photos;
mod schema;
mod shared;
mod sheets;
mod slides;

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

// ── Entrypoint ────────────────────────────────────────────────────────────────

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    dotenvy::dotenv().ok();

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
    let auth_service = Arc::new(AuthService::new(auth_repo.clone(), token_service.clone()));
    let auth_state = web::Data::new(auth::api::AuthApiState {
        auth_service: auth_service.clone(),
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
    use drive::ai::service::DriveAIService;
    use drive::comments::repository::CommentsRepository;
    use drive::comments::service::CommentsService;
    use drive::compliance::repository::ComplianceRepository;
    use drive::compliance::service::ComplianceService;
    use drive::encryption::repository::EncryptionRepository;
    use drive::encryption::service::EncryptionService;
    use drive::feature_flags::repository::FeatureFlagsRepository;
    use drive::filesystem::repository::FilesystemRepository;
    use drive::filesystem::service::FilesystemService;
    use drive::irm::repository::IrmRepository;
    use drive::irm::service::IrmService;
    use jobs::repository::JobsRepository;
    use jobs::service::JobsService;
    use drive::notifications::hub::NotificationHub;
    use drive::notifications::repository::NotificationsRepository;
    use drive::notifications::service::{NotificationService, SmtpConfig};
    use drive::permissions::repository::PermissionsRepository;
    use drive::permissions::service::PermissionsService;
    use drive::priority::service::PriorityService;
    use drive::search::service::SearchService;
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
    use drive::suggestions::repository::SuggestionsRepository as DriveSuggestionsRepository;
    use drive::suggestions::service::SuggestionsService as DriveSuggestionsService;
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

    let drive_workspace_repo = Arc::new(WorkspaceRepository::new(pool.clone()));
    let drive_workspace_service = Arc::new(WorkspaceService::new(drive_workspace_repo));
    let drive_workspace_state = web::Data::new(drive::workspace::api::WorkspaceApiState {
        workspace_service: drive_workspace_service.clone(),
    });

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

    let drive_irm_repo = Arc::new(IrmRepository::new(pool.clone()));
    let drive_irm_service = Arc::new(IrmService::new(
        drive_irm_repo,
        drive_permissions_service.clone(),
    ));
    let drive_irm_state = web::Data::new(drive::irm::api::IrmApiState {
        irm_service: drive_irm_service.clone(),
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

    let drive_storage_state = web::Data::new(drive::storage::api::StorageApiState {
        storage_service: drive_storage_service.clone(),
        irm_service: drive_irm_service.clone(),
        permissions_service: drive_permissions_service.clone(),
        tags_service: drive_tags_service.clone(),
    });

    let drive_fs_repo = Arc::new(FilesystemRepository::new(pool.clone()));
    let drive_fs_service = Arc::new(FilesystemService::new(
        drive_fs_repo.clone(),
        file_store,
        drive_permissions_service.clone(),
    ));
    let drive_fs_state = web::Data::new(drive::filesystem::api::FilesystemApiState {
        filesystem_service: drive_fs_service,
        filesystem_repo: drive_fs_repo.clone(),
        permissions_repo: drive_permissions_repo.clone(),
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
        irm_service: drive_irm_service,
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
    let drive_activity_service = Arc::new(ActivityService::new(
        drive_activity_repo,
        drive_permissions_service.clone(),
    ));
    let drive_activity_state = web::Data::new(drive::activity::api::ActivityApiState {
        activity_service: drive_activity_service.clone(),
    });

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

    let drive_suggestions_repo = Arc::new(DriveSuggestionsRepository::new(pool.clone()));
    let drive_suggestions_service = Arc::new(DriveSuggestionsService::new(
        drive_suggestions_repo,
        drive_notification_service.clone(),
        drive_activity_service.clone(),
        drive_permissions_service.clone(),
    ));
    let drive_suggestions_state = web::Data::new(drive::suggestions::api::SuggestionsApiState {
        suggestions_service: drive_suggestions_service,
    });

    let drive_jobs_state = web::Data::new(jobs::api::JobsApiState {
        jobs_service: drive_jobs_service.clone(),
        storage_service: drive_storage_service.clone(),
    });

    let drive_search_service = Arc::new(SearchService::new(pool.clone()));
    let drive_search_state = web::Data::new(drive::search::api::SearchApiState {
        search_service: drive_search_service.clone(),
    });

    let drive_priority_service = Arc::new(PriorityService::new(pool.clone()));
    let drive_priority_state = web::Data::new(drive::priority::api::PriorityApiState {
        priority_service: drive_priority_service,
    });

    let drive_ai_service = Arc::new(DriveAIService::new(pool.clone()));
    let drive_ai_state = web::Data::new(drive::ai::api::DriveAIApiState {
        ai_service: drive_ai_service,
        search_service: drive_search_service,
    });

    let drive_shared_drives_repo = Arc::new(SharedDrivesRepository::new(pool.clone()));
    let drive_shared_drives_service = Arc::new(SharedDrivesService::new(drive_shared_drives_repo));
    let drive_shared_drives_state =
        web::Data::new(drive::shared_drives::api::SharedDrivesApiState {
            service: drive_shared_drives_service,
        });

    let drive_compliance_repo = Arc::new(ComplianceRepository::new(pool.clone()));
    let drive_compliance_service =
        Arc::new(ComplianceService::new(drive_compliance_repo, pool.clone()));
    let drive_compliance_state = web::Data::new(drive::compliance::api::ComplianceApiState {
        service: drive_compliance_service,
    });

    let drive_security_repo = Arc::new(SecurityRepository::new(pool.clone()));
    let drive_security_service = Arc::new(SecurityService::new(drive_security_repo, pool.clone()));
    let drive_security_state = web::Data::new(drive::security::api::SecurityApiState {
        service: drive_security_service,
    });

    let drive_encryption_service = Arc::new(EncryptionService::new(
        drive_encryption_repo,
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
    use docs::ai::service::DocsAIService;
    use docs::collab::repository::CollabRepository;
    use docs::collab::state::CollabState;
    use docs::docs::repository::DocsRepository;
    use docs::docs::service::DocsService;
    use docs::templates::repository::TemplatesRepository;
    use docs::templates::service::TemplatesService;

    let drive_client_for_docs = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let docs_repo = Arc::new(DocsRepository::new(pool.clone()));
    let docs_service = Arc::new(DocsService::new(docs_repo, drive_client_for_docs));
    let docs_state = web::Data::new(docs::docs::api::DocsApiState {
        docs_service: docs_service.clone(),
    });

    let docs_ai_service = Arc::new(DocsAIService::new());
    let docs_ai_state = web::Data::new(docs::ai::api::DocsAIState {
        ai_service: docs_ai_service,
    });

    let templates_repo = Arc::new(TemplatesRepository::new(pool.clone()));
    let templates_service = Arc::new(TemplatesService::new(templates_repo, docs_service));
    templates_service
        .seed_system_templates()
        .unwrap_or_else(|e| {
            error!("Failed to seed system templates: {}", e);
        });
    let templates_state =
        web::Data::new(docs::templates::api::TemplatesApiState { templates_service });

    let docs_collab_repo = web::Data::new(Arc::new(CollabRepository::new(pool.clone())));
    let docs_collab_state = web::Data::new(Arc::new(CollabState::new()));

    // ── Notes service ─────────────────────────────────────────────────────────

    use notes::repository::NotesRepository;
    use notes::service::NotesService;

    let drive_client_for_notes = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let notes_repo = Arc::new(NotesRepository::new(pool.clone()));
    let notes_service = Arc::new(NotesService::new(
        notes_repo,
        drive_client_for_notes,
        config.drive_base_url.clone(),
    ));
    let notes_state = web::Data::new(notes::api::NotesApiState { notes_service });

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
    let photos_albums_service = Arc::new(AlbumsService::new(
        photos_albums_repo,
        photos_photos_repo.clone(),
    ));
    let photos_faces_service = Arc::new(FacesService::new(
        photos_faces_repo.clone(),
        photos_photos_repo.clone(),
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
    let photos_learning_state = web::Data::new(photos::learning::api::LearningApiState {
        learning_service: photos_learning_service.clone(),
    });
    let photos_ai_service = Arc::new(photos::ai::service::PhotosAIService::new());
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
    use sheets::sheets::repository::SheetsRepository;
    use sheets::sheets::service::SheetsService;

    let drive_client_for_sheets = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let sheets_repo = Arc::new(SheetsRepository::new(pool.clone()));
    let sheets_service = Arc::new(SheetsService::new(
        sheets_repo.clone(),
        drive_client_for_sheets.clone(),
    ));
    let sheets_state = web::Data::new(sheets::sheets::api::SheetsApiState { sheets_service });

    let sheets_named_ranges_repo = Arc::new(NamedRangesRepository::new(pool.clone()));
    let sheets_named_ranges_service = Arc::new(NamedRangesService::new(
        sheets_named_ranges_repo,
        sheets_repo,
        drive_client_for_sheets,
    ));
    let sheets_named_ranges_state =
        web::Data::new(sheets::named_ranges::api::NamedRangesApiState {
            service: sheets_named_ranges_service,
        });

    let sheets_claude_client = sheets::ai::claude_client::ClaudeClient::from_env();
    let sheets_ai_service = Arc::new(sheets::ai::service::SheetsAIService::new(
        sheets_claude_client,
    ));
    let sheets_ai_state = web::Data::new(sheets::ai::api::SheetsAIApiState {
        ai_service: sheets_ai_service,
    });

    let sheets_presence_state = web::Data::new(Arc::new(
        sheets::presence::state::SheetPresenceState::new(),
    ));

    // ── Drawing service ───────────────────────────────────────────────────────

    use drawing::drawing::repository::DrawingRepository;
    use drawing::drawing::service::DrawingService;

    let drive_client_for_drawing = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let drawing_repo = Arc::new(DrawingRepository::new(pool.clone()));
    let drawing_service = Arc::new(DrawingService::new(drawing_repo, drive_client_for_drawing));
    let drawing_state = web::Data::new(drawing::drawing::api::DrawingApiState { drawing_service });

    // ── Slides service ────────────────────────────────────────────────────────

    use slides::slides::repository::SlidesRepository;
    use slides::slides::service::SlidesService;

    let drive_client_for_slides = Arc::new(DriveClient::new(
        drive_storage_service.clone(),
        drive_permissions_service.clone(),
        drive_fs_repo.clone(),
    ));
    let slides_slides_repo = Arc::new(SlidesRepository::new(pool.clone()));
    let slides_service = Arc::new(SlidesService::new(
        slides_slides_repo,
        drive_client_for_slides,
    ));
    let slides_state = web::Data::new(slides::slides::api::SlidesApiState { slides_service });

    let slides_claude_client = slides::ai::claude_client::ClaudeClient::from_env();
    let slides_ai_service = Arc::new(slides::ai::service::SlidesAIService::new(
        slides_claude_client,
    ));
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

    use diagrams::private_library::repository::PrivateLibraryRepository;
    use diagrams::private_library::service::PrivateLibraryService;
    use drive::private_store::PrivateStore;

    let private_store = Arc::new(
        PrivateStore::new(std::path::Path::new(&config.storage_path))
            .unwrap_or_else(|e| panic!("Failed to init private store: {}", e)),
    );
    let private_lib_repo = Arc::new(PrivateLibraryRepository::new(pool.clone()));
    let private_lib_service = Arc::new(PrivateLibraryService::new(private_lib_repo, private_store));
    let private_lib_state =
        web::Data::new(diagrams::private_library::api::PrivateLibraryApiState {
            service: private_lib_service,
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
    #[openapi(info(title = "Neutrino API", version = "0.1.0"), tags())]
    struct NeutrinoApiDoc;

    let openapi = {
        let mut doc = NeutrinoApiDoc::openapi();
        doc.merge(auth::api::AuthApiDoc::openapi());
        doc.merge(calendar::events::api::EventsApiDoc::openapi());
        doc.merge(calendar::reminders::api::RemindersApiDoc::openapi());
        doc.merge(calendar::attachments::api::AttachmentsApiDoc::openapi());
        doc.merge(calendar::connections::api::ConnectionsApiDoc::openapi());
        doc.merge(calendar::tasks::api::TasksApiDoc::openapi());
        doc.merge(docs::docs::api::DocsApiDoc::openapi());
        doc.merge(docs::ai::api::DocsAIApiDoc::openapi());
        doc.merge(docs::collab::api::CollabApiDoc::openapi());
        doc.merge(docs::templates::api::TemplatesApiDoc::openapi());
        doc.merge(drive::access_requests::api::AccessRequestsApiDoc::openapi());
        doc.merge(drive::activity::api::ActivityApiDoc::openapi());
        doc.merge(drive::admin::api::AdminApiDoc::openapi());
        doc.merge(drive::feature_flags::api::FeatureFlagsApiDoc::openapi());
        doc.merge(drive::ai::api::DriveAIApiDoc::openapi());
        doc.merge(drive::comments::api::CommentsApiDoc::openapi());
        doc.merge(drive::compliance::api::ComplianceApiDoc::openapi());
        doc.merge(drive::encryption::api::EncryptionApiDoc::openapi());
        doc.merge(drive::filesystem::api::FilesystemApiDoc::openapi());
        doc.merge(drive::irm::api::IrmApiDoc::openapi());
        doc.merge(jobs::api::JobsApiDoc::openapi());
        doc.merge(drive::notifications::api::NotificationsApiDoc::openapi());
        doc.merge(drive::permissions::api::PermissionsApiDoc::openapi());
        doc.merge(drive::priority::api::PriorityApiDoc::openapi());
        doc.merge(drive::search::api::SearchApiDoc::openapi());
        doc.merge(drive::security::api::SecurityApiDoc::openapi());
        doc.merge(drive::service_registry::api::ServiceRegistryApiDoc::openapi());
        doc.merge(drive::shared_drives::api::SharedDrivesApiDoc::openapi());
        doc.merge(drive::sharing::api::SharingApiDoc::openapi());
        doc.merge(drive::storage::api::StorageApiDoc::openapi());
        doc.merge(drive::suggestions::api::DriveSuggestionsApiDoc::openapi());
        doc.merge(drive::tags::api::TagsApiDoc::openapi());
        doc.merge(drive::workspace::api::WorkspaceApiDoc::openapi());
        doc.merge(notes::api::NotesApiDoc::openapi());
        doc.merge(photos::albums::api::AlbumsApiDoc::openapi());
        doc.merge(photos::faces::api::FacesApiDoc::openapi());
        doc.merge(photos::learning::api::LearningApiDoc::openapi());
        doc.merge(photos::persons::api::PersonsApiDoc::openapi());
        doc.merge(photos::photos::api::PhotosApiDoc::openapi());
        doc.merge(photos::suggestions::api::SuggestionsApiDoc::openapi());
        doc.merge(drawing::drawing::api::DrawingApiDoc::openapi());
        doc.merge(sheets::named_ranges::api::NamedRangesApiDoc::openapi());
        doc.merge(sheets::sheets::api::SheetsApiDoc::openapi());
        doc.merge(sheets::ai::api::SheetsAIApiDoc::openapi());
        doc.merge(sheets::presence::api::SheetsPresenceApiDoc::openapi());
        doc.merge(slides::slides::api::SlidesApiDoc::openapi());
        doc.merge(slides::ai::api::SlidesAIApiDoc::openapi());
        doc.merge(slides::presence::api::SlidesPresenceApiDoc::openapi());
        doc.merge(diagrams::diagrams::api::DiagramsApiDoc::openapi());
        doc.merge(diagrams::collab::api::DiagramsCollabApiDoc::openapi());
        doc.merge(diagrams::private_library::api::PrivateLibraryApiDoc::openapi());
        doc.merge(oauth::api::OauthApiDoc::openapi());
        doc
    };

    info!("Listening on {}", bind_addr);

    HttpServer::new(move || {
        App::new()
            // Shared app data
            .app_data(web::PayloadConfig::new(max_upload_bytes))
            .app_data(primary_pool_data.clone())
            .app_data(token_service_data.clone())
            // Auth
            .app_data(auth_state.clone())
            // OAuth
            .app_data(oauth_state.clone())
            // Calendar
            .app_data(cal_events_state.clone())
            .app_data(cal_reminders_state.clone())
            .app_data(cal_attachments_state.clone())
            .app_data(cal_connections_state.clone())
            .app_data(cal_tasks_state.clone())
            // Docs
            .app_data(docs_state.clone())
            .app_data(docs_ai_state.clone())
            .app_data(templates_state.clone())
            .app_data(docs_collab_repo.clone())
            .app_data(docs_collab_state.clone())
            // Drive
            .app_data(drive_storage_state.clone())
            .app_data(drive_fs_state.clone())
            .app_data(drive_permissions_state.clone())
            .app_data(drive_sharing_state.clone())
            .app_data(drive_access_requests_state.clone())
            .app_data(drive_irm_state.clone())
            .app_data(drive_workspace_state.clone())
            .app_data(drive_jobs_state.clone())
            .app_data(drive_worker_secret_data.clone())
            .app_data(drive_notifications_state.clone())
            .app_data(drive_activity_state.clone())
            .app_data(drive_comments_state.clone())
            .app_data(drive_suggestions_state.clone())
            .app_data(drive_search_state.clone())
            .app_data(drive_priority_state.clone())
            .app_data(drive_ai_state.clone())
            .app_data(drive_shared_drives_state.clone())
            .app_data(drive_compliance_state.clone())
            .app_data(drive_security_state.clone())
            .app_data(drive_tags_state.clone())
            .app_data(drive_encryption_state.clone())
            .app_data(drive_service_registry_state.clone())
            .app_data(drive_admin_state.clone())
            .app_data(drive_feature_flags_state.clone())
            // Notes
            .app_data(notes_state.clone())
            // Photos
            .app_data(photos_state.clone())
            .app_data(photos_albums_state.clone())
            .app_data(photos_faces_state.clone())
            .app_data(photos_persons_state.clone())
            .app_data(photos_suggestions_state.clone())
            .app_data(photos_learning_state.clone())
            .app_data(photos_ai_state.clone())
            // Drawing
            .app_data(drawing_state.clone())
            // Sheets
            .app_data(sheets_state.clone())
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
            .app_data(private_lib_state.clone())
            // Middleware
            .wrap(NormalizePath::new(TrailingSlash::MergeOnly))
            .wrap(Logger::default())
            .wrap(Cors::permissive())
            // Swagger UI
            .service(
                SwaggerUi::new("/swagger-ui/{_:.*}").url("/api-docs/openapi.json", openapi.clone()),
            )
            // Health
            .service(health)
            // All /api/v1 routes in a single scope — multiple scopes with the same
            // prefix cause actix-web to route only to the first-registered one.
            .service(
                web::scope("/api/v1")
                    .configure(auth::api::configure)
                    .configure(oauth::api::configure)
                    .configure(drive::feature_flags::api::configure_public)
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
                            .configure(drive::workspace::api::configure)
                            .configure(drive::compliance::api::configure)
                            .configure(drive::security::api::configure)
                            .configure(drive::admin::api::configure)
                            .configure(drive::feature_flags::api::configure_admin),
                    )
                    // Internal routes
                    .service(
                        web::scope("/internal").configure(drive::service_registry::api::configure),
                    )
                    // Notes
                    .configure(notes::api::configure)
                    // Photos
                    .configure(photos::photos::api::configure_photos)
                    .configure(photos::albums::api::configure_albums)
                    .configure(photos::faces::api::configure_faces)
                    .configure(photos::persons::api::configure_persons)
                    .configure(photos::suggestions::api::configure_suggestions)
                    .configure(photos::learning::api::configure_learning)
                    .configure(photos::ai::api::configure)
                    // Drawing
                    .configure(drawing::drawing::api::configure)
                    // Sheets
                    .configure(sheets::sheets::api::configure)
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
            // Falls back to index.html for client-side navigation.
            .service(
                actix_files::Files::new("/", &web_dir)
                    .index_file("index.html")
                    .use_last_modified(true)
                    .use_etag(true)
                    .default_handler({
                        let index = format!("{}/index.html", web_dir);
                        web::get().to(move || {
                            let index = index.clone();
                            async move {
                                actix_files::NamedFile::open(&index)
                                    .map_err(actix_web::error::ErrorNotFound)
                            }
                        })
                    }),
            )
    })
    .bind(&bind_addr)?
    .run()
    .await
}
