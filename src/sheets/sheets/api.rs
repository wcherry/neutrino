use crate::shared::{ApiError, AuthenticatedUser};
use crate::sheets::sheets::{
    dto::{CreateSheetRequest, ListSheetsResponse, SaveSheetRequest, SheetMetaResponse, SheetResponse},
    service::SheetsService,
};
use actix_web::{get, patch, post, web, HttpResponse};
use std::sync::Arc;
use utoipa::OpenApi;

pub struct SheetsApiState {
    pub sheets_service: Arc<SheetsService>,
}

#[utoipa::path(
    get,
    path = "/api/v1/sheets",
    responses(
        (status = 200, description = "List of spreadsheets", body = ListSheetsResponse),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets"
)]
#[get("/sheets")]
pub async fn list_sheets(
    state: web::Data<SheetsApiState>,
    user: AuthenticatedUser,
) -> Result<web::Json<ListSheetsResponse>, ApiError> {
    let result = state.sheets_service.list_sheets(&user).await?;
    Ok(web::Json(result))
}

#[utoipa::path(
    post,
    path = "/api/v1/sheets",
    request_body = CreateSheetRequest,
    responses(
        (status = 201, description = "Spreadsheet created", body = SheetResponse),
        (status = 400, description = "Invalid request"),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets"
)]
#[post("/sheets")]
pub async fn create_sheet(
    state: web::Data<SheetsApiState>,
    user: AuthenticatedUser,
    body: web::Json<CreateSheetRequest>,
) -> Result<HttpResponse, ApiError> {
    let sheet = state.sheets_service.create_sheet(&user, body.into_inner()).await?;
    Ok(HttpResponse::Created().json(sheet))
}

#[utoipa::path(
    get,
    path = "/api/v1/sheets/{id}",
    params(
        ("id" = String, Path, description = "Spreadsheet ID")
    ),
    responses(
        (status = 200, description = "Spreadsheet content", body = SheetResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets"
)]
#[get("/sheets/{id}")]
pub async fn get_sheet(
    state: web::Data<SheetsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
) -> Result<web::Json<SheetResponse>, ApiError> {
    let sheet_id = path.into_inner();
    let sheet = state.sheets_service.get_sheet(&user, &sheet_id).await?;
    Ok(web::Json(sheet))
}

#[utoipa::path(
    patch,
    path = "/api/v1/sheets/{id}",
    params(
        ("id" = String, Path, description = "Spreadsheet ID")
    ),
    request_body = SaveSheetRequest,
    responses(
        (status = 200, description = "Spreadsheet saved", body = SheetMetaResponse),
        (status = 403, description = "Access denied"),
        (status = 404, description = "Not found"),
    ),
    security(("bearer_auth" = [])),
    tag = "sheets"
)]
#[patch("/sheets/{id}")]
pub async fn save_sheet(
    state: web::Data<SheetsApiState>,
    user: AuthenticatedUser,
    path: web::Path<String>,
    body: web::Json<SaveSheetRequest>,
) -> Result<web::Json<SheetMetaResponse>, ApiError> {
    let sheet_id = path.into_inner();
    let meta = state
        .sheets_service
        .save_sheet(&user, &sheet_id, body.into_inner())
        .await?;
    Ok(web::Json(meta))
}

pub fn configure(cfg: &mut web::ServiceConfig) {
    cfg.service(list_sheets)
        .service(create_sheet)
        .service(get_sheet)
        .service(save_sheet);
}

#[derive(OpenApi)]
#[openapi(
    paths(list_sheets, create_sheet, get_sheet, save_sheet),
    components(schemas(
        CreateSheetRequest,
        SaveSheetRequest,
        SheetResponse,
        SheetMetaResponse,
        ListSheetsResponse,
    )),
    tags((name = "sheets", description = "Native spreadsheet editor")),
    security(("bearer_auth" = []))
)]
pub struct SheetsApiDoc;
