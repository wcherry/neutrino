use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

// ── Request types ──────────────────────────────────────────────────────────────

/// Body for POST /api/v1/sheets/:id/named-ranges.
/// `sheet_db_id` is the spreadsheet file ID (same as the :id path param —
/// included in the body for validation symmetry).
/// `sheet_id` is the tab identifier within the workbook (FortuneSheet index).
#[derive(Debug, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateNamedRangeRequest {
    /// Tab identifier within the workbook (e.g. "0").
    pub sheet_id: String,
    /// 0-based inclusive start row.
    pub start_row: i32,
    /// 0-based inclusive start column.
    pub start_col: i32,
    /// 0-based inclusive end row.
    pub end_row: i32,
    /// 0-based inclusive end column.
    pub end_col: i32,
}

// ── Response types ─────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NamedRangeResponse {
    pub id: String,
    pub sheet_db_id: String,
    pub sheet_id: String,
    pub start_row: i32,
    pub start_col: i32,
    pub end_row: i32,
    pub end_col: i32,
    pub created_at: String,
    pub updated_at: String,
}

/// A single cell value: either a scalar string/number or null.
pub type CellValue = Option<String>;

/// Response for GET /api/v1/sheets/:id/embed/:named_range_id.
/// `rows` is a 2-D array where rows[r][c] is the display value of cell
/// (startRow+r, startCol+c).
#[derive(Debug, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SheetEmbedResponse {
    pub named_range_id: String,
    pub sheet_db_id: String,
    pub sheet_id: String,
    pub start_row: i32,
    pub start_col: i32,
    pub end_row: i32,
    pub end_col: i32,
    pub rows: Vec<Vec<CellValue>>,
    pub fetched_at: String,
}
