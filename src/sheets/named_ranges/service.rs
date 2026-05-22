use crate::shared::{ApiError, AuthenticatedUser};
use crate::sheets::named_ranges::{
    dto::{CreateNamedRangeRequest, NamedRangeResponse, SheetEmbedResponse},
    model::NewNamedRangeRecord,
    repository::NamedRangesRepository,
};
use crate::sheets::sheets::repository::SheetsRepository;
use chrono::Utc;
use crate::shared::drive_client::DriveClient;
use std::sync::Arc;
use uuid::Uuid;

pub struct NamedRangesService {
    repo: Arc<NamedRangesRepository>,
    sheets_repo: Arc<SheetsRepository>,
    drive: Arc<DriveClient>,
}

impl NamedRangesService {
    pub fn new(
        repo: Arc<NamedRangesRepository>,
        sheets_repo: Arc<SheetsRepository>,
        drive: Arc<DriveClient>,
    ) -> Self {
        NamedRangesService { repo, sheets_repo, drive }
    }

    /// Create a named range for the given spreadsheet.
    /// The caller must have at least read access to the spreadsheet.
    pub async fn create_named_range(
        &self,
        user: &AuthenticatedUser,
        sheet_db_id: &str,
        req: CreateNamedRangeRequest,
    ) -> Result<NamedRangeResponse, ApiError> {
        // Verify the spreadsheet exists and the user can access it.
        let file = self
            .drive
            .get_file(&user.token, sheet_db_id, "Spreadsheet not found")
            .await?;
        if file.deleted_at.is_some() {
            return Err(ApiError::not_found("Spreadsheet is in trash"));
        }

        // Validate range bounds.
        if req.start_row < 0
            || req.start_col < 0
            || req.end_row < req.start_row
            || req.end_col < req.start_col
        {
            return Err(ApiError::bad_request("Invalid range bounds"));
        }

        let id = Uuid::new_v4().to_string();
        let record = self.repo.insert(NewNamedRangeRecord {
            id: &id,
            sheet_db_id,
            sheet_id: &req.sheet_id,
            start_row: req.start_row,
            start_col: req.start_col,
            end_row: req.end_row,
            end_col: req.end_col,
        })?;

        Ok(NamedRangeResponse {
            id: record.id,
            sheet_db_id: record.sheet_db_id,
            sheet_id: record.sheet_id,
            start_row: record.start_row,
            start_col: record.start_col,
            end_row: record.end_row,
            end_col: record.end_col,
            created_at: record.created_at.and_utc().to_rfc3339(),
            updated_at: record.updated_at.and_utc().to_rfc3339(),
        })
    }

    /// Resolve a named range to its current bounds and return the cell data.
    /// This endpoint is unauthenticated-friendly: if the bearer token is
    /// absent or invalid we skip the drive permission check and return the
    /// data anyway (the named range GUID itself is the capability token).
    pub async fn get_embed(
        &self,
        user: Option<&AuthenticatedUser>,
        sheet_db_id: &str,
        named_range_id: &str,
    ) -> Result<SheetEmbedResponse, ApiError> {
        // Verify the named range exists and belongs to this spreadsheet.
        let range = self.repo.get_by_id(named_range_id)?;
        if range.sheet_db_id != sheet_db_id {
            return Err(ApiError::not_found("Named range not found"));
        }

        // Check that the spreadsheet still exists and is not deleted.
        // We use the user token if available; otherwise we skip the drive
        // check (the named range GUID acts as an ambient capability).
        if let Some(u) = user {
            let file = self
                .drive
                .get_file(&u.token, sheet_db_id, "Spreadsheet not found")
                .await?;
            if file.deleted_at.is_some() {
                return Err(ApiError::not_found("Spreadsheet is in trash"));
            }
        }

        // Fetch the spreadsheet content from drive.
        let token = user.map(|u| u.token.as_str()).unwrap_or("");
        let content_raw = self
            .drive
            .get_content(token, sheet_db_id, "Spreadsheet content not found")
            .await?;

        let rows = extract_cell_data(
            &content_raw,
            &range.sheet_id,
            range.start_row,
            range.start_col,
            range.end_row,
            range.end_col,
        );

        Ok(SheetEmbedResponse {
            named_range_id: range.id,
            sheet_db_id: range.sheet_db_id,
            sheet_id: range.sheet_id,
            start_row: range.start_row,
            start_col: range.start_col,
            end_row: range.end_row,
            end_col: range.end_col,
            rows,
            fetched_at: Utc::now().to_rfc3339(),
        })
    }
}

