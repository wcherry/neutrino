use chrono::Utc;
use diesel::prelude::*;
use crate::shared::DbPool;

use crate::schema::doc_yjs_state;

#[derive(Queryable, Insertable, AsChangeset)]
#[diesel(table_name = doc_yjs_state)]
struct YjsStateRow {
    file_id: String,
    state: Vec<u8>,
    updated_at: chrono::NaiveDateTime,
}

pub struct CollabRepository {
    pool: DbPool,
}

impl CollabRepository {
    pub fn new(pool: DbPool) -> Self {
        CollabRepository { pool }
    }

    pub fn load_state(&self, file_id: &str) -> Option<Vec<u8>> {
        let mut conn = self.pool.get().ok()?;
        doc_yjs_state::table
            .find(file_id)
            .select(doc_yjs_state::state)
            .first::<Vec<u8>>(&mut conn)
            .ok()
    }

    pub fn save_state(&self, file_id: &str, state_bytes: Vec<u8>) -> Result<(), String> {
        let mut conn = self.pool.get().map_err(|e| e.to_string())?;
        let row = YjsStateRow {
            file_id: file_id.to_string(),
            state: state_bytes,
            updated_at: Utc::now().naive_utc(),
        };
        diesel::replace_into(doc_yjs_state::table)
            .values(&row)
            .execute(&mut conn)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}