// ---------------------------------------------------------------------------
// Cell-data extraction helpers
// ---------------------------------------------------------------------------

/// Parse a spreadsheet cell ID like "A1", "BC42" into 0-based (row, col).
///
/// The column letters encode a 1-based column number (A=1, B=2, ..., Z=26,
/// AA=27, ...).  The row number is a 1-based integer suffix.  Both are
/// converted to 0-based indices on return.
///
/// Returns `None` if `id` is empty, contains no digits, or is otherwise
/// malformed.
fn parse_cell_id(id: &str) -> Option<(i32, i32)> {
    // Split the id into the leading alpha part (column) and trailing digit
    // part (row).
    let split_pos = id.find(|c: char| c.is_ascii_digit())?;
    if split_pos == 0 {
        return None;
    }
    let col_str = &id[..split_pos];
    let row_str = &id[split_pos..];

    // Column letters must all be ASCII uppercase alpha.
    if !col_str.chars().all(|c| c.is_ascii_uppercase()) {
        return None;
    }

    // Decode column: base-26 with A=1.
    let mut col_1based: i32 = 0;
    for ch in col_str.chars() {
        col_1based = col_1based * 26 + (ch as i32 - 'A' as i32 + 1);
    }

    // Decode row: plain decimal integer, 1-based.
    let row_1based: i32 = row_str.parse().ok()?;
    if row_1based < 1 || col_1based < 1 {
        return None;
    }

    Some((row_1based - 1, col_1based - 1))
}

/// Extract a 2-D slice from the workbook JSON.
///
/// Two formats are supported:
///
/// 1. **Custom SheetFile format** (current frontend format):
///    ```json
///    {"sheets":[{"name":"Sheet1","cells":{"A1":{"id":"A1","raw":"hello"},...}},...]}
///    ```
///    `sheet_id` is the 0-based array index of the tab, stored as a string.
///
/// 2. **FortuneSheet legacy format** (fallback for backward compatibility):
///    ```json
///    [{"index":"0","name":"Sheet1","celldata":[{"r":0,"c":0,"v":{"v":"hello"}}],...}]
///    ```
///    Each `celldata` entry has `r` (row), `c` (col), and `v` (cell object).
///    The display value lives at `v.m` (formatted text) or `v.v` (raw value).
fn extract_cell_data(
    content: &str,
    sheet_id: &str,
    start_row: i32,
    start_col: i32,
    end_row: i32,
    end_col: i32,
) -> Vec<Vec<Option<String>>> {
    // Parse the root JSON value.
    let root: serde_json::Value = match serde_json::from_str(content) {
        Ok(v) => v,
        Err(_) => return empty_grid(start_row, start_col, end_row, end_col),
    };

    // ------------------------------------------------------------------
    // Branch 1: custom SheetFile format — root object has a "sheets" array.
    // ------------------------------------------------------------------
    if let Some(sheets_arr) = root.get("sheets").and_then(|v| v.as_array()) {
        // sheet_id is the 0-based array index stored as a string (e.g. "0").
        let sheet_index: usize = match sheet_id.parse() {
            Ok(i) => i,
            Err(_) => return empty_grid(start_row, start_col, end_row, end_col),
        };

        let sheet = match sheets_arr.get(sheet_index) {
            Some(s) => s,
            None => return empty_grid(start_row, start_col, end_row, end_col),
        };

        let cells = match sheet.get("cells").and_then(|v| v.as_object()) {
            Some(c) => c,
            None => return empty_grid(start_row, start_col, end_row, end_col),
        };

        let row_count = (end_row - start_row + 1) as usize;
        let col_count = (end_col - start_col + 1) as usize;
        let mut grid: Vec<Vec<Option<String>>> = vec![vec![None; col_count]; row_count];

        for (cell_id, cell_val) in cells {
            let (r, c) = match parse_cell_id(cell_id) {
                Some(rc) => rc,
                None => continue,
            };

            if r < start_row || r > end_row || c < start_col || c > end_col {
                continue;
            }

            let display = cell_val
                .get("raw")
                .and_then(|v| match v {
                    serde_json::Value::String(s) => Some(s.clone()),
                    serde_json::Value::Number(n) => Some(n.to_string()),
                    serde_json::Value::Bool(b) => Some(b.to_string()),
                    _ => None,
                });

            let row_idx = (r - start_row) as usize;
            let col_idx = (c - start_col) as usize;
            grid[row_idx][col_idx] = display;
        }

        return grid;
    }

    // ------------------------------------------------------------------
    // Branch 2: legacy FortuneSheet format — root is an array of sheets.
    // ------------------------------------------------------------------
    let sheets_arr = match root.as_array() {
        Some(a) => a,
        None => return empty_grid(start_row, start_col, end_row, end_col),
    };

    // Find the target sheet by its `index` field (FortuneSheet tab ID).
    let sheet = sheets_arr.iter().find(|s| {
        s.get("index")
            .and_then(|v| v.as_str())
            .map(|idx| idx == sheet_id)
            .unwrap_or(false)
    });

    let sheet = match sheet {
        Some(s) => s,
        None => return empty_grid(start_row, start_col, end_row, end_col),
    };

    let celldata = match sheet.get("celldata").and_then(|v| v.as_array()) {
        Some(cd) => cd,
        None => return empty_grid(start_row, start_col, end_row, end_col),
    };

    let row_count = (end_row - start_row + 1) as usize;
    let col_count = (end_col - start_col + 1) as usize;

    // Build a sparse map from (r, c) → display value.
    let mut grid: Vec<Vec<Option<String>>> = vec![vec![None; col_count]; row_count];

    for cell in celldata {
        let r = match cell.get("r").and_then(|v| v.as_i64()) {
            Some(r) => r as i32,
            None => continue,
        };
        let c = match cell.get("c").and_then(|v| v.as_i64()) {
            Some(c) => c as i32,
            None => continue,
        };

        if r < start_row || r > end_row || c < start_col || c > end_col {
            continue;
        }

        let display = cell
            .get("v")
            .and_then(|v| {
                // Prefer formatted display value (v.m), fall back to raw value (v.v).
                v.get("m")
                    .or_else(|| v.get("v"))
            })
            .map(|v| match v {
                serde_json::Value::String(s) => s.clone(),
                serde_json::Value::Number(n) => n.to_string(),
                serde_json::Value::Bool(b) => b.to_string(),
                _ => String::new(),
            });

        let row_idx = (r - start_row) as usize;
        let col_idx = (c - start_col) as usize;
        grid[row_idx][col_idx] = display;
    }

    grid
}

fn empty_grid(
    start_row: i32,
    start_col: i32,
    end_row: i32,
    end_col: i32,
) -> Vec<Vec<Option<String>>> {
    let row_count = (end_row - start_row + 1).max(0) as usize;
    let col_count = (end_col - start_col + 1).max(0) as usize;
    vec![vec![None; col_count]; row_count]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extract_cell_data_returns_empty_grid_for_invalid_json() {
        let rows = extract_cell_data("not-json", "0", 0, 0, 1, 1);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0].len(), 2);
        assert!(rows[0][0].is_none());
    }

    #[test]
    fn extract_cell_data_returns_values_in_range() {
        let content = r#"[{"index":"0","name":"Sheet1","celldata":[
            {"r":0,"c":0,"v":{"v":"hello"}},
            {"r":0,"c":1,"v":{"v":42}},
            {"r":1,"c":0,"v":{"m":"world","v":"world"}}
        ]}]"#;
        let rows = extract_cell_data(content, "0", 0, 0, 1, 1);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0].as_deref(), Some("hello"));
        assert_eq!(rows[0][1].as_deref(), Some("42"));
        // m field preferred over v
        assert_eq!(rows[1][0].as_deref(), Some("world"));
        assert!(rows[1][1].is_none());
    }

    #[test]
    fn extract_cell_data_excludes_cells_outside_range() {
        let content = r#"[{"index":"0","name":"Sheet1","celldata":[
            {"r":5,"c":5,"v":{"v":"outside"}},
            {"r":2,"c":2,"v":{"v":"inside"}}
        ]}]"#;
        let rows = extract_cell_data(content, "0", 2, 2, 3, 3);
        assert_eq!(rows[0][0].as_deref(), Some("inside"));
        assert!(rows[1][1].is_none());
    }

    #[test]
    fn extract_cell_data_returns_empty_for_missing_sheet() {
        let content = r#"[{"index":"1","name":"Sheet2","celldata":[]}]"#;
        let rows = extract_cell_data(content, "0", 0, 0, 0, 0);
        assert_eq!(rows.len(), 1);
        assert!(rows[0][0].is_none());
    }

    #[test]
    fn empty_grid_dimensions_are_correct() {
        let g = empty_grid(0, 0, 2, 3);
        assert_eq!(g.len(), 3);
        assert_eq!(g[0].len(), 4);
    }

    // -----------------------------------------------------------------------
    // parse_cell_id tests
    // -----------------------------------------------------------------------

    #[test]
    fn parse_cell_id_single_letter_row1() {
        assert_eq!(parse_cell_id("A1"), Some((0, 0)));
    }

    #[test]
    fn parse_cell_id_single_letter_row2() {
        assert_eq!(parse_cell_id("B2"), Some((1, 1)));
    }

    #[test]
    fn parse_cell_id_multi_letter_column() {
        // AA = 27th column → 0-based index 26
        assert_eq!(parse_cell_id("AA1"), Some((0, 26)));
    }

    #[test]
    fn parse_cell_id_z_column() {
        // Z = 26th column → 0-based index 25
        assert_eq!(parse_cell_id("Z10"), Some((9, 25)));
    }

    #[test]
    fn parse_cell_id_bc_column() {
        // BC = 26*2 + 3 = 55 → 0-based 54
        assert_eq!(parse_cell_id("BC42"), Some((41, 54)));
    }

    #[test]
    fn parse_cell_id_returns_none_for_empty_string() {
        assert_eq!(parse_cell_id(""), None);
    }

    #[test]
    fn parse_cell_id_returns_none_for_no_digits() {
        assert_eq!(parse_cell_id("ABC"), None);
    }

    #[test]
    fn parse_cell_id_returns_none_for_leading_digits() {
        assert_eq!(parse_cell_id("1A"), None);
    }

    // -----------------------------------------------------------------------
    // SheetFile format tests
    // -----------------------------------------------------------------------

    #[test]
    fn extract_cell_data_sheetfile_basic() {
        let content = r#"{
            "sheets": [
                {
                    "name": "Sheet1",
                    "cells": {
                        "A1": {"id": "A1", "raw": "hello"},
                        "B2": {"id": "B2", "raw": "world"}
                    }
                }
            ]
        }"#;
        // Range covers A1:B2 (rows 0-1, cols 0-1)
        let rows = extract_cell_data(content, "0", 0, 0, 1, 1);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0].as_deref(), Some("hello"));
        assert!(rows[0][1].is_none());
        assert!(rows[1][0].is_none());
        assert_eq!(rows[1][1].as_deref(), Some("world"));
    }

    #[test]
    fn extract_cell_data_sheetfile_second_sheet() {
        let content = r#"{
            "sheets": [
                {
                    "name": "Sheet1",
                    "cells": {
                        "A1": {"id": "A1", "raw": "wrong sheet"}
                    }
                },
                {
                    "name": "Sheet2",
                    "cells": {
                        "A1": {"id": "A1", "raw": "correct sheet"}
                    }
                }
            ]
        }"#;
        // sheet_id "1" selects the second sheet
        let rows = extract_cell_data(content, "1", 0, 0, 0, 0);
        assert_eq!(rows[0][0].as_deref(), Some("correct sheet"));
    }

    #[test]
    fn extract_cell_data_sheetfile_excludes_cells_outside_range() {
        let content = r#"{
            "sheets": [
                {
                    "name": "Sheet1",
                    "cells": {
                        "A1": {"id": "A1", "raw": "outside"},
                        "C3": {"id": "C3", "raw": "inside"}
                    }
                }
            ]
        }"#;
        // Range: rows 2-3, cols 2-3 (C3:D4 in 0-based)
        let rows = extract_cell_data(content, "0", 2, 2, 3, 3);
        assert_eq!(rows.len(), 2);
        assert_eq!(rows[0][0].as_deref(), Some("inside")); // C3 maps to row_idx 0, col_idx 0
        assert!(rows[1][1].is_none());
    }

    #[test]
    fn extract_cell_data_sheetfile_out_of_bounds_index_returns_empty() {
        let content = r#"{"sheets": [{"name": "Sheet1", "cells": {}}]}"#;
        // sheet_id "5" does not exist
        let rows = extract_cell_data(content, "5", 0, 0, 0, 0);
        assert_eq!(rows.len(), 1);
        assert!(rows[0][0].is_none());
    }

    #[test]
    fn extract_cell_data_sheetfile_no_cells_returns_empty_grid() {
        let content = r#"{"sheets": [{"name": "Sheet1"}]}"#;
        let rows = extract_cell_data(content, "0", 0, 0, 1, 1);
        assert_eq!(rows.len(), 2);
        assert!(rows[0][0].is_none());
    }
}
